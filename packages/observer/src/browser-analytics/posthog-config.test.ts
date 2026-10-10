import { describe, expect, it } from "vitest";
import { createPostHogProvider, type PostHogProviderConfig } from "./providers/posthog.js";
import { CONTEXT, GOOD_PROBE, HOST, configFor, createFake, flush, setPage, transportFor } from "./posthog-fake.test.js";

/** C-44's forced configuration, written out as literals so a change to the source constant cannot hide a change here. */
const C44_CONFIG = {
  api_host: HOST.apiHost,
  autocapture: false,
  rageclick: false,
  capture_pageview: false,
  capture_pageleave: false,
  capture_dead_clicks: false,
  capture_exceptions: false,
  capture_performance: false,
  enable_heatmaps: false,
  disable_session_recording: true,
  disable_surveys: true,
  disable_web_experiments: true,
  advanced_disable_feature_flags: true,
  advanced_disable_feature_flags_on_first_load: true,
  person_profiles: "identified_only",
  persistence: "memory",
  opt_out_capturing_by_default: true,
};

const probe = () => ({ ...GOOD_PROBE });
const replay = (extra: Record<string, unknown> = {}) => ({ enabled: true, sampleRate: 1, probe, ...extra });

function build(overrides: Record<string, unknown>) {
  const fake = createFake();
  const create = () => createPostHogProvider(fake.sdk, { ...HOST, ...overrides } as unknown as PostHogProviderConfig);
  return { fake, create };
}

