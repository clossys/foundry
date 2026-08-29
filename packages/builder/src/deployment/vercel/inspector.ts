import { VercelInspectionError } from "./errors.js";
import type { VercelDeploymentState, VercelDomainCheck, VercelDomainState, VercelFetch, VercelInspection, VercelInspectionInput, VercelInspectionResult, VercelInspectorOptions, VercelTokenProvider } from "./types.js";

type JsonObject = Record<string, unknown>;

type NormalizedInput = {
  readonly project: string;
  readonly teamId?: string;
  readonly expectedDomains: readonly string[];
  readonly maxDomainPages: number;
  readonly signal?: AbortSignal;
};

type NormalizedOptions = {
  readonly fetch: VercelFetch;
  readonly getBearerToken: VercelTokenProvider;
  readonly base: URL;
};

type DomainPage = {
  readonly domains: readonly { readonly name: string; readonly status: VercelDomainState }[];
  readonly next?: string;
};

const domainLabel = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const domainExpression = new RegExp(`^(?:\\*\\.)?(?:${domainLabel}\\.)+${domainLabel}$`);

function object(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function baseUrl(value: unknown): URL {
  try {
    if (value !== undefined && typeof value !== "string") throw new Error();
    const url = new URL(value ?? "https://api.vercel.com");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error();
    return url;
  } catch {
    throw new VercelInspectionError("invalid-base-url");
  }
}

function normalizedIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 256 && !/[\u0000-\u001F\u007F]/.test(normalized) ? normalized : undefined;
}

function normalizedDomain(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  // Permit a DNS name or a Vercel wildcard domain. The expression accepts
  // punycode labels while rejecting paths, ports, credentials, and URLs.
  return domain.length <= 253 && domainExpression.test(domain) ? domain : undefined;
}

function validAbortSignal(value: unknown): value is AbortSignal {
  return object(value) && typeof value.aborted === "boolean";
}

function normalizeInput(value: unknown): NormalizedInput | undefined {
  if (!object(value)) return undefined;
  const project = normalizedIdentifier(value.project);
  const teamId = value.teamId === undefined ? undefined : normalizedIdentifier(value.teamId);
  if (project === undefined || (value.teamId !== undefined && teamId === undefined)) return undefined;

  const maxDomainPages = value.maxDomainPages === undefined ? 20 : value.maxDomainPages;
  if (typeof maxDomainPages !== "number" || !Number.isInteger(maxDomainPages) || maxDomainPages < 1 || maxDomainPages > 100) return undefined;

  const expectedInput = value.expectedDomains === undefined ? [] : value.expectedDomains;
  if (!Array.isArray(expectedInput)) return undefined;
  const expectedDomains = expectedInput.map(normalizedDomain);
  if (expectedDomains.some((domain) => domain === undefined)) return undefined;
  const normalizedExpectedDomains = expectedDomains as string[];
  if (new Set(normalizedExpectedDomains).size !== normalizedExpectedDomains.length) return undefined;

  if (value.signal !== undefined && !validAbortSignal(value.signal)) return undefined;
  return {
    project,
    ...(teamId === undefined ? {} : { teamId }),
    expectedDomains: normalizedExpectedDomains,
    maxDomainPages,
    ...(value.signal === undefined ? {} : { signal: value.signal }),
  };
}

function normalizeOptions(value: unknown): NormalizedOptions {
  if (!object(value) || typeof value.fetch !== "function" || typeof value.getBearerToken !== "function") throw new VercelInspectionError("invalid-input");
  return {
    fetch: value.fetch as VercelFetch,
    getBearerToken: value.getBearerToken as VercelTokenProvider,
    base: baseUrl(value.apiBaseUrl),
  };
}

function validBearerToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 16_384 && value.trim() === value && !/\s/.test(value);
}

function providerError(statusCode: number): VercelInspectionError {
  if (statusCode === 401 || statusCode === 403) return new VercelInspectionError("unauthorized", statusCode);
  if (statusCode === 429) return new VercelInspectionError("rate-limited", statusCode);
  return new VercelInspectionError("http", statusCode);
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    if (typeof response.json !== "function") throw new Error();
    return await response.json();
  } catch {
    throw new VercelInspectionError("invalid-response");
  }
}

