import { describe, expect, it } from "vitest";
import { FLAGS_DISABLE_OPTIONS, FLAGS_ENABLE_OPTIONS } from "./providers/posthog-flags.js";
import { createPostHogProvider } from "./providers/posthog.js";
import { CONTEXT, configFor, createFake, setPage, type FlagOptions } from "./posthog-fake.test.js";
import { FLAGS_BLOCK, flagsEligible } from "./posthog-flags-host.test.js";

const ANALYTICS: FlagOptions[] = [{}, { autocapture: true }, { replay: true }, { autocapture: true, replay: true }];
const FLAG_DISABLES = ["advanced_disable_feature_flags", "advanced_disable_feature_flags_on_first_load"];

function initConfigText(options: FlagOptions): string {
  setPage();
  const fake = createFake();
  createPostHogProvider(fake.sdk, configFor(options)).init(CONTEXT);
  const { before_send: _hook, ...rest } = fake.inits[0]!.config;
  return JSON.stringify(rest);
}

/** Runs one combination through a grant, an experiments withdrawal, a re-grant and an analytics withdrawal. */
function lifecycleUpdates(options: FlagOptions): Array<Record<string, unknown>> {
  const { fake, provider } = flagsEligible({ analytics: options });
  fake.flagReply({ "hero-copy": "short" });
  provider.flags.lookup("hero-copy", "control");
  provider.flags.setExperimentsPermission(false);
  provider.flags.setExperimentsPermission(true);
  provider.optOut();
  provider.optIn();
  return fake.flagState.configUpdates;
}

describe("P-50 posthog-flags-options: surveys and no-code experiments stay off; flags change only their two disables (C-76)", () => {
  it("all eight combinations initialize with surveys and web experiments disabled", () => {
    for (const analytics of ANALYTICS) {
      for (const flags of [undefined, FLAGS_BLOCK]) {
        const config = JSON.parse(initConfigText({ ...analytics, ...(flags ? { flags } : {}) })) as Record<string, unknown>;
        expect(config.disable_surveys).toBe(true);
        expect(config.disable_web_experiments).toBe(true);
        for (const key of FLAG_DISABLES) expect(config[key]).toBe(true);
      }
    }
  });

  it("the four flags-off configurations are byte-identical with and without the block, and flags-on init is the same", () => {
    for (const analytics of ANALYTICS) {
      const original = initConfigText(analytics);
      expect(initConfigText({ ...analytics, flags: { ...FLAGS_BLOCK, enabled: false } })).toBe(original);
      expect(initConfigText({ ...analytics, flags: FLAGS_BLOCK })).toBe(original);
    }
  });

  it("every later option change, in all four combinations, names only the two feature-flag disables", () => {
    for (const analytics of ANALYTICS) {
      const updates = lifecycleUpdates(analytics);
      expect(updates.length).toBeGreaterThan(0);
      for (const update of updates) {
        expect(Object.keys(update).sort()).toEqual([...FLAG_DISABLES].sort());
        expect(update).not.toHaveProperty("disable_surveys");
        expect(update).not.toHaveProperty("disable_web_experiments");
        expect(update).not.toHaveProperty("persistence");
        expect(update).not.toHaveProperty("session_recording");
      }
    }
  });

  it("enables during joint eligibility and restores both disables when experiments is withdrawn with analytics open", () => {
    const updates = lifecycleUpdates({});
    expect(updates.slice(0, 3)).toEqual([{ ...FLAGS_ENABLE_OPTIONS }, { ...FLAGS_DISABLE_OPTIONS }, { ...FLAGS_ENABLE_OPTIONS }]);
  });

  it("flags-off combinations make no option change through a whole lifecycle", () => {
    for (const analytics of ANALYTICS) {
      for (const flags of [null, { ...FLAGS_BLOCK, enabled: false }]) {
        const { fake, provider } = flagsEligible({ analytics, flags });
        provider.flags.setExperimentsPermission(false);
        provider.optOut();
        provider.optIn();
        provider.flags.setExperimentsPermission(true);
        expect(fake.flagState.configUpdates).toEqual([]);
      }
    }
  });

  it("the enable and disable constants are frozen and name the two disables", () => {
    expect(FLAGS_ENABLE_OPTIONS).toEqual({ advanced_disable_feature_flags: false, advanced_disable_feature_flags_on_first_load: false });
    expect(FLAGS_DISABLE_OPTIONS).toEqual({ advanced_disable_feature_flags: true, advanced_disable_feature_flags_on_first_load: true });
    expect(Object.isFrozen(FLAGS_ENABLE_OPTIONS)).toBe(true);
    expect(Object.isFrozen(FLAGS_DISABLE_OPTIONS)).toBe(true);
  });
});
