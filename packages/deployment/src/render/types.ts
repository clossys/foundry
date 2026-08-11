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
  readonly service: "present" | "missing";
  readonly deployment: RenderDeploymentState;
  readonly serviceHealth: "healthy" | "unhealthy" | "unknown";
  readonly domains: readonly RenderDomainCheck[];
};

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
