/**
 * PostHog provider adapter for the analytics transport (C-44, C-62 to C-69).
 *
 * The package never imports the SDK (C-3). The host passes the SDK object it
 * loaded itself, typed by the structural `PostHogLike` subset below, plus its
 * own key and host, and optionally an `autocapture` and a `replay` block.
 * Nothing else a host passes can reach the SDK's configuration.
 *
 * The adapter:
 *
 * - initializes a named instance whose name is unique to this adapter, and
 *   from then on calls methods only on the instance `init` returned, after
 *   checking that it carries this adapter's own `before_send` hook by
 *   identity. An SDK returns an already-loaded name's instance unchanged, so
 *   a reused instance (from the host or another adapter) is refused;
 * - forces every option in `FORCED_CONFIG` and, per flag, the keys of the
 *   C-64 table, so surveys, experiments, feature flags and persistent storage
 *   stay off and masking is constant;
 * - captures a sanitized pageview as `$pageview` and a conversion under its
 *   allowlisted name;
 * - runs one `before_send` hook, the single exit for every event class
 *   (C-65): it rebuilds the event from `POSTHOG_EVENT_FIELDS`, keeps only the
 *   delivery fields plus the class's own list, and overwrites every URL
 *   field from the sanitized URL. A transport event is recognized only while
 *   the adapter's own `capture` call is still running; `$autocapture` and
 *   `$snapshot` pass only under their flag, while the capture gate is open
 *   (and, for a snapshot, replay has started in this grant and its payload
 *   passes the checks of C-68). An SDK that ran the hook later would have
 *   every transport event dropped: it fails closed;
 * - closes the capture gate synchronously before any SDK call on a
 *   withdrawal, and starts every grant as a new session (C-67, C-69).
 *
 * The autocapture and replay classes are not yet part of the consent
 * assembly's API. Whether these option and property names behave as named in
 * the SDK version a host installs is separate evidence; a fake cannot prove
 * it.
 */

import type { AnalyticsProviderPort, ProviderInitContext, SanitizedAnalyticsEvent } from "../types.js";
import { MAX_PROPERTY_STRING_LENGTH } from "../sanitize.js";
import { rebuildAutocapture } from "./posthog-autocapture.js";
import {
  POSTHOG_AUTOCAPTURE_PROPERTIES,
  POSTHOG_REPLAY_PROPERTIES,
  REPLAY_CAPABILITY_FIELDS,
  buildForcedConfig,
  expectedRecordingOptions,
  readFeatureSettings,
  type FeatureSettings,
  type PostHogAutocaptureConfig,
  type PostHogReplayConfig,
} from "./posthog-options.js";
import { addressHasQueryOrFragment, finishReplayPayload, scanReplayPayload } from "./posthog-payload.js";

export {
  ANALYTICS_ELEMENT_ATTRIBUTE,
  AUTOCAPTURE_ELEMENT_SELECTOR,
  BLOCK_SELECTOR_GRAMMAR,
  MASKED_TEXT_PATTERN,
  POSTHOG_AUTOCAPTURE_PROPERTIES,
  POSTHOG_REPLAY_PROPERTIES,
  PRIVATE_SUBTREE_SELECTORS,
  REPLAY_RECORD_KINDS,
  REPLAY_RECORDING_OPTIONS,
  type PostHogAutocaptureConfig,
  type PostHogReplayConfig,
  type ReplayCapability,
} from "./posthog-options.js";

/** The subset of the PostHog SDK object the adapter calls, declared structurally. */
export interface PostHogLike {
  init(apiKey: string, config: Record<string, unknown>, name: string): PostHogLike | undefined | void;
  /** Read only: the identity check, and the by-value read-back of the forced recording options. */
  readonly config?: {
    readonly before_send?: unknown;
    readonly session_recording?: unknown;
    readonly enable_recording_console_log?: unknown;
  };
  capture(eventName: string, properties?: Record<string, unknown>): unknown;
  opt_in_capturing(): void;
  opt_out_capturing(): void;
  startSessionRecording?(): void;
  stopSessionRecording?(): void;
  reset?(): void;
  get_session_id?(): unknown;
}