function deploymentState(value: unknown): VercelDeploymentState {
  if (!object(value)) throw new VercelInspectionError("invalid-response");
  const state = nonEmptyString(value.readyState);
  if (state === undefined) throw new VercelInspectionError("invalid-response");
  if (state === "READY") return "ready";
  if (["QUEUED", "INITIALIZING", "BUILDING"].includes(state)) return "pending";
  if (["ERROR", "CANCELED"].includes(state)) return "failed";
  return "unknown";
}

function decodeDomainPage(payload: unknown): DomainPage {
  if (!object(payload) || !Array.isArray(payload.domains)) throw new VercelInspectionError("invalid-response");
  const domains = payload.domains.map((item) => {
    if (!object(item)) throw new VercelInspectionError("invalid-response");
    const name = normalizedDomain(item.name);
    if (name === undefined) throw new VercelInspectionError("invalid-response");
    const status: VercelDomainState = item.verified === true ? "present" : item.verified === false ? "unverified" : "unknown";
    return { name, status };
  });

  if (payload.pagination === undefined) return { domains };
  if (!object(payload.pagination)) throw new VercelInspectionError("invalid-response");
  const next = payload.pagination.next;
  if (next === undefined || next === null) return { domains };
  if (typeof next === "number" && Number.isFinite(next)) return { domains, next: String(next) };
  if (typeof next === "string" && next.length > 0) return { domains, next };
  throw new VercelInspectionError("invalid-response");
}

function addTeam(url: URL, teamId: string | undefined): URL {
  if (teamId !== undefined) url.searchParams.set("teamId", teamId);
  return url;
}

function mergeDomainState(previous: VercelDomainState | undefined, current: VercelDomainState): VercelDomainState {
  return previous === undefined || previous === current ? current : "unknown";
}

/**
 * Runs the actual inspection: the project lookup, the deployment lookup, and
 * however many domain pages are needed. Every request-and-parse step in here
 * can throw `VercelInspectionError`, and that is deliberate -- `inspect`
 * below is the single place that decides which of those throws are a real
 * finding it lets propagate (`unauthorized`, `rate-limited`, an unrecognized
 * `http` status: the provider responded, coherently, with something bad) and
 * which are folded into `VercelInspectionIndeterminate` (`network`,
 * `invalid-response`: the inspector never got a response it could read at
 * all). Keeping that single decision point in `inspect` is what keeps this
 * function free to throw eagerly and stay readable, exactly like
 * `parseManifestNames` throwing freely under `detectSupersession` in
 * `@clossys/integrator`.
 */
