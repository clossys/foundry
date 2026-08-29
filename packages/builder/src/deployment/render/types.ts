/** Read-only Render inspection contracts. No provider response bodies are exposed. */
export type RenderFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type RenderTokenProvider = (signal?: AbortSignal) => string | Promise<string>;

export type RenderInspectorOptions = {
  readonly fetch: RenderFetch;
  readonly getBearerToken: RenderTokenProvider;
  readonly apiBaseUrl?: string;
};

export type RenderInspectionInput = {
  readonly service: string;
  readonly expectedDomains?: readonly string[];
  readonly maxPages?: number;
  readonly signal?: AbortSignal;
};

export type RenderDeploymentState = "live" | "pending" | "failed" | "unknown" | "none";
export type RenderDomainState = "present" | "missing" | "unverified" | "unknown";

export type RenderDomainCheck = {
  readonly domain: string;
  readonly status: RenderDomainState;
};

export type RenderInspection = {
  readonly kind: "inspected";
  readonly service: "present" | "missing";
  readonly deployment: RenderDeploymentState;
  readonly serviceHealth: "healthy" | "unhealthy" | "unknown";
  readonly domains: readonly RenderDomainCheck[];
};

/**
 * Why `inspect` could not form an opinion at all -- a response it received
 * but could not parse into the shape it expects (`invalid-response`), or
 * never received a response for at all (`network`). Distinct from a
 * `RenderInspectionError` the provider's own status code explains
 * (`unauthorized`, `rate-limited`, an unrecognized `http` status): those are
 * the provider telling the caller something real, and stay thrown rather
 * than folded in here. See `inspector.ts`'s own header for the full
 * reasoning, mirrored from `@clossys/integrator`'s
 * `resolveReachability`.
 */
export type RenderInspectionIndeterminateReason = "network" | "invalid-response";

export type RenderInspectionIndeterminate = {
  readonly kind: "indeterminate";
  readonly reason: RenderInspectionIndeterminateReason;
  readonly detail?: string;
};

/** What `inspect` actually resolves to. Never a bare `RenderInspection` -- see `RenderInspectionIndeterminate`'s doc comment. */
export type RenderInspectionResult = RenderInspection | RenderInspectionIndeterminate;

export type RenderInspectionErrorKind =
  | "credential-unavailable"
  | "invalid-input"
  | "invalid-base-url"
  | "aborted"
  | "network"
  | "unauthorized"
  | "rate-limited"
  | "http"
  | "invalid-response";
