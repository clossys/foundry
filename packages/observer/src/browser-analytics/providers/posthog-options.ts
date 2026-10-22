/**
 * Options, constants and configuration checks for the PostHog adapter's two
 * optional capture classes, autocapture and session replay (C-62 to C-64).
 *
 * Everything here is declarative and pure: no SDK is touched, no global is
 * read. Masking is a constant. The replay block has no key that turns
 * masking off or unmasks a selector, a host can only append block selectors,
 * and a configuration that names any other key is refused at construction.
 */

import { MAX_PROPERTY_STRING_LENGTH } from "../sanitize.js";

/** The one attribute that opts an element into autocapture (C-66). */
export const ANALYTICS_ELEMENT_ATTRIBUTE = "data-analytics-id" as const;

/** Subtrees that autocapture and replay never record. Exhaustive; a host can only add to the replay block list. */
export const PRIVATE_SUBTREE_SELECTORS: readonly string[] = Object.freeze([
  "[data-private]",
  "[data-consent-banner]",
  'input[type="password"]',
  '[autocomplete^="cc-"]',
]);

const FORM_FIELD_SELECTORS: readonly string[] = Object.freeze(["input", "textarea", "select", "[contenteditable]"]);

/**
 * The selector the SDK's autocapture allowlist receives: an element that
 * carries the attribute, is not itself a form field, and is neither a
 * private element nor inside one.
 */
export const AUTOCAPTURE_ELEMENT_SELECTOR: string =
  `[${ANALYTICS_ELEMENT_ATTRIBUTE}]` +
  [...FORM_FIELD_SELECTORS, ...PRIVATE_SUBTREE_SELECTORS].map((selector) => `:not(${selector})`).join("") +
  PRIVATE_SUBTREE_SELECTORS.map((selector) => `:not(${selector} *)`).join("");

/**
 * The recorder options the adapter forces under replay, with the private
 * selectors as the block selector. The adapter appends the host's block
 * selectors to `blockSelector` and passes the result (C-64).
 */
export const REPLAY_RECORDING_OPTIONS: Readonly<Record<string, unknown>> = Object.freeze({
  maskAllInputs: true,
  maskTextSelector: "*",
  blockSelector: PRIVATE_SUBTREE_SELECTORS.join(", "),
  recordHeaders: false,
  recordBody: false,
  recordCanvas: false,
  compressEvents: false,
  recordCrossOriginIframes: false,
});

/**
 * One host block selector: one or more compound selectors joined by a single
 * space or by ` > `. A compound is an optional lower-case tag name followed
 * by any number of `.name`, `#name`, `[attr]` or `[attr="value"]` parts, and
 * is never empty. No quantified group can match the same text two ways, so
 * the expression runs in time linear in the selector's length. The length
 * cap is checked before this runs.
 */
