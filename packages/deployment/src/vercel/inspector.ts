import { VercelInspectionError } from "./errors.js";
import type { VercelDeploymentState, VercelDomainCheck, VercelInspection, VercelInspectionInput, VercelInspectorOptions } from "./types.js";

type JsonObject = Record<string, unknown>;

function object(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function baseUrl(value: string | undefined): URL {
  try {
    const url = new URL(value ?? "https://api.vercel.com");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error();
    return url;
  } catch {
    throw new VercelInspectionError("invalid-base-url");
  }
}

function normalizedDomain(value: string): string | undefined {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  return domain.length > 0 && !/[/?#@\s]/.test(domain) ? domain : undefined;
}

function inputIsValid(input: VercelInspectionInput): boolean {
  return input.project.trim().length > 0
    && (input.teamId === undefined || input.teamId.trim().length > 0)
    && (input.maxDomainPages === undefined || (Number.isInteger(input.maxDomainPages) && input.maxDomainPages >= 1 && input.maxDomainPages <= 100))
    && (input.expectedDomains === undefined || input.expectedDomains.every((domain) => normalizedDomain(domain) !== undefined));
}

function providerError(statusCode: number): VercelInspectionError {
  if (statusCode === 401 || statusCode === 403) return new VercelInspectionError("unauthorized", statusCode);
  if (statusCode === 429) return new VercelInspectionError("rate-limited", statusCode);
  return new VercelInspectionError("http", statusCode);
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new VercelInspectionError("invalid-response");
  }
}

function deploymentState(value: unknown): VercelDeploymentState {
  if (!object(value)) throw new VercelInspectionError("invalid-response");
  const state = string(value.readyState);
  if (state === undefined) throw new VercelInspectionError("invalid-response");
  if (state === "READY") return "ready";
  if (["QUEUED", "INITIALIZING", "BUILDING"].includes(state)) return "pending";
  if (["ERROR", "CANCELED"].includes(state)) return "failed";
  return "unknown";
}

function addTeam(url: URL, teamId: string | undefined): URL {
  if (teamId !== undefined) url.searchParams.set("teamId", teamId);
  return url;
}

/** Creates a GET-only inspector. Credentials are obtained only when inspect is called. */
export function createVercelInspector(options: VercelInspectorOptions): { inspect(input: VercelInspectionInput): Promise<VercelInspection> } {
  const base = baseUrl(options.apiBaseUrl);
  return {
    async inspect(input: VercelInspectionInput): Promise<VercelInspection> {
      if (!inputIsValid(input)) throw new VercelInspectionError("invalid-input");
      let token: string;
      try {
        token = await options.getBearerToken(input.signal);
      } catch {
        throw new VercelInspectionError("credential-unavailable");
      }
      if (token.trim().length === 0) throw new VercelInspectionError("credential-unavailable");
      const request = async (url: URL): Promise<Response> => {
        try {
          const response = await options.fetch(url, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, credentials: "omit", redirect: "error", signal: input.signal });
          if (!response.ok) throw providerError(response.status);
          return response;
        } catch (error) {
          if (error instanceof VercelInspectionError) throw error;
          if (input.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw new VercelInspectionError("aborted");
          throw new VercelInspectionError("network");
        }
      };
      const projectUrl = addTeam(new URL(`/v9/projects/${encodeURIComponent(input.project)}`, base), input.teamId);
      let project: unknown;
      try {
        project = await parseJson(await request(projectUrl));
      } catch (error) {
        if (error instanceof VercelInspectionError && error.kind === "http" && error.statusCode === 404) return { project: "missing", deployment: "none", domains: [] };
        throw error;
      }
      if (!object(project) || string(project.id) === undefined) throw new VercelInspectionError("invalid-response");
      const deploymentUrl = addTeam(new URL("/v6/deployments", base), input.teamId);
      deploymentUrl.searchParams.set("projectId", project.id as string);
      deploymentUrl.searchParams.set("target", "production");
      deploymentUrl.searchParams.set("limit", "1");
      const deployments = await parseJson(await request(deploymentUrl));
      if (!object(deployments) || !Array.isArray(deployments.deployments)) throw new VercelInspectionError("invalid-response");
      const deployment = deployments.deployments.length === 0 ? "none" : deploymentState(deployments.deployments[0]);
      const expected = (input.expectedDomains ?? []).map((domain) => normalizedDomain(domain) as string);
      const found = new Map<string, boolean | undefined>();
      let until: string | undefined;
      const pages = input.maxDomainPages ?? 20;
      let domainsComplete = expected.length === 0;
      for (let page = 0; page < pages && expected.some((domain) => !found.has(domain)); page += 1) {
        const domainsUrl = addTeam(new URL(`/v9/projects/${encodeURIComponent(input.project)}/domains`, base), input.teamId);
        domainsUrl.searchParams.set("limit", "100");
        if (until !== undefined) domainsUrl.searchParams.set("until", until);
        const payload = await parseJson(await request(domainsUrl));
        if (!object(payload) || !Array.isArray(payload.domains)) throw new VercelInspectionError("invalid-response");
        for (const item of payload.domains) {
          if (!object(item)) continue;
          const name = string(item.name);
          const domain = name === undefined ? undefined : normalizedDomain(name);
          if (domain !== undefined && expected.includes(domain)) found.set(domain, item.verified === false ? false : true);
        }
        const next = object(payload.pagination) ? payload.pagination.next : undefined;
        const nextCursor = typeof next === "number" || typeof next === "string" ? String(next) : undefined;
        if (expected.every((domain) => found.has(domain)) || nextCursor === undefined) {
          domainsComplete = true;
          break;
        }
        if (nextCursor === until) break;
        until = nextCursor;
      }
      const domains: VercelDomainCheck[] = expected.map((domain) => ({ domain, status: !found.has(domain) ? domainsComplete ? "missing" : "unknown" : found.get(domain) === false ? "unverified" : "present" }));
      return { project: "present", deployment, domains };
    },
  };
}
