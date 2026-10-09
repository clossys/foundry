/**
 * PostHog provider adapter for the analytics transport (C-44).
 *
 * The package never imports the SDK (C-3). The host passes the SDK object it
 * loaded itself, typed by the structural `PostHogLike` subset below, plus its
 * own key and host. Nothing else a host passes can reach the SDK's
 * configuration.
 *
 * The adapter:
 *
 * - initializes a named instance whose name is unique to this adapter, and
 *   from then on calls methods only on the instance `init` returned, after
 *   checking that it carries this adapter's own `before_send` hook by
 *   identity. An SDK returns an already-loaded name's instance unchanged, so
 *   a reused instance (from the host or another adapter) is refused;
 * - forces every option in `FORCED_CONFIG`, so automatic capture, replay,
 *   surveys, experiments, feature flags and persistent storage stay off;
 * - captures a sanitized pageview as `$pageview` and a conversion under its
 *   allowlisted name;
 * - runs a `before_send` hook that drops every event the transport did not
 *   send, rebuilds the event from `POSTHOG_EVENT_FIELDS` alone (so
 *   person-property payloads such as `$set`, `$set_once` and `$unset` never
 *   pass), keeps only `POSTHOG_PROPERTY_ALLOWLIST` plus the transport's own
 *   properties, and overwrites every URL field from the sanitized URL. It recognizes a
 *   transport event only while the adapter's own `capture` call is on the
 *   stack, so an SDK that ran the hook later would have every event
 *   dropped: it fails closed.
 *
 * Whether these option and property names behave as named in the SDK
 * version a host installs is separate evidence; a fake cannot prove it.
 */

import type { AnalyticsProviderPort, ProviderInitContext, SanitizedAnalyticsEvent } from "../types.js";

/** The subset of the PostHog SDK object the adapter calls, declared structurally. */
export interface PostHogLike {
  init(apiKey: string, config: Record<string, unknown>, name: string): PostHogLike | undefined | void;
  /** Read only to check the instance identity. */
  readonly config?: { readonly before_send?: unknown };
  capture(eventName: string, properties?: Record<string, unknown>): unknown;
  opt_in_capturing(): void;
  opt_out_capturing(): void;
}

/** Host values the adapter accepts. There is no other option. */
export interface PostHogProviderConfig {
  key: string;
  apiHost: string;
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

/** Options written by the adapter alone, besides `api_host` and `before_send`. */
const FORCED_CONFIG: Readonly<Record<string, unknown>> = Object.freeze({
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

let adaptersCreated = 0;

/** A suffix unique to one adapter, generated when the adapter is created, never at import. */
function instanceSuffix(): string {
  adaptersCreated += 1;
  const words = new Uint32Array(2);
  const source = (globalThis as unknown as RandomSource).crypto;
  if (source && typeof source.getRandomValues === "function") {
    source.getRandomValues(words);
  } else {
    words[0] = Math.floor(Math.random() * 0x100000000);
    words[1] = Math.floor(Math.random() * 0x100000000);
  }
  return `${adaptersCreated.toString(36)}_${[...words].map((word) => word.toString(36)).join("")}`;
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

/**
 * Creates the adapter. It calls nothing on the SDK until the transport calls
 * `init(context)`.
 */
export function createPostHogProvider(sdk: PostHogLike, config: PostHogProviderConfig): AnalyticsProviderPort {
  // Each value is read once; the validated local is the one used.
  const key: unknown = config.key;
  const apiHost: unknown = config.apiHost;
  if (typeof key !== "string" || key === "") throw new TypeError("A PostHog provider needs a key.");
  if (typeof apiHost !== "string" || apiHost === "") throw new TypeError("A PostHog provider needs an apiHost.");
  const name = `${POSTHOG_INSTANCE_PREFIX}${instanceSuffix()}`;

  let initStarted = false;
  let instance: PostHogLike | null = null;
  let eventNames: ReadonlySet<string> = new Set();
  let sanitizeUrl: ProviderInitContext["sanitizeUrl"] = () => null;
  let pending: PendingCapture | null = null;

  function beforeSend(result: unknown): unknown {
    if (result === null || typeof result !== "object") return null;
    const input = result as CaptureResultLike;
    const eventName = input.event;
    // Only events the transport is sending right now pass; the SDK's own
    // events (an opt-in marker, automatic capture) are dropped.
    if (typeof eventName !== "string" || !eventNames.has(eventName)) return null;
    const current = pending;
    if (current === null || current.name !== eventName) return null;

    const sdkProperties =
      input.properties !== null && typeof input.properties === "object" ? (input.properties as Record<string, unknown>) : {};
    const rawUrl = sdkProperties.$current_url;
    if (typeof rawUrl !== "string") return null;
    const url = sanitizeUrl(rawUrl);
    if (url === null) return null;
    const host = hostOf(url);
    const pathname = pathOf(url);
    if (host === null || pathname === null) return null;

    const properties: Record<string, unknown> = {};
    for (const field of DELIVERY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(sdkProperties, field)) properties[field] = sdkProperties[field];
    }
    properties.$current_url = url;
    properties.$pathname = pathname;
    properties.$host = host;
    if (current.referrerOrigin !== undefined) {
      const referringDomain = hostOf(current.referrerOrigin);
      if (referringDomain !== null) {
        properties.$referrer = current.referrerOrigin;
        properties.$referring_domain = referringDomain;
      }
    }
    for (const [field, value] of Object.entries(current.properties)) {
      if (!Object.prototype.hasOwnProperty.call(properties, field)) properties[field] = value;
    }

    const output: Record<string, unknown> = {};
    for (const field of POSTHOG_EVENT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(input, field)) output[field] = input[field];
    }
    output.properties = properties;
    return output;
  }

  return {
    init(context: ProviderInitContext): void {
      if (initStarted) throw new Error("A PostHog provider is initialized once.");
      initStarted = true;
      eventNames = new Set(context.eventNames);
      sanitizeUrl = (href) => context.sanitizeUrl(href);
      const sdkConfig: Record<string, unknown> = { ...FORCED_CONFIG, api_host: apiHost, before_send: beforeSend };
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
    },

    capture(event: SanitizedAnalyticsEvent): void {
      if (!instance) return;
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
      instance?.opt_in_capturing();
    },

    optOut(): void {
      instance?.opt_out_capturing();
    },
  };
}