export const BLOCK_SELECTOR_GRAMMAR =
  /^(?:[a-z][a-z0-9-]*(?:[.#][A-Za-z_][A-Za-z0-9_-]*|\[[a-z][a-z0-9_-]*(?:="[A-Za-z0-9 _.:\/-]*")?\])*|(?:[.#][A-Za-z_][A-Za-z0-9_-]*|\[[a-z][a-z0-9_-]*(?:="[A-Za-z0-9 _.:\/-]*")?\])+)(?:(?: | > )(?:[a-z][a-z0-9-]*(?:[.#][A-Za-z_][A-Za-z0-9_-]*|\[[a-z][a-z0-9_-]*(?:="[A-Za-z0-9 _.:\/-]*")?\])*|(?:[.#][A-Za-z_][A-Za-z0-9_-]*|\[[a-z][a-z0-9_-]*(?:="[A-Za-z0-9 _.:\/-]*")?\])+))*$/;

/** The record kinds a `$snapshot` may carry. Exhaustive; any other kind drops the event (C-68). */
export const REPLAY_RECORD_KINDS: readonly string[] = Object.freeze([
  "full-snapshot",
  "meta",
  "custom",
  "mutation",
  "mouse-move",
  "mouse-interaction",
  "touch-move",
  "scroll",
  "viewport-resize",
  "input",
  "media-interaction",
  "stylesheet-rule",
  "style-declaration",
  "adopted-style-sheet",
]);

/** The masked form of page text: only `*` and whitespace (C-68). */
export const MASKED_TEXT_PATTERN = /^[\s*]*$/;

/** The only `$autocapture` properties that pass besides the delivery and URL fields (C-65, C-66). */
export const POSTHOG_AUTOCAPTURE_PROPERTIES: readonly string[] = Object.freeze(["$event_type", "$elements_chain"]);

/** The only `$snapshot` properties that pass besides the delivery and URL fields (C-65, C-68). */
export const POSTHOG_REPLAY_PROPERTIES: readonly string[] = Object.freeze(["$snapshot_data", "$session_id", "$window_id"]);

/** What the host's evidence shows for the SDK version it installed (H-11). Each field must be exactly `true`. */
export interface ReplayCapability {
  masksAllText: boolean;
  masksAllInputs: boolean;
  honoursBlockSelector: boolean;
  recordsNoNetworkPayloads: boolean;
  recordsNoConsole: boolean;
  recordsNoCanvas: boolean;
  recordsNavigationAddress: boolean;
  snapshotsPassBeforeSend: boolean;
}

/** The eight probe fields, in the order the specification lists them. */
export const REPLAY_CAPABILITY_FIELDS: readonly (keyof ReplayCapability)[] = Object.freeze([
  "masksAllText",
  "masksAllInputs",
  "honoursBlockSelector",
  "recordsNoNetworkPayloads",
  "recordsNoConsole",
  "recordsNoCanvas",
  "recordsNavigationAddress",
  "snapshotsPassBeforeSend",
]);

/** Most host block selectors one adapter accepts. */
export const MAX_BLOCK_SELECTORS = 50;

/** The autocapture block. */
export interface PostHogAutocaptureConfig {
  enabled: boolean;
}

/** The replay block. There is no masking key: masking is constant. */
export interface PostHogReplayConfig {
  enabled: boolean;
  /** From 0 to 1; 0 means off. Required while enabled. */
  sampleRate: number;
  /** May only add to `PRIVATE_SUBTREE_SELECTORS`; each must match `BLOCK_SELECTOR_GRAMMAR`. */
  blockSelectors?: readonly string[];
  /** Synchronous; supplied by the host's loader. */
  probe: () => ReplayCapability;
}

/** What the adapter reads from the two blocks, after validation. */
export interface FeatureSettings {
  autocaptureOn: boolean;
  replayOn: boolean;
  sampleRate: number;
  hostSelectors: readonly string[];
  /** False when a host selector is outside `BLOCK_SELECTOR_GRAMMAR`: replay stays off, nothing throws. */
  selectorsValid: boolean;
  probe: (() => unknown) | null;
}

const AUTOCAPTURE_KEYS: readonly string[] = ["enabled"];
const REPLAY_KEYS: readonly string[] = ["enabled", "sampleRate", "blockSelectors", "probe"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Copies a block after checking its keys; each value is read once. */
function readBlock(value: unknown, label: string, allowed: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(value)) throw new TypeError(`The PostHog ${label} option must be a plain object.`);
  const out: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      throw new TypeError(`The PostHog ${label} option has no key named ${String(key)}.`);
    }
    out[key] = value[key];
  }
  return out;
}

function checkSelectorList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_BLOCK_SELECTORS) {
    throw new TypeError(`The PostHog replay blockSelectors must be an array of at most ${MAX_BLOCK_SELECTORS} strings.`);
  }
  const list: string[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== "string" || entry === "" || entry.length > MAX_PROPERTY_STRING_LENGTH) {
      throw new TypeError(
        `Each PostHog replay block selector must be a non-empty string of at most ${MAX_PROPERTY_STRING_LENGTH} characters.`,
      );
    }
    list.push(entry);
  }
  return Object.freeze(list);
}