/** Host values the adapter accepts. There is no other option. */
export interface PostHogProviderConfig {
  key: string;
  apiHost: string;
  autocapture?: PostHogAutocaptureConfig;
  replay?: PostHogReplayConfig;
}

/** Fixed prefix of every instance name this adapter creates. */
export const POSTHOG_INSTANCE_PREFIX = "consent_analytics_";

/**
 * The only SDK-set properties that may leave the browser: delivery fields,
 * the profile-suppression field and the URL fields. The URL fields are never
 * kept as the SDK set them; the hook overwrites all five.
 */
export const POSTHOG_PROPERTY_ALLOWLIST: readonly string[] = Object.freeze([
  "token",
  "distinct_id",
  "$lib",
  "$lib_version",
  "$insert_id",
  "$time",
  "$process_person_profile",
  "$current_url",
  "$host",
  "$pathname",
  "$referrer",
  "$referring_domain",
]);

/**
 * The only top-level fields of a captured event that pass the hook. The
 * event is rebuilt from these, with `properties` replaced by the hook's own;
 * every other top-level field is dropped.
 */
export const POSTHOG_EVENT_FIELDS: readonly string[] = Object.freeze(["uuid", "event", "timestamp"]);

const URL_FIELDS: ReadonlySet<string> = new Set(["$current_url", "$host", "$pathname", "$referrer", "$referring_domain"]);
const DELIVERY_FIELDS: ReadonlySet<string> = new Set(POSTHOG_PROPERTY_ALLOWLIST.filter((name) => !URL_FIELDS.has(name)));

interface PendingCapture {
  name: string;
  referrerOrigin: string | undefined;
  properties: Readonly<Record<string, string | number | boolean>>;
}

interface CaptureResultLike {
  event?: unknown;
  properties?: unknown;
  [field: string]: unknown;
}

interface RandomSource {
  crypto?: { getRandomValues?: (array: Uint32Array) => Uint32Array };
}

interface PageGlobals {
  location?: { href?: unknown };
  performance?: { getEntriesByType?: (type: string) => unknown };
}

let adaptersCreated = 0;

/** The page's secure random source, or `null` when it has none. Read at call time. */
function secureRandom(): ((array: Uint32Array) => Uint32Array) | null {
  const source = (globalThis as unknown as RandomSource).crypto;
  return source && typeof source.getRandomValues === "function" ? source.getRandomValues.bind(source) : null;
}

/** A suffix unique to one adapter, generated when the adapter is created, never at import. */
function instanceSuffix(): string {
  adaptersCreated += 1;
  const words = new Uint32Array(2);
  const random = secureRandom();
  if (random) {
    random(words);
  } else {
    words[0] = Math.floor(Math.random() * 0x100000000);
    words[1] = Math.floor(Math.random() * 0x100000000);
  }
  return `${adaptersCreated.toString(36)}_${[...words].map((word) => word.toString(36)).join("")}`;
}

