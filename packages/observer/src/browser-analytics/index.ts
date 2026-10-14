/**
 * Internal barrel for the consent-controlled analytics transport.
 *
 * Not reachable from the Observer root (O-4): the root never imports this
 * subtree. The provider adapter is deliberately not re-exported here; it
 * lives in its own module so that importing the transport never reaches it
 * (O-5). The package exposes this barrel as `./browser-analytics` and the
 * adapter alone as `./browser-analytics/posthog` (`providers/index.ts`).
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
