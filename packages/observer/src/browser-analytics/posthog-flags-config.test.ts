import { describe, expect, it } from "vitest";
import { createPostHogProvider, type PostHogProviderConfig } from "./providers/posthog.js";
import { CONTEXT, HOST, configFor, createFake, flush, setPage, transportFor, type FlagOptions } from "./posthog-fake.test.js";
import { FLAGS_BLOCK, createHostReference, flagCalls, flagsEligible } from "./posthog-flags-host.test.js";

const COMBINATIONS: FlagOptions[] = [{}, { autocapture: true }, { replay: true }, { autocapture: true, replay: true }];

function initConfig(options: FlagOptions): string {
  setPage();
  const fake = createFake();
  createPostHogProvider(fake.sdk, configFor(options)).init(CONTEXT);
  const { before_send: _hook, ...rest } = fake.inits[0]!.config;
  return JSON.stringify(rest);
}

function block(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...FLAGS_BLOCK, ...overrides };
}

function definitions(entries: Record<string, unknown>): Record<string, unknown> {
  return block({ definitions: entries });
}

const MALFORMED: Array<[string, unknown]> = [
  ["null", null],
  ["a string", "on"],
  ["an array", [true, "experiments", {}]],
  ["a class instance", new (class Flags {
    enabled = true;
    purpose = "experiments";
    definitions = {};
  })()],
  ["an unknown key", block({ extra: 1 })],
  ["a bootstrap key", block({ bootstrap: { "hero-copy": "short" } })],
  ["a missing enabled", { purpose: "experiments", definitions: {} }],
  ["a string enabled", block({ enabled: "true" })],
  ["a missing purpose", { enabled: true, definitions: {} }],
  ["an empty purpose", block({ purpose: "" })],
  ["a purpose with a space", block({ purpose: "a b" })],
  ["a purpose starting with a dash", block({ purpose: "-x" })],
  ["a purpose of 65 characters", block({ purpose: "a".repeat(65) })],
  ["a missing definitions", { enabled: true, purpose: "experiments" }],
  ["definitions as an array", block({ definitions: [] })],
  ["a malformed key", definitions({ "bad key": { control: true, variants: [true, false] } })],
  ["an empty key", definitions({ "": { control: true, variants: [true, false] } })],
  ["a key of 65 characters", definitions({ ["k".repeat(65)]: { control: true, variants: [true, false] } })],
  ["a definition with an extra key", definitions({ a: { control: true, variants: [true, false], rollout: 50 } })],
  ["a definition with no control", definitions({ a: { variants: [true, false] } })],
  ["empty variants", definitions({ a: { control: true, variants: [] } })],
  ["variants as an object", definitions({ a: { control: true, variants: { 0: true } } })],
  ["a sparse variants array", definitions({ a: { control: true, variants: [true, , false] } })],
  ["a variants array with an extra property", definitions({ a: { control: true, variants: Object.assign([true, false], { extra: 1 }) } })],
  ["a numeric variant", definitions({ a: { control: 1, variants: [1, 2] } })],
  ["an empty-string variant", definitions({ a: { control: "x", variants: ["x", ""] } })],
  ["an overlong variant", definitions({ a: { control: "x", variants: ["x", "v".repeat(201)] } })],
  ["a null variant", definitions({ a: { control: "x", variants: ["x", null] } })],
  ["a duplicate variant", definitions({ a: { control: "x", variants: ["x", "y", "x"] } })],
  ["a control outside its variants", definitions({ a: { control: "z", variants: ["x", "y"] } })],
];

