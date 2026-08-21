/** Read-only Vercel inspection contracts. No provider response bodies are exposed. */
export type VercelFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type VercelTokenProvider = (signal?: AbortSignal) => string | Promise<string>;

export type VercelInspectorOptions = {
  readonly fetch: VercelFetch;
  readonly getBearerToken: VercelTokenProvider;
  readonly apiBaseUrl?: string;
};

export type VercelInspectionInput = {
  readonly project: string;
  readonly teamId?: string;
  readonly expectedDomains?: readonly string[];
  readonly maxDomainPages?: number;
  readonly signal?: AbortSignal;
};

export type VercelDeploymentState = "ready" | "pending" | "failed" | "unknown" | "none";
export type VercelDomainState = "present" | "missing" | "unverified" | "unknown";

export type VercelDomainCheck = {
  readonly domain: string;
  readonly status: VercelDomainState;
};

export type VercelInspection = {
  readonly kind: "inspected";
  readonly project: "present" | "missing";
  readonly deployment: VercelDeploymentState;
  readonly domains: readonly VercelDomainCheck[];
};

/**
 * Why `inspect` could not form an opinion at all -- a response it received
 * but could not parse into the shape it expects (`invalid-response`), or
 * never received a response for at all (`network`). Distinct from a
 * `VercelInspectionError` the provider's own status code explains
 * (`unauthorized`, `rate-limited`, an unrecognized `http` status): those are
 * the provider telling the caller something real, and stay thrown rather
 * than folded in here. See `inspector.ts`'s own header for the full
 * reasoning, mirrored from `@vespeneventures/integrator`'s
 * `resolveReachability`.
 */
export type VercelInspectionIndeterminateReason = "network" | "invalid-response";

export type VercelInspectionIndeterminate = {
  readonly kind: "indeterminate";
  readonly reason: VercelInspectionIndeterminateReason;
  readonly detail?: string;
};

/** What `inspect` actually resolves to. Never a bare `VercelInspection` -- see `VercelInspectionIndeterminate`'s doc comment. */
export type VercelInspectionResult = VercelInspection | VercelInspectionIndeterminate;

export type VercelInspectionErrorKind =
  | "credential-unavailable"
  | "invalid-input"
  | "invalid-base-url"
  | "aborted"
  | "network"
  | "unauthorized"
  | "rate-limited"
  | "http"
  | "invalid-response";