/**
 * Validates both blocks (C-63). A missing block is off. Any key outside the
 * type, any wrong type, and, under `enabled: true`, a missing or out-of-range
 * `sampleRate`, a missing `probe` or a malformed `blockSelectors` throws a
 * `TypeError`. A selector of the right type outside the grammar does not
 * throw: it leaves replay off.
 */
export function readFeatureSettings(autocapture: unknown, replay: unknown): FeatureSettings {
  let autocaptureOn = false;
  if (autocapture !== undefined) {
    const block = readBlock(autocapture, "autocapture", AUTOCAPTURE_KEYS);
    if (typeof block.enabled !== "boolean") throw new TypeError("The PostHog autocapture option needs a boolean enabled.");
    autocaptureOn = block.enabled;
  }

  let replayOn = false;
  let sampleRate = 0;
  let hostSelectors: readonly string[] = Object.freeze([]);
  let probe: (() => unknown) | null = null;
  if (replay !== undefined) {
    const block = readBlock(replay, "replay", REPLAY_KEYS);
    if (typeof block.enabled !== "boolean") throw new TypeError("The PostHog replay option needs a boolean enabled.");
    replayOn = block.enabled;
    if (block.sampleRate !== undefined && typeof block.sampleRate !== "number") {
      throw new TypeError("The PostHog replay sampleRate must be a number.");
    }
    if (block.probe !== undefined && typeof block.probe !== "function") {
      throw new TypeError("The PostHog replay probe must be a function.");
    }
    if (block.blockSelectors !== undefined) hostSelectors = checkSelectorList(block.blockSelectors);
    if (replayOn) {
      const rate = block.sampleRate;
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) {
        throw new TypeError("The PostHog replay sampleRate must be a finite number from 0 to 1.");
      }
      if (typeof block.probe !== "function") throw new TypeError("The PostHog replay option needs a probe function.");
      sampleRate = rate;
      probe = block.probe as () => unknown;
    }
  }

  // The length cap was checked above, before the expression runs.
  const selectorsValid = hostSelectors.every((selector) => BLOCK_SELECTOR_GRAMMAR.test(selector));
  return { autocaptureOn, replayOn, sampleRate, hostSelectors, selectorsValid, probe };
}

/** The block selector string the recorder receives: the private selectors, then the host's. */
export function joinedBlockSelector(hostSelectors: readonly string[]): string {
  return [...PRIVATE_SUBTREE_SELECTORS, ...hostSelectors].join(", ");
}

/** The recorder options this adapter expects the SDK instance to hold under replay. */
export function expectedRecordingOptions(hostSelectors: readonly string[]): Readonly<Record<string, unknown>> {
  return Object.freeze({ ...REPLAY_RECORDING_OPTIONS, blockSelector: joinedBlockSelector(hostSelectors) });
}

/** Options written by the adapter alone, besides `api_host` and `before_send` (C-44). */
export const FORCED_CONFIG: Readonly<Record<string, unknown>> = Object.freeze({
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
});

/**
 * The SDK configuration for one flag combination (C-64). Each flag changes
 * only the keys of its column; every other key keeps its C-44 value.
 */
export function buildForcedConfig(settings: FeatureSettings): Record<string, unknown> {
  const config: Record<string, unknown> = { ...FORCED_CONFIG };
  if (settings.autocaptureOn) {
    config.autocapture = {
      dom_event_allowlist: ["click", "submit"],
      css_selector_allowlist: [AUTOCAPTURE_ELEMENT_SELECTOR],
      capture_copied_text: false,
    };
    config.mask_all_text = true;
  }
  if (settings.replayOn && settings.selectorsValid) {
    config.session_recording = { ...expectedRecordingOptions(settings.hostSelectors) };
    config.enable_recording_console_log = false;
  }
  if (settings.autocaptureOn || settings.replayOn) config.respect_dnt = true;
  return config;
}