/** One draw in [0, 1) from the secure source, or `null` when the page has none (replay then stays off). */
function drawSample(): number | null {
  const random = secureRandom();
  if (!random) return null;
  try {
    const words = new Uint32Array(1);
    random(words);
    return words[0]! / 0x100000000;
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function has(record: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

/** The page's current address, read when asked; `null` when it cannot be read. */
function readPageAddress(): string | null {
  try {
    const href = (globalThis as unknown as PageGlobals).location?.href;
    return typeof href === "string" ? href : null;
  } catch {
    return null;
  }
}

/**
 * The document's load address, from the first navigation timing entry. A
 * browser without the entry gives `undefined`; an entry that cannot be read
 * as an address gives `null`.
 */
function readLoadAddress(): string | null | undefined {
  try {
    const timing = (globalThis as unknown as PageGlobals).performance;
    if (!timing || typeof timing.getEntriesByType !== "function") return undefined;
    const entries = timing.getEntriesByType("navigation");
    if (!Array.isArray(entries) || entries.length === 0) return undefined;
    const name = (entries[0] as { name?: unknown } | null | undefined)?.name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

function swallow(call: () => void): void {
  try {
    call();
  } catch {
    // An SDK error never reopens the gate and never skips a later step (C-67).
  }
}

/**
 * Creates the adapter. It validates both feature blocks when it is called
 * (C-63) and calls nothing on the SDK until the transport calls
 * `init(context)`.
 */
export function createPostHogProvider(sdk: PostHogLike, config: PostHogProviderConfig): AnalyticsProviderPort {
  // Each value is read once; the validated local is the one used.
  const key: unknown = config.key;
  const apiHost: unknown = config.apiHost;
  if (typeof key !== "string" || key === "") throw new TypeError("A PostHog provider needs a key.");
  if (typeof apiHost !== "string" || apiHost === "") throw new TypeError("A PostHog provider needs an apiHost.");
  const settings: FeatureSettings = readFeatureSettings(config.autocapture, config.replay);
  const anyFlag = settings.autocaptureOn || settings.replayOn;
  const name = `${POSTHOG_INSTANCE_PREFIX}${instanceSuffix()}`;

  let initStarted = false;
  let instance: PostHogLike | null = null;
  let eventNames: ReadonlySet<string> = new Set();
  let sanitizeUrl: ProviderInitContext["sanitizeUrl"] = () => null;
  let pending: PendingCapture | null = null;

  // C-67: the capture gate and the grant generation.
  let gateOpen = false;
  let generation = 0;
  let stopping = false;
  let deferredOptIn = false;
  let granting: number | null = null;
  let hasGranted = false;

  // C-68, C-69: replay state. `replayEligible` is decided once at init.
  let replayEligible = false;
  let replayOffForPage = false;
  let replayStarted = false;
  let replayGeneration = -1;
  let recordedSessionId: string | null = null;
  let tainted = false;
  const sessionIdsSeen = new Set<string>();

  // ------------------------------------------------------------- replay

  /** Condition 4: the instance holds the forced recording options, compared by value. Read fresh each time. */
  function recordingConfigHeld(target: PostHogLike): boolean {
    try {
      const held = target.config?.session_recording;
      if (held === null || typeof held !== "object") return false;
      const expected = expectedRecordingOptions(settings.hostSelectors);
      for (const [option, value] of Object.entries(expected)) {
        if (!has(held, option) || (held as Record<string, unknown>)[option] !== value) return false;
      }
      return target.config?.enable_recording_console_log === false;
    } catch {
      return false;
    }
  }

  function hasReplayMethods(target: PostHogLike): boolean {
    return (
      typeof target.startSessionRecording === "function" &&
      typeof target.stopSessionRecording === "function" &&
      typeof target.reset === "function" &&
      typeof target.get_session_id === "function"
    );
  }

  /** Condition 5: the probe, called once inside a `try`, reports all eight fields exactly `true`. */
  function probePasses(): boolean {
    if (settings.probe === null) return false;
    try {
      const report: unknown = settings.probe();
      if (report === null || typeof report !== "object") return false;
      if (typeof (report as { then?: unknown }).then === "function") return false;
      const fields = report as Record<string, unknown>;
      return REPLAY_CAPABILITY_FIELDS.every((field) => fields[field] === true);
    } catch {
      return false;
    }
  }

  function decideReplayEligibility(target: PostHogLike): boolean {
    if (!settings.replayOn || settings.sampleRate <= 0) return false;
    if (!settings.selectorsValid) return false;
    if (!hasReplayMethods(target)) return false;
    if (!recordingConfigHeld(target)) return false;
    return probePasses();
  }

  /** Runs after the gate opens in `optIn`; each SDK call is followed by a generation check. */
  function startReplayIfAllowed(target: PostHogLike, grant: number): void {
    if (!replayEligible || replayOffForPage) return;
    const draw = drawSample();
    if (draw === null || draw >= settings.sampleRate) return;

    let sessionId: unknown;
    try {
      sessionId = target.get_session_id?.();
    } catch {
      return;
    }
    if (generation !== grant) return;
    if (typeof sessionId !== "string" || sessionId === "" || sessionIdsSeen.has(sessionId)) return;

    // The read-back repeats immediately before every start; a mismatch ends replay for the page load.
    if (!recordingConfigHeld(target)) {
      replayOffForPage = true;
      return;
    }
    if (generation !== grant || !gateOpen) return;

    sessionIdsSeen.add(sessionId);
    recordedSessionId = sessionId;
    replayGeneration = grant;
    replayStarted = true;
    swallow(() => target.startSessionRecording?.());
  }

  // --------------------------------------------------------------- hook

  /** The final steps every accepted event takes (C-65): rebuilt fields, delivery fields, class properties, URL fields. */
  function finish(
    input: CaptureResultLike,
    sdkProperties: Record<string, unknown>,
    classProperties: Readonly<Record<string, unknown>>,
    referrerOrigin: string | undefined,
  ): unknown {
    const rawUrl = sdkProperties.$current_url;
    if (typeof rawUrl !== "string") return null;
    const url = sanitizeUrl(rawUrl);
    if (url === null) return null;
    const host = hostOf(url);
    const pathname = pathOf(url);
    if (host === null || pathname === null) return null;

    const properties: Record<string, unknown> = {};
    for (const field of DELIVERY_FIELDS) {
      if (has(sdkProperties, field)) properties[field] = sdkProperties[field];
    }
    properties.$current_url = url;
    properties.$pathname = pathname;
    properties.$host = host;
    if (referrerOrigin !== undefined) {
      const referringDomain = hostOf(referrerOrigin);
      if (referringDomain !== null) {
        properties.$referrer = referrerOrigin;
        properties.$referring_domain = referringDomain;
      }
    }
    for (const [field, value] of Object.entries(classProperties)) {
      if (!has(properties, field)) properties[field] = value;
    }

    const output: Record<string, unknown> = {};
    for (const field of POSTHOG_EVENT_FIELDS) {
      if (has(input, field)) output[field] = input[field];
    }
    output.properties = properties;
    return output;
  }

  function snapshotProperties(sdkProperties: Record<string, unknown>): Record<string, unknown> | null {
    // 1. the gate is open, replay started under the current generation, and the session id is the recorded one.
    if (!gateOpen || !replayStarted || replayGeneration !== generation || tainted) return null;
    if (recordedSessionId === null || sdkProperties.$session_id !== recordedSessionId) return null;

    // 4 (first half). The page and load addresses are read before the payload, so a tainted page latches at once.
    const pageAddress = readPageAddress();
    if (pageAddress === null || addressHasQueryOrFragment(pageAddress)) {
      tainted = true;
      return null;
    }
    const loadAddress = readLoadAddress();
    if (loadAddress === null || (loadAddress !== undefined && addressHasQueryOrFragment(loadAddress))) {
      tainted = true;
      return null;
    }

    // 2 and 3. The payload decodes and every value that can hold page text is masked.
    const scanned = scanReplayPayload(sdkProperties.$snapshot_data);
    if (!scanned.decoded || !scanned.masked) return null;

    // 4 (second half). Every address the payload carries, read before any rewrite.
    if (scanned.addresses.some(addressHasQueryOrFragment)) {
      tainted = true;
      return null;
    }

    // 5. Meta addresses are rewritten; custom records are removed.
    const records = finishReplayPayload(scanned.records, (href) => sanitizeUrl(href));
    if (records === null) return null;

    const properties: Record<string, unknown> = {
      $snapshot_data: records,
      $session_id: recordedSessionId,
    };
    const windowId = sdkProperties.$window_id;
    if (typeof windowId === "string" && windowId !== "" && windowId.length <= MAX_PROPERTY_STRING_LENGTH) {
      properties.$window_id = windowId;
    }
    return properties;
  }

  function beforeSend(result: unknown): unknown {
    if (result === null || typeof result !== "object") return null;
    const input = result as CaptureResultLike;
    const eventName = input.event;
    if (typeof eventName !== "string" || !gateOpen) return null;
    const sdkProperties =
      input.properties !== null && typeof input.properties === "object" ? (input.properties as Record<string, unknown>) : {};

    // Arm 1: a transport event, while the adapter's own capture call is still running.
    const current = pending;
    if (current !== null && current.name === eventName && eventNames.has(eventName)) {
      return finish(input, sdkProperties, current.properties, current.referrerOrigin);
    }

    // Arm 2: an SDK-originated class, only under its flag.
    if (eventName === "$autocapture" && settings.autocaptureOn) {
      const rebuilt = rebuildAutocapture(sdkProperties);
      if (rebuilt === null) return null;
      const kept: Record<string, unknown> = {};
      for (const field of POSTHOG_AUTOCAPTURE_PROPERTIES) {
        kept[field] = field === "$event_type" ? rebuilt.eventType : rebuilt.elementsChain;
      }
      return finish(input, sdkProperties, kept, undefined);
    }
    if (eventName === "$snapshot" && settings.replayOn) {
      const kept = snapshotProperties(sdkProperties);
      if (kept === null) return null;
      for (const field of Object.keys(kept)) {
        if (!POSTHOG_REPLAY_PROPERTIES.includes(field)) return null;
      }
      return finish(input, sdkProperties, kept, undefined);
    }
    return null;
  }

  // ------------------------------------------------------------- port

  function runOptIn(target: PostHogLike): void {
    const grant = ++generation;
    granting = grant;
    try {
      const regrant = hasGranted;
      hasGranted = true;
      gateOpen = false;
      replayStarted = false;
      recordedSessionId = null;
      tainted = false;

      if (regrant && anyFlag) {
        target.reset?.();
        if (generation !== grant) return;
      }
      target.opt_in_capturing();
      if (generation !== grant) return;
      gateOpen = true;
      startReplayIfAllowed(target, grant);
    } finally {
      if (granting === grant) granting = null;
    }
  }

  function runOptOut(target: PostHogLike): void {
    // Step 1: close the gate and advance the generation, before any SDK call.
    gateOpen = false;
    generation += 1;
    stopping = true;
    try {
      const wasStarted = replayStarted;
      replayStarted = false;
      recordedSessionId = null;
      pending = null;
      // Steps 2 to 4: each error is swallowed and no step is skipped.
      if (wasStarted) swallow(() => target.stopSessionRecording?.());
      swallow(() => target.opt_out_capturing());
      if (anyFlag) swallow(() => target.reset?.());
    } finally {
      stopping = false;
    }
  }

  const port: AnalyticsProviderPort = {
    init(context: ProviderInitContext): void {
      if (initStarted) throw new Error("A PostHog provider is initialized once.");
      initStarted = true;
      eventNames = new Set(context.eventNames);
      sanitizeUrl = (href) => context.sanitizeUrl(href);
      const sdkConfig: Record<string, unknown> = { ...buildForcedConfig(settings), api_host: apiHost, before_send: beforeSend };
      const returned = sdk.init(key, sdkConfig, name);
      if (returned === undefined || returned === null || typeof returned !== "object") {
        throw new Error("PostHog init returned no instance.");
      }
      if (returned === sdk) {
        throw new Error("PostHog init returned the host-supplied object, not a named instance.");
      }
      if (returned.config?.before_send !== beforeSend) {
        throw new Error("PostHog init returned an instance this adapter did not configure.");
      }
      instance = returned;
      replayEligible = decideReplayEligibility(returned);
    },

    capture(event: SanitizedAnalyticsEvent): void {
      if (!instance || !gateOpen) return;
      const eventName = event.kind === "pageview" ? "$pageview" : event.name;
      const own: Record<string, string | number | boolean> = {};
      if (event.kind === "conversion") {
        for (const [field, value] of Object.entries(event.properties)) {
          // A transport property never overwrites a delivery or URL field.
          if (!POSTHOG_PROPERTY_ALLOWLIST.includes(field) && !field.startsWith("$")) own[field] = value;
        }
      }
      const sent: Record<string, unknown> = { ...own, $current_url: event.url };
      if (event.referrerOrigin !== undefined) sent.$referrer = event.referrerOrigin;
      pending = { name: eventName, referrerOrigin: event.referrerOrigin, properties: Object.freeze(own) };
      try {
        instance.capture(eventName, sent);
      } finally {
        pending = null;
      }
    },

    optIn(): void {
      if (!instance) return;
      // An optIn() during the stop steps runs afterwards, as a re-grant.
      if (stopping) {
        deferredOptIn = true;
        return;
      }
      // An optIn() inside a grant that no withdrawal has interrupted changes nothing.
      if (granting !== null && granting === generation) return;
      runOptIn(instance);
    },

    optOut(): void {
      if (!instance) return;
      // An optOut() during the stop steps does nothing: the steps are already running.
      if (stopping) return;
      runOptOut(instance);
      if (deferredOptIn) {
        deferredOptIn = false;
        port.optIn();
      }
    },
  };
  return port;
}