describe("P-33 posthog-config: off by default, and a block that is not valid fails closed (C-62, C-63)", () => {
  it("with no block, or enabled not true, the init configuration equals C-44's exactly", () => {
    const variants: Array<Record<string, unknown>> = [
      {},
      { autocapture: { enabled: false } },
      { replay: { enabled: false } },
      { replay: { enabled: false, sampleRate: 1, probe } },
      { autocapture: { enabled: false }, replay: { enabled: false } },
    ];
    for (const overrides of variants) {
      const { fake, create } = build(overrides);
      create().init(CONTEXT);
      const { before_send: hook, ...rest } = fake.inits[0]!.config;
      expect(typeof hook).toBe("function");
      expect(rest).toEqual(C44_CONFIG);
      expect(Object.keys(fake.inits[0]!.config).sort()).toEqual([...Object.keys(C44_CONFIG), "before_send"].sort());
    }
  });

  it("an unknown key, including any masking key, throws TypeError at construction and nothing reaches the SDK", () => {
    const blocks: Array<Record<string, unknown>> = [
      { replay: replay({ maskAll: false }) },
      { replay: replay({ maskAllInputs: false }) },
      { replay: replay({ maskAllText: false }) },
      { replay: replay({ maskTextSelector: "x" }) },
      { replay: replay({ unmask: ["a"] }) },
      { replay: replay({ blockSelector: "a" }) },
      { replay: replay({ recordCanvas: true }) },
      { replay: { enabled: false, maskAll: false } },
      { autocapture: { enabled: true, selector: "a" } },
      { autocapture: { enabled: true, css_selector_allowlist: ["a"] } },
      { autocapture: { enabled: false, extra: 1 } },
    ];
    for (const overrides of blocks) {
      const { fake, create } = build(overrides);
      expect(create).toThrow(TypeError);
      expect(fake.inits).toEqual([]);
      expect(fake.calls).toEqual([]);
    }
  });

  it("a symbol key, an accessor-free class instance, an array and a non-object block throw", () => {
    class Block {
      enabled = true;
    }
    const withSymbol = { enabled: true };
    Object.defineProperty(withSymbol, Symbol("x"), { value: 1, enumerable: false });
    for (const overrides of [
      { autocapture: withSymbol },
      { autocapture: new Block() },
      { autocapture: [] },
      { autocapture: true },
      { autocapture: null },
      { replay: "on" },
      { replay: null },
    ]) {
      expect(build(overrides).create).toThrow(TypeError);
    }
  });

  it("a wrong type throws", () => {
    for (const overrides of [
      { autocapture: { enabled: "true" } },
      { autocapture: { enabled: 1 } },
      { autocapture: {} },
      { replay: { enabled: "yes", sampleRate: 1, probe } },
      { replay: replay({ sampleRate: "1" }) },
      { replay: replay({ probe: {} }) },
      { replay: replay({ blockSelectors: "aside" }) },
      { replay: replay({ blockSelectors: [1] }) },
      { replay: replay({ blockSelectors: [""] }) },
      { replay: replay({ blockSelectors: ["a".repeat(201)] }) },
      { replay: replay({ blockSelectors: Array.from({ length: 51 }, () => "aside") }) },
      { replay: { enabled: false, sampleRate: "x" } },
      { replay: { enabled: false, probe: 1 } },
    ]) {
      expect(build(overrides).create).toThrow(TypeError);
    }
  });

  it("under enabled: true, a missing or out-of-range sampleRate or a missing probe throws", () => {
    for (const block of [
      { enabled: true, probe },
      { enabled: true, sampleRate: Number.NaN, probe },
      { enabled: true, sampleRate: -0.1, probe },
      { enabled: true, sampleRate: 1.1, probe },
      { enabled: true, sampleRate: Number.POSITIVE_INFINITY, probe },
      { enabled: true, sampleRate: 1 },
    ]) {
      const { fake, create } = build({ replay: block });
      expect(create).toThrow(TypeError);
      expect(fake.inits).toEqual([]);
    }
  });

  it("accepts the boundary values 0 and 1 and 50 selectors of 200 characters", () => {
    for (const sampleRate of [0, 1, 0.5]) expect(build({ replay: replay({ sampleRate }) }).create).not.toThrow();
    const longest = `.${"a".repeat(199)}`;
    expect(longest).toHaveLength(200);
    expect(build({ replay: replay({ blockSelectors: Array.from({ length: 50 }, () => longest) }) }).create).not.toThrow();
  });

  it("reads each block value once, so a getter cannot change an answer between check and use", () => {
    let reads = 0;
    const block = {
      get enabled() {
        reads += 1;
        return reads === 1;
      },
    };
    const { fake, create } = build({ autocapture: block });
    create().init(CONTEXT);
    expect(reads).toBe(1);
    expect((fake.inits[0]!.config.autocapture as { dom_event_allowlist: string[] }).dom_event_allowlist).toEqual(["click", "submit"]);
  });

  it("an invalid block seen by the transport's loader fails the load once more, then the transport is failed with no init and no capture", async () => {
    setPage();
    const fake = createFake();
    let loads = 0;
    const { transport, clock } = transportFor(() => {
      loads += 1;
      return createPostHogProvider(fake.sdk, { ...HOST, replay: { enabled: true, sampleRate: 1, probe, maskAll: false } } as unknown as PostHogProviderConfig);
    });
    transport.setPermission(true);
    await flush();
    expect(loads).toBe(1);
    expect(clock.queue).toHaveLength(1);
    clock.fire();
    await flush();
    expect(loads).toBe(2);
    expect(clock.queue).toHaveLength(0);
    transport.pageview({ href: "https://example.test/a" });
    transport.setPermission(false);
    transport.setPermission(true);
    await flush();
    expect(loads).toBe(2);
    expect(fake.inits).toEqual([]);
    expect(fake.calls).toEqual([]);
    expect(fake.sent).toEqual([]);
  });

  it("makes no SDK call at construction under any configuration", () => {
    for (const flags of [{}, { autocapture: true }, { replay: true }, { autocapture: true, replay: true }]) {
      const fake = createFake();
      createPostHogProvider(fake.sdk, configFor(flags));
      expect(fake.inits).toEqual([]);
      expect(fake.calls).toEqual([]);
      expect(fake.hostCalls).toEqual([]);
    }
  });
});
