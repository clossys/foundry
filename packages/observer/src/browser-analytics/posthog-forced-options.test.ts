import { describe, expect, it } from "vitest";
import {
  AUTOCAPTURE_ELEMENT_SELECTOR,
  PRIVATE_SUBTREE_SELECTORS,
  REPLAY_RECORDING_OPTIONS,
  createPostHogProvider,
} from "./providers/posthog.js";
import { CONTEXT, HOST, configFor, createFake, type FlagOptions } from "./posthog-fake.test.js";

/** C-44's forced configuration as literals. */
const C44 = {
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

const PRIVATE = ["[data-private]", "[data-consent-banner]", 'input[type="password"]', '[autocomplete^="cc-"]'];

const AUTOCAPTURE_COLUMN = {
  autocapture: {
    dom_event_allowlist: ["click", "submit"],
    css_selector_allowlist: [AUTOCAPTURE_ELEMENT_SELECTOR],
    capture_copied_text: false,
  },
  mask_all_text: true,
  respect_dnt: true,
};

function replayColumn(blockSelector: string) {
  return {
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      blockSelector,
      recordHeaders: false,
      recordBody: false,
      recordCanvas: false,
      compressEvents: false,
      recordCrossOriginIframes: false,
    },
    enable_recording_console_log: false,
    respect_dnt: true,
  };
}

function initConfig(flags: FlagOptions): Record<string, unknown> {
  const fake = createFake();
  createPostHogProvider(fake.sdk, configFor(flags)).init(CONTEXT);
  const { before_send: hook, ...rest } = fake.inits[0]!.config;
  expect(typeof hook).toBe("function");
  return rest;
}

describe("P-34 posthog-forced-options: each flag changes its own column and nothing else (C-64)", () => {
  it("both flags off: exactly C-44", () => {
    expect(initConfig({})).toEqual(C44);
  });

  it("autocapture on: the autocapture column over C-44", () => {
    expect(initConfig({ autocapture: true })).toEqual({ ...C44, ...AUTOCAPTURE_COLUMN });
  });

  it("replay on: the replay column over C-44, with disable_session_recording still true", () => {
    const config = initConfig({ replay: true });
    expect(config).toEqual({ ...C44, ...replayColumn(PRIVATE.join(", ")) });
    expect(config.disable_session_recording).toBe(true);
    expect(config).not.toHaveProperty("mask_all_text");
  });

  it("both on: both columns", () => {
    expect(initConfig({ autocapture: true, replay: true })).toEqual({
      ...C44,
      ...AUTOCAPTURE_COLUMN,
      ...replayColumn(PRIVATE.join(", ")),
    });
  });

  it("an enabled: false flag leaves its column out even when the other is on", () => {
    expect(initConfig({ autocapture: false, replay: true })).toEqual({ ...C44, ...replayColumn(PRIVATE.join(", ")) });
    expect(initConfig({ autocapture: true, replay: false })).toEqual({ ...C44, ...AUTOCAPTURE_COLUMN });
  });

  it("the experiment, survey and feature-flag disables hold under every combination", () => {
    for (const flags of [{}, { autocapture: true }, { replay: true }, { autocapture: true, replay: true }]) {
      const config = initConfig(flags);
      expect(config.disable_surveys).toBe(true);
      expect(config.disable_web_experiments).toBe(true);
      expect(config.advanced_disable_feature_flags).toBe(true);
      expect(config.advanced_disable_feature_flags_on_first_load).toBe(true);
      expect(config.capture_performance).toBe(false);
      expect(config.persistence).toBe("memory");
      expect(config).not.toHaveProperty("mask_all_element_attributes");
    }
  });

  it("the host's block selectors follow the private ones, in order, and never replace them", () => {
    const config = initConfig({ replay: true, blockSelectors: ["aside", ".card [data-x=\"a b\"]"] });
    const recording = config.session_recording as { blockSelector: string };
    expect(recording.blockSelector).toBe([...PRIVATE, "aside", '.card [data-x="a b"]'].join(", "));
    expect(recording.blockSelector.startsWith(PRIVATE.join(", "))).toBe(true);
  });

  it("the exported constants match the specified literals", () => {
    expect([...PRIVATE_SUBTREE_SELECTORS]).toEqual(PRIVATE);
    expect(REPLAY_RECORDING_OPTIONS).toEqual(replayColumn(PRIVATE.join(", ")).session_recording);
    expect(AUTOCAPTURE_ELEMENT_SELECTOR).toBe(
      '[data-analytics-id]:not(input):not(textarea):not(select):not([contenteditable])' +
        ':not([data-private]):not([data-consent-banner]):not(input[type="password"]):not([autocomplete^="cc-"])' +
        ':not([data-private] *):not([data-consent-banner] *):not(input[type="password"] *):not([autocomplete^="cc-"] *)',
    );
    expect(Object.isFrozen(PRIVATE_SUBTREE_SELECTORS)).toBe(true);
    expect(Object.isFrozen(REPLAY_RECORDING_OPTIONS)).toBe(true);
  });

  it("the host's selector array is copied at construction, so a later change cannot reach init", () => {
    const selectors = ["aside"];
    const fake = createFake();
    const provider = createPostHogProvider(fake.sdk, configFor({ replay: true, blockSelectors: selectors }));
    selectors.push("main");
    selectors[0] = "section";
    provider.init(CONTEXT);
    expect((fake.inits[0]!.config.session_recording as { blockSelector: string }).blockSelector.endsWith(", aside")).toBe(true);
  });
});
