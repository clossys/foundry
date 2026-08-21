import { RenderInspectionError } from "./errors.js";
import type { RenderDeploymentState, RenderDomainCheck, RenderFetch, RenderInspection, RenderInspectionInput, RenderInspectionResult, RenderInspectorOptions, RenderTokenProvider } from "./types.js";

type JsonObject = Record<string, unknown>;

type NormalizedOptions = {
  readonly fetch: RenderFetch;
  readonly getBearerToken: RenderTokenProvider;
  readonly base: URL;
};

function object(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function baseUrl(value: unknown): URL {
  try {
    if (value !== undefined && typeof value !== "string") throw new Error();
    const url = new URL(value ?? "https://api.render.com");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error();
    return url;
  } catch {
    throw new RenderInspectionError("invalid-base-url");
  }
}

function validAbortSignal(value: unknown): value is AbortSignal {
  return object(value) && typeof value.aborted === "boolean";
}

function normalizeOptions(value: unknown): NormalizedOptions {
  if (!object(value) || typeof value.fetch !== "function" || typeof value.getBearerToken !== "function") throw new RenderInspectionError("invalid-input");
  return {
    fetch: value.fetch as RenderFetch,
    getBearerToken: value.getBearerToken as RenderTokenProvider,
    base: baseUrl(value.apiBaseUrl),
  };
}

function normalizedDomain(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  return domain.length > 0 && !/[/?#@\s]/.test(domain) ? domain : undefined;
}

function validInput(input: unknown): input is RenderInspectionInput {
  if (!object(input) || typeof input.service !== "string") return false;
  if (input.service.trim().length === 0) return false;
  if (input.maxPages !== undefined && (typeof input.maxPages !== "number" || !Number.isInteger(input.maxPages) || input.maxPages < 1 || input.maxPages > 100)) return false;
  if (input.signal !== undefined && !validAbortSignal(input.signal)) return false;
  if (input.expectedDomains === undefined) return true;
  if (!Array.isArray(input.expectedDomains)) return false;
  const domains = input.expectedDomains.map(normalizedDomain);
  return domains.every((domain) => domain !== undefined) && new Set(domains).size === domains.length;
}

function providerError(statusCode: number): RenderInspectionError {
  if (statusCode === 401 || statusCode === 403) return new RenderInspectionError("unauthorized", statusCode);
  if (statusCode === 429) return new RenderInspectionError("rate-limited", statusCode);
  return new RenderInspectionError("http", statusCode);
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new RenderInspectionError("invalid-response");
  }
}

/**
 * Render list endpoints return arrays of `{ cursor, resource }` envelopes.
 * A cursor belongs to the envelope (not the resource) and the final cursor is
 * the only safe value for the following request.
 */
function page(payload: unknown, resourceKey: "deploy" | "customDomain"): { readonly resources: readonly JsonObject[]; readonly cursor?: string } {
  if (!Array.isArray(payload)) throw new RenderInspectionError("invalid-response");
  const resources: JsonObject[] = [];
  let cursor: string | undefined;
  for (const item of payload) {
    if (!object(item) || string(item.cursor) === undefined || !object(item[resourceKey])) throw new RenderInspectionError("invalid-response");
    resources.push(item[resourceKey]);
    cursor = item.cursor as string;
  }
  return { resources, ...(cursor === undefined ? {} : { cursor }) };
}

function deploymentState(value: unknown): RenderDeploymentState {
  if (!object(value)) throw new RenderInspectionError("invalid-response");
  const state = string(value.status);
  if (state === undefined) throw new RenderInspectionError("invalid-response");
  if (state === "live") return "live";
  if (["created", "queued", "build_in_progress", "pre_deploy_in_progress", "update_in_progress"].includes(state)) return "pending";
  if (["build_failed", "pre_deploy_failed", "update_failed", "canceled"].includes(state)) return "failed";
  return "unknown";
}

function serviceHealth(service: JsonObject): "healthy" | "unhealthy" | "unknown" {
  // Render's documented `suspended` value is a string enum, not a boolean.
  if (service.suspended === "suspended") return "unhealthy";
  return "unknown";
}

/**
 * Runs the actual inspection: the service lookup, the deploy lookup, and
 * however many custom-domain pages are needed. Every request-and-parse step
 * in here can throw `RenderInspectionError`, and that is deliberate --
 * `inspect` below is the single place that decides which of those throws are
 * a real finding it lets propagate (`unauthorized`, `rate-limited`, an
 * unrecognized `http` status: the provider responded, coherently, with
 * something bad) and which are folded into `RenderInspectionIndeterminate`
 * (`network`, `invalid-response`: the inspector never got a response it
 * could read at all). Keeping that single decision point in `inspect` is
 * what keeps this function free to throw eagerly and stay readable, exactly
 * like `parseManifestNames` throwing freely under `detectSupersession` in
 * `@vespeneventures/integrator`.
 */
async function performInspection(input: RenderInspectionInput, normalizedOptions: NormalizedOptions, token: string): Promise<RenderInspection> {
  const request = async (url: URL): Promise<Response> => {
    if (input.signal?.aborted) throw new RenderInspectionError("aborted");
    try {
      const response = await normalizedOptions.fetch(url, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, credentials: "omit", redirect: "error", signal: input.signal });
      if (!response.ok) throw providerError(response.status);
      return response;
    } catch (error) {
      if (error instanceof RenderInspectionError) throw error;
      if (input.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw new RenderInspectionError("aborted");
      throw new RenderInspectionError("network");
    }
  };
  const serviceUrl = new URL(`/v1/services/${encodeURIComponent(input.service.trim())}`, normalizedOptions.base);
  let service: unknown;
  try {
    service = await parseJson(await request(serviceUrl));
  } catch (error) {
    if (error instanceof RenderInspectionError && error.kind === "http" && error.statusCode === 404) return { kind: "inspected", service: "missing", deployment: "none", serviceHealth: "unknown", domains: [] };
    throw error;
  }
  if (!object(service) || string(service.id) === undefined) throw new RenderInspectionError("invalid-response");
  const serviceId = string(service.id) as string;
  const deployUrl = new URL(`/v1/services/${encodeURIComponent(serviceId)}/deploys`, normalizedOptions.base);
  deployUrl.searchParams.set("limit", "100");
  const deploys = page(await parseJson(await request(deployUrl)), "deploy").resources;
  const deployment = deploys.length === 0 ? "none" : deploymentState(deploys[0]);
  const expected = (input.expectedDomains ?? []).map((domain) => normalizedDomain(domain) as string);
  const found = new Map<string, boolean | undefined>();
  let domainsComplete = expected.length === 0;
  if (expected.length > 0) {
    let cursor: string | undefined;
    for (let index = 0; index < (input.maxPages ?? 20) && expected.some((domain) => !found.has(domain)); index += 1) {
      const domainsUrl = new URL(`/v1/services/${encodeURIComponent(serviceId)}/custom-domains`, normalizedOptions.base);
      domainsUrl.searchParams.set("limit", "100");
      if (cursor !== undefined) domainsUrl.searchParams.set("cursor", cursor);
      const domainPage = page(await parseJson(await request(domainsUrl)), "customDomain");
      for (const item of domainPage.resources) {
        const name = string(item.name);
        const domain = name === undefined ? undefined : normalizedDomain(name);
        if (domain !== undefined && expected.includes(domain)) {
          const verificationStatus = string(item.verificationStatus);
          found.set(domain, verificationStatus === "verified" ? true : verificationStatus === "unverified" ? false : undefined);
        }
      }
      if (expected.every((domain) => found.has(domain)) || domainPage.cursor === undefined) {
        domainsComplete = true;
        break;
      }
      if (domainPage.cursor === cursor) break;
      cursor = domainPage.cursor;
    }
  }
  const domainChecks: RenderDomainCheck[] = expected.map((domain) => {
    const verification = found.get(domain);
    const status = !found.has(domain)
      ? domainsComplete ? "missing" : "unknown"
      : verification === true ? "present" : verification === false ? "unverified" : "unknown";
    return { domain, status };
  });
  return { kind: "inspected", service: "present", deployment, serviceHealth: serviceHealth(service), domains: domainChecks };
}

/**
 * Creates a GET-only inspector. Credentials are obtained only when inspect
 * is called.
 *
 * A response `performInspection` could not read at all -- a transport
 * failure (`network`), or a response body that does not shape up the way
 * the provider's own contract promises (`invalid-response`) -- is not a
 * deployment that failed. It is a state this inspector could not form an
 * opinion about, so it is reported as `RenderInspectionIndeterminate` here,
 * never thrown out of this public entry point, and never silently folded
 * into a healthy-looking `RenderInspection`. This is the exact fold
 * `@vespeneventures/integrator`'s `resolveReachability` applies to a
 * transport failure and a malformed registry body (both `unreachable`) --
 * see that module's header for the fuller reasoning.
 *
 * Every other `RenderInspectionError` `performInspection` can throw stays a
 * throw: `unauthorized` and `rate-limited` are the provider affirmatively
 * responding with something real (a genuine finding, not an unreadable
 * one), and `invalid-input` / `invalid-base-url` / `credential-unavailable`
 * / `aborted` are never about what a provider said at all.
 */
export function createRenderInspector(options: RenderInspectorOptions): { inspect(input: RenderInspectionInput): Promise<RenderInspectionResult> } {
  const normalizedOptions = normalizeOptions(options);
  return {
    async inspect(input: RenderInspectionInput): Promise<RenderInspectionResult> {
      if (!validInput(input)) throw new RenderInspectionError("invalid-input");
      if (input.signal?.aborted) throw new RenderInspectionError("aborted");
      let token: unknown;
      try {
        token = await normalizedOptions.getBearerToken(input.signal);
      } catch {
        throw new RenderInspectionError("credential-unavailable");
      }
      if (typeof token !== "string" || token.trim().length === 0) throw new RenderInspectionError("credential-unavailable");

      try {
        return await performInspection(input, normalizedOptions, token);
      } catch (error) {
        if (error instanceof RenderInspectionError && (error.kind === "network" || error.kind === "invalid-response")) {
          return { kind: "indeterminate", reason: error.kind, detail: error.message };
        }
        throw error;
      }
    },
  };
}
