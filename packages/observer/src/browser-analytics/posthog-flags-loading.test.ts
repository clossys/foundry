import { afterEach, describe, expect, it, vi } from "vitest";
import { FLAGS_CAPABILITY_FIELDS } from "./providers/posthog-flags.js";
import { createPostHogProvider } from "./providers/posthog.js";
import { CONTEXT, configFor, createFake, setPage } from "./posthog-fake.test.js";
import { FLAGS_BLOCK, GOOD_FLAGS_PROBE, flagCalls, flagsEligible, flagsEvaluated, flagsInit } from "./posthog-flags-host.test.js";

const ENABLE = { advanced_disable_feature_flags: false, advanced_disable_feature_flags_on_first_load: false };

afterEach(() => {
  vi.useRealTimers();
});

describe("P-47 posthog-flags-loading: evaluation is requested only while jointly eligible, and only as C-73 allows", () => {
  it("both disables start true at init, and nothing enables evaluation before joint eligibility", () => {
    const { fake, provider } = flagsInit();
    expect(fake.inits[0]!.config.advanced_disable_feature_flags).toBe(true);
    expect(fake.inits[0]!.config.advanced_disable_feature_flags_on_first_load).toBe(true);
    expect(fake.flagState.configUpdates).toEqual([]);
    provider.optIn();
    expect(fake.flagState.configUpdates).toEqual([]);
    expect(fake.flagState.requests).toEqual([]);
    provider.flags.setExperimentsPermission(true);
    expect(fake.flagState.configUpdates).toEqual([ENABLE]);
    expect(fake.flagState.requests).toHaveLength(1);
  });

  it("subscribes before it enables, and enables before it requests", () => {
    const { fake } = flagsEligible();
    expect(flagCalls(fake)).toEqual(["onFeatureFlags", "set_config", "reloadFeatureFlags"]);
  });

  it("the evaluation request carries no person properties, groups, URL or referrer", () => {
    const { fake } = flagsEligible();
    expect(flagCalls(fake)).not.toContain("setPersonPropertiesForFlags");
    expect(flagCalls(fake)).not.toContain("group");
    const [request] = fake.flagState.requests;
    expect(request!.person_properties).toEqual({});
    expect(request!.groups).toEqual({});
    expect(JSON.stringify(fake.flagState.requests)).not.toMatch(/\$current_url|\$referrer|\$pathname|example\.test/);
    expect(fake.flagState.configUpdates).toEqual([ENABLE]);
  });

  it("without separate SDK evidence, flags stay at control and nothing is requested", () => {
    const failing: Array<[string, (() => unknown) | null]> = [
      ["no attestation", null],
      ["a throwing probe", () => {
        throw new Error("no evidence");
      }],
      ["a promise", () => Promise.resolve({ ...GOOD_FLAGS_PROBE })],
      ["null", () => null],
      ["a string field", () => ({ ...GOOD_FLAGS_PROBE, evaluatesOnReload: "true" })],
      ...FLAGS_CAPABILITY_FIELDS.map((field): [string, () => unknown] => [`${field} false`, () => ({ ...GOOD_FLAGS_PROBE, [field]: false })]),
      ...FLAGS_CAPABILITY_FIELDS.map((field): [string, () => unknown] => [`${field} missing`, () => {
        const report: Record<string, unknown> = { ...GOOD_FLAGS_PROBE };
        delete report[field];
        return report;
      }]),
    ];
    for (const [label, probe] of failing) {
      const { fake, provider } = flagsEligible({ probe });
      expect(flagCalls(fake), label).toEqual([]);
      fake.flagReply({ "hero-copy": "short" });
      expect(provider.flags.lookup("hero-copy", "control"), label).toBe("control");
    }
  });

  it("an attestation after init, a second attestation or a non-function leaves flags off for the page load", () => {
    setPage();
    const late = createFake();
    const lateProvider = createPostHogProvider(late.sdk, configFor({ flags: FLAGS_BLOCK }));
    lateProvider.init(CONTEXT);
    lateProvider.flags.attest(() => ({ ...GOOD_FLAGS_PROBE }));
    lateProvider.optIn();
    lateProvider.flags.setExperimentsPermission(true);
    expect(flagCalls(late)).toEqual([]);

    const twice = createFake();
    const twiceProvider = createPostHogProvider(twice.sdk, configFor({ flags: FLAGS_BLOCK }));
    twiceProvider.flags.attest(() => ({ ...GOOD_FLAGS_PROBE }));
    twiceProvider.flags.attest(() => ({ ...GOOD_FLAGS_PROBE }));
    twiceProvider.init(CONTEXT);
    twiceProvider.optIn();
    twiceProvider.flags.setExperimentsPermission(true);
    expect(flagCalls(twice)).toEqual([]);

    const notAFunction = createFake();
    const plainProvider = createPostHogProvider(notAFunction.sdk, configFor({ flags: FLAGS_BLOCK }));
    plainProvider.flags.attest({ ...GOOD_FLAGS_PROBE } as never);
    plainProvider.init(CONTEXT);
    plainProvider.optIn();
    plainProvider.flags.setExperimentsPermission(true);
    expect(flagCalls(notAFunction)).toEqual([]);
  });

  it("the probe is called once, at init, and not again on a re-grant", () => {
    let calls = 0;
    const { provider } = flagsEligible({
      probe: () => {
        calls += 1;
        return { ...GOOD_FLAGS_PROBE };
      },
    });
    provider.optOut();
    provider.optIn();
    provider.flags.setExperimentsPermission(false);
    provider.flags.setExperimentsPermission(true);
    expect(calls).toBe(1);
  });

  it("a missing evaluation method leaves flags at control with no enabling change", () => {
    for (const method of ["set_config", "reloadFeatureFlags", "onFeatureFlags"]) {
      const { fake, provider } = flagsEligible({ fakeOptions: { omit: [method] } });
      expect(fake.flagState.configUpdates, method).toEqual([]);
      expect(fake.flagState.requests, method).toEqual([]);
      expect(provider.flags.lookup("hero-copy", "control"), method).toBe("control");
    }
  });

  it("a reply from an earlier grant is refused after an experiments re-grant", () => {
    const { fake, provider } = flagsEligible();
    const first = fake.flagState.callbacks[0]!.callback;
    provider.flags.setExperimentsPermission(false);
    provider.flags.setExperimentsPermission(true);
    first(["hero-copy"], { "hero-copy": "short" }, { errorsLoading: false });
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
  });

  it("a reply from an earlier grant is refused after an analytics re-grant", () => {
    const { fake, provider } = flagsEligible();
    const first = fake.flagState.callbacks[0]!.callback;
    provider.optOut();
    provider.optIn();
    expect(fake.flagState.callbacks).toHaveLength(2);
    first(["hero-copy"], { "hero-copy": "short" }, { errorsLoading: false });
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    fake.flagState.callbacks[1]!.callback(["hero-copy"], { "hero-copy": "short" }, { errorsLoading: false });
    expect(provider.flags.lookup("hero-copy", "control")).toBe("short");
  });

  it("a reply that reports a loading error, or carries no plain object, is refused", () => {
    for (const [variants, context] of [
      [{ "hero-copy": "short" }, { errorsLoading: true }],
      [{ "hero-copy": "short" }, { errorsLoading: "false" }],
      [null, { errorsLoading: false }],
      [["short"], { errorsLoading: false }],
      [new Map([["hero-copy", "short"]]), { errorsLoading: false }],
    ] as Array<[unknown, unknown]>) {
      const { fake, provider } = flagsEligible();
      fake.flagReply(variants, context);
      expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
    }
  });

  it("an immediate replay of state the SDK already held, before the request, is refused", () => {
    const { fake, provider } = flagsInit();
    fake.flagState.loaded = { "hero-copy": "short" };
    provider.optIn();
    provider.flags.setExperimentsPermission(true);
    expect(provider.flags.lookup("hero-copy", "control")).toBe("control");
  });

  it("starts no polling: one request per eligible period, and no timer", () => {
    vi.useFakeTimers();
    const { fake } = flagsEvaluated();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(fake.flagState.requests).toHaveLength(1);
    expect(flagCalls(fake).filter((name) => name === "reloadFeatureFlags")).toHaveLength(1);
  });

  it("repeated grants of an already-granted purpose request nothing more", () => {
    const { fake, provider } = flagsEligible();
    provider.flags.setExperimentsPermission(true);
    provider.optIn();
    expect(fake.flagState.requests).toHaveLength(1);
  });
});
