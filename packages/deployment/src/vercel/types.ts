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
  readonly project: "present" | "missing";
  readonly deployment: VercelDeploymentState;
  readonly domains: readonly VercelDomainCheck[];
};

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