function accessorBlocks(): Array<[string, unknown]> {
  const onBlock = { purpose: "experiments", definitions: {} };
  Object.defineProperty(onBlock, "enabled", { enumerable: true, get: () => true });
  const onDefinitions = {};
  Object.defineProperty(onDefinitions, "a", { enumerable: true, get: () => ({ control: true, variants: [true, false] }) });
  const onDefinition = { variants: [true, false] };
  Object.defineProperty(onDefinition, "control", { enumerable: true, get: () => true });
  const onVariant = [true];
  Object.defineProperty(onVariant, "1", { enumerable: true, configurable: true, get: () => false });
  return [
    ["an accessor on the block", onBlock],
    ["an accessor in definitions", block({ definitions: onDefinitions })],
    ["an accessor in a definition", definitions({ a: onDefinition })],
    ["an accessor in variants", definitions({ a: { control: true, variants: onVariant } })],
    ["a symbol key", { ...FLAGS_BLOCK, [Symbol("x")]: 1 }],
  ];
}

describe("P-45 posthog-flags-config: the flags block is optional, closed and validated before initialization (C-71, C-63)", () => {
  it("an absent block and a disabled block keep each of the four original configurations byte for byte", () => {
    for (const options of COMBINATIONS) {
      const original = initConfig(options);
      expect(initConfig({ ...options, flags: { ...FLAGS_BLOCK, enabled: false } })).toBe(original);
      expect(initConfig({ ...options, flags: FLAGS_BLOCK })).toBe(original);
    }
  });

  it("a disabled block does no flag work even when every other condition holds", () => {
    const { fake, provider } = flagsEligible({ flags: { ...FLAGS_BLOCK, enabled: false } });
    expect(flagCalls(fake)).toEqual([]);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    expect(provider.flags.purpose).toBe("experiments");
  });

  it("an absent block does no flag work and has no purpose", () => {
    const { fake, provider } = flagsEligible({ flags: null });
    expect(flagCalls(fake)).toEqual([]);
    expect(provider.flags.purpose).toBeNull();
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
  });

  it("refuses each malformed block with a TypeError at construction, before any SDK call", () => {
    for (const [label, flags] of [...MALFORMED, ...accessorBlocks()]) {
      const fake = createFake();
      expect(() => createPostHogProvider(fake.sdk, configFor({ flags })), label).toThrow(TypeError);
      expect(fake.inits, label).toEqual([]);
      expect(fake.calls, label).toEqual([]);
    }
  });

  it("accepts the edge values of C-74: a 64-character key and purpose, a 200-character variant, boolean and string flags", () => {
    const fake = createFake();
    const valid = {
      enabled: true,
      purpose: `e${"x".repeat(63)}`,
      definitions: {
        [`k${"y".repeat(63)}`]: { control: "x", variants: ["x", "v".repeat(200)] },
        "a.b_c-d": { control: true, variants: [true, false] },
      },
    };
    expect(() => createPostHogProvider(fake.sdk, configFor({ flags: valid }))).not.toThrow();
  });

  it("an invalid block seen by the transport's loader fails the load once more, then the transport is failed with no init", async () => {
    setPage();
    const fake = createFake();
    let loads = 0;
    const { transport, clock } = transportFor(() => {
      loads += 1;
      return createPostHogProvider(fake.sdk, { ...HOST, flags: { ...FLAGS_BLOCK, extra: true } } as unknown as PostHogProviderConfig);
    });
    transport.setPermission(true);
    await flush();
    expect(loads).toBe(1);
    clock.fire();
    await flush();
    expect(loads).toBe(2);
    expect(clock.queue).toHaveLength(0);
    transport.setPermission(false);
    transport.setPermission(true);
    await flush();
    expect(loads).toBe(2);
    expect(fake.inits).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("the host reference binds flags to its own experiments grant: analytics alone evaluates nothing, experiments alone loads nothing", async () => {
    const analyticsOnly = createHostReference();
    analyticsOnly.setAnalytics("granted");
    await flush();
    expect(analyticsOnly.loads()).toBe(1);
    expect(flagCalls(analyticsOnly.fake)).toEqual([]);
    expect(analyticsOnly.render("client", "hero-copy", "control")).toBe("control");

    const experimentsOnly = createHostReference();
    experimentsOnly.setExperiments("granted");
    await flush();
    expect(experimentsOnly.loads()).toBe(0);
    expect(experimentsOnly.fake.inits).toEqual([]);
    expect(experimentsOnly.fake.calls).toEqual([]);
  });
});
