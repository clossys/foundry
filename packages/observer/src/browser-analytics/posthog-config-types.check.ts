/**
 * Compile-time proof for the PostHog adapter's configuration type (P-40).
 *
 * Named `*.check.ts`, not `*.test.ts`, so it is part of the real `tsc` run
 * (`npm run typecheck`) and fails the build when the type regresses. Nothing
 * imports it at runtime.
 *
 * What it proves:
 * - the replay block admits no masking key, so a host cannot loosen masking;
 * - `blockSelectors` is the only selector key the replay block has;
 * - the autocapture block admits no selector or attribute key;
 * - a configuration with only `key` and `apiHost` still type-checks.
 *
 * Each `@ts-expect-error` line fails the build if the line below it starts
 * to type-check.
 */

import type { PostHogAutocaptureConfig, PostHogProviderConfig, PostHogReplayConfig, ReplayCapability } from "./providers/posthog.js";

/** Stands in for the host's loader probe; this file is type-checked and not run. */
function probe(): ReplayCapability {
  throw new Error("type-level check only");
}

// A configuration with only `key` and `apiHost` type-checks.
export const minimal: PostHogProviderConfig = { key: "k", apiHost: "https://analytics.example.test" };

// Both blocks, as a host writes them.
export const full: PostHogProviderConfig = {
  key: "k",
  apiHost: "https://analytics.example.test",
  autocapture: { enabled: true },
  replay: { enabled: true, sampleRate: 0.5, blockSelectors: ["aside"], probe },
};

// The only keys of the replay block, as a closed set: adding one to the type fails this assignment.
type ReplayKeys = keyof PostHogReplayConfig;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export const replayKeysAreClosed: Equal<ReplayKeys, "enabled" | "sampleRate" | "blockSelectors" | "probe"> = true;
export const autocaptureKeysAreClosed: Equal<keyof PostHogAutocaptureConfig, "enabled"> = true;

// No masking key on the replay block.
export const maskAll: PostHogReplayConfig = {
  enabled: true,
  sampleRate: 1,
  probe,
  // @ts-expect-error masking is constant; the block has no `maskAll`.
  maskAll: false,
};
export const maskAllInputs: PostHogReplayConfig = {
  enabled: true,
  sampleRate: 1,
  probe,
  // @ts-expect-error masking is constant; the block has no `maskAllInputs`.
  maskAllInputs: false,
};
export const maskTextSelector: PostHogReplayConfig = {
  enabled: true,
  sampleRate: 1,
  probe,
  // @ts-expect-error masking is constant; the block has no `maskTextSelector`.
  maskTextSelector: "p",
};
export const maskNothing: PostHogReplayConfig = {
  enabled: true,
  sampleRate: 1,
  probe,
  // @ts-expect-error masking is constant; the block has no `session_recording` override.
  session_recording: { maskAllInputs: false },
};

// `blockSelectors` is the only selector key.
export const blockSelector: PostHogReplayConfig = {
  enabled: true,
  sampleRate: 1,
  probe,
  // @ts-expect-error the key is `blockSelectors`, a list.
  blockSelector: "aside",
};
export const unmaskSelector: PostHogReplayConfig = {
  enabled: true,
  sampleRate: 1,
  probe,
  // @ts-expect-error there is no unmask selector.
  unmaskSelector: "aside",
};
export const blockSelectorsMustBeStrings: PostHogReplayConfig = {
  enabled: true,
  sampleRate: 1,
  probe,
  // @ts-expect-error each selector is a string.
  blockSelectors: [1],
};

// The autocapture block has no selector or attribute key.
export const autocaptureSelector: PostHogAutocaptureConfig = {
  enabled: true,
  // @ts-expect-error the element selector is constant.
  css_selector_allowlist: ["a"],
};
export const autocaptureText: PostHogAutocaptureConfig = {
  enabled: true,
  // @ts-expect-error element text is not a configuration option.
  capture_copied_text: true,
};

// The replay block needs `enabled`, `sampleRate` and `probe`.
// @ts-expect-error `enabled` is required.
export const noEnabled: PostHogReplayConfig = { sampleRate: 1, probe };
// @ts-expect-error `sampleRate` is required.
export const noRate: PostHogReplayConfig = { enabled: true, probe };
// @ts-expect-error `probe` is required.
export const noProbe: PostHogReplayConfig = { enabled: true, sampleRate: 1 };