async function performInspection(normalizedInput: NormalizedInput, normalizedOptions: NormalizedOptions, token: string): Promise<VercelInspection> {
  const request = async (url: URL): Promise<Response> => {
    if (normalizedInput.signal?.aborted) throw new VercelInspectionError("aborted");
    let response: Response;
    try {
      response = await normalizedOptions.fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        credentials: "omit",
        redirect: "error",
        signal: normalizedInput.signal,
      });
    } catch (error) {
      if (normalizedInput.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw new VercelInspectionError("aborted");
      throw new VercelInspectionError("network");
    }
    try {
      if (typeof response.ok !== "boolean" || !Number.isInteger(response.status) || response.status < 0) throw new Error();
      if (!response.ok) throw providerError(response.status);
      return response;
    } catch (error) {
      if (error instanceof VercelInspectionError) throw error;
      throw new VercelInspectionError("invalid-response");
    }
  };

  const projectUrl = addTeam(new URL(`/v9/projects/${encodeURIComponent(normalizedInput.project)}`, normalizedOptions.base), normalizedInput.teamId);
  let project: unknown;
  try {
    project = await parseJson(await request(projectUrl));
  } catch (error) {
    if (error instanceof VercelInspectionError && error.kind === "http" && error.statusCode === 404) return { kind: "inspected", project: "missing", deployment: "none", domains: [] };
    throw error;
  }
  if (!object(project) || nonEmptyString(project.id) === undefined) throw new VercelInspectionError("invalid-response");
  const projectId = project.id as string;

  const deploymentUrl = addTeam(new URL("/v6/deployments", normalizedOptions.base), normalizedInput.teamId);
  deploymentUrl.searchParams.set("projectId", projectId);
  deploymentUrl.searchParams.set("target", "production");
  deploymentUrl.searchParams.set("limit", "1");
  const deployments = await parseJson(await request(deploymentUrl));
  if (!object(deployments) || !Array.isArray(deployments.deployments)) throw new VercelInspectionError("invalid-response");
  const deployment = deployments.deployments.length === 0 ? "none" : deploymentState(deployments.deployments[0]);

  const found = new Map<string, VercelDomainState>();
  let until: string | undefined;
  const seenCursors = new Set<string>();
  let domainsComplete = normalizedInput.expectedDomains.length === 0;
  for (let page = 0; page < normalizedInput.maxDomainPages && normalizedInput.expectedDomains.some((domain) => !found.has(domain)); page += 1) {
    const domainsUrl = addTeam(new URL(`/v9/projects/${encodeURIComponent(normalizedInput.project)}/domains`, normalizedOptions.base), normalizedInput.teamId);
    domainsUrl.searchParams.set("limit", "100");
    if (until !== undefined) domainsUrl.searchParams.set("until", until);
    const domainPage = decodeDomainPage(await parseJson(await request(domainsUrl)));
    for (const item of domainPage.domains) {
      if (normalizedInput.expectedDomains.includes(item.name)) found.set(item.name, mergeDomainState(found.get(item.name), item.status));
    }
    if (normalizedInput.expectedDomains.every((domain) => found.has(domain)) || domainPage.next === undefined) {
      domainsComplete = true;
      break;
    }
    if (seenCursors.has(domainPage.next)) break;
    seenCursors.add(domainPage.next);
    until = domainPage.next;
  }

  const domains: VercelDomainCheck[] = normalizedInput.expectedDomains.map((domain) => ({
    domain,
    status: found.get(domain) ?? (domainsComplete ? "missing" : "unknown"),
  }));
  return { kind: "inspected", project: "present", deployment, domains };
}

/**
 * Creates a GET-only inspector. Credentials are obtained only when inspect
 * is called.
 *
 * A response `performInspection` could not read at all -- a transport
 * failure (`network`), or a response body that does not shape up the way
 * the provider's own contract promises (`invalid-response`) -- is not a
 * deployment that failed. It is a state this inspector could not form an
 * opinion about, so it is reported as `VercelInspectionIndeterminate` here,
 * never thrown out of this public entry point, and never silently folded
 * into a healthy-looking `VercelInspection`. This is the exact fold
 * `@clossys/integrator`'s `resolveReachability` applies to a
 * transport failure and a malformed registry body (both `unreachable`) --
 * see that module's header for the fuller reasoning.
 *
 * Every other `VercelInspectionError` `performInspection` can throw stays a
 * throw: `unauthorized` and `rate-limited` are the provider affirmatively
 * responding with something real (a genuine finding, not an unreadable one),
 * and `invalid-input` / `invalid-base-url` / `credential-unavailable` /
 * `aborted` are never about what a provider said at all.
 */
export function createVercelInspector(options: VercelInspectorOptions): { inspect(input: VercelInspectionInput): Promise<VercelInspectionResult> } {
  const normalizedOptions = normalizeOptions(options);
  return {
    async inspect(input: VercelInspectionInput): Promise<VercelInspectionResult> {
      const normalizedInput = normalizeInput(input);
      if (normalizedInput === undefined) throw new VercelInspectionError("invalid-input");
      if (normalizedInput.signal?.aborted) throw new VercelInspectionError("aborted");

      let token: unknown;
      try {
        token = await normalizedOptions.getBearerToken(normalizedInput.signal);
      } catch {
        throw new VercelInspectionError("credential-unavailable");
      }
      if (!validBearerToken(token)) throw new VercelInspectionError("credential-unavailable");

      try {
        return await performInspection(normalizedInput, normalizedOptions, token);
      } catch (error) {
        if (error instanceof VercelInspectionError && (error.kind === "network" || error.kind === "invalid-response")) {
          return { kind: "indeterminate", reason: error.kind, detail: error.message };
        }
        throw error;
      }
    },
  };
}
