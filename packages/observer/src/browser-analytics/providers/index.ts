/**
 * Entry module of the `@clossys/observer/browser-analytics/posthog` subpath:
 * the PostHog provider adapter alone.
 *
 * The adapter takes the SDK as an argument and imports none, so this entry
 * has no peer dependency. `BLOCK_SELECTOR_GRAMMAR` is the only selector
 * check; its two named pieces stay internal.
 */

export type {
  PostHogAutocaptureConfig,
  PostHogLike,
  PostHogProviderConfig,
  PostHogReplayConfig,
  ReplayCapability,
} from "./posthog.js";
export {
  ANALYTICS_ELEMENT_ATTRIBUTE,
  AUTOCAPTURE_ELEMENT_SELECTOR,
  BLOCK_SELECTOR_GRAMMAR,
  MASKED_TEXT_PATTERN,
  POSTHOG_AUTOCAPTURE_PROPERTIES,
  POSTHOG_EVENT_FIELDS,
  POSTHOG_INSTANCE_PREFIX,
  POSTHOG_PROPERTY_ALLOWLIST,
  POSTHOG_REPLAY_PROPERTIES,
  PRIVATE_SUBTREE_SELECTORS,
  REPLAY_RECORD_KINDS,
  REPLAY_RECORDING_OPTIONS,
  createPostHogProvider,
} from "./posthog.js";
