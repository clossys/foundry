/**
 * Shared types for the consent-controlled analytics transport.
 *
 * This subtree is network-capable only through ports a host injects. It
 * declares every shape structurally, uses no DOM type and touches no global
 * at module scope, so importing it performs no I/O.
 */

/** Where an event happened, as the host read it. Nothing here is sent as given. */
export interface AnalyticsLocation {
  href: string;
  referrer?: string;
}

/** What the transport hands a provider when it initializes it. */
export interface ProviderInitContext {
  /** The transport's own URL rules: origin and path only, normalized path validated. */
  sanitizeUrl(href: string): string | null;
  /** `"$pageview"` plus the allowed conversion names. */
  eventNames: readonly string[];
}

/** A provider adapter. The transport is its only caller. */
export interface AnalyticsProviderPort {
  /** Throws if the provider cannot be set up safely. */
  init(context: ProviderInitContext): void;
  capture(event: SanitizedAnalyticsEvent): void;
  optIn(): void;
  /** Stop sending and clear provider persistence. */
  optOut(): void;
}

/** An event after redaction: the only shape that ever reaches a provider. */
export type SanitizedAnalyticsEvent =
  | {
      kind: "pageview";
      url: string;
      referrerOrigin?: string;
      properties: Readonly<Record<string, never>>;
    }
  | {
      kind: "conversion";
      name: string;
      url: string;
      referrerOrigin?: string;
      properties: Readonly<Record<string, string | number | boolean>>;
    };

/** The consent-controlled transport a host binds to its consent lifecycle. */
export interface AnalyticsTransport {
  setPermission(allowed: boolean): void;
  pageview(location: AnalyticsLocation): void;
  conversion(name: string, location: AnalyticsLocation, properties?: Record<string, unknown>): void;
  dispose(): void;
}

/** Timer port. The default looks up the global timers when it schedules. */
export interface AnalyticsScheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Path normalizer supplied by the host, the single source of path normalization. */
export type NormalizePath = (pathname: string) => string;
