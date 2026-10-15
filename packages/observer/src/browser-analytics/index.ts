/**
 * Public entry of the `./browser-analytics` subpath: the consent-controlled
 * analytics transport and the event sanitizer.
 *
 * Not reachable from the Observer root (O-4): the root never imports this
 * subtree. The provider adapter is deliberately not re-exported here; it
 * lives in its own module, shipped as the `./browser-analytics/posthog`
 * subpath, so that importing the transport never reaches it (O-5).
 */

export type {
  AnalyticsLocation,
  AnalyticsProviderPort,
  AnalyticsScheduler,
  AnalyticsTransport,
  NormalizePath,
  ProviderInitContext,
  SanitizedAnalyticsEvent,
} from "./types.js";
export type { AnalyticsAllowlist, AnalyticsEventInput } from "./sanitize.js";
export { MAX_PROPERTY_STRING_LENGTH, sanitizeAnalyticsEvent } from "./sanitize.js";
export type { AnalyticsTransportOptions, AnalyticsTransportState } from "./transport.js";
export { ANALYTICS_RETRY_DELAY_MS, DEFAULT_MAX_QUEUED, createAnalyticsTransport } from "./transport.js";
