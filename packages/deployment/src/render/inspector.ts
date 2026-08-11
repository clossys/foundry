import { RenderInspectionError } from "./errors.js";
import type { RenderDeploymentState, RenderDomainCheck, RenderInspection, RenderInspectionInput, RenderInspectorOptions } from "./types.js";

type JsonObject = Record<string, unknown>;

function object(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function baseUrl(value: string | undefined): URL {
  try {
    const url = new URL(value ?? "https://api.render.com");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error();
    return url;
  } catch {
    throw new RenderInspectionError("invalid-base-url");
  }
}

function normalizedDomain(value: string): string | undefined {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  return domain.length > 0 && !/[/?#@\s]/.test(domain) ? domain : undefined;
}

function validInput(input: RenderInspectionInput): boolean {
  return input.service.trim().length > 0
    && (input.maxPages === undefined || (Number.isInteger(input.maxPages) && input.maxPages >= 1 && input.maxPages <= 100))
    && (input.expectedDomains === undefined || input.expectedDomains.every((domain) => normalizedDomain(domain) !== undefined));
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

function page(payload: unknown, resourceKey: string): { readonly resources: readonly unknown[]; readonly cursor?: string } {
  const list = Array.isArray(payload) ? payload : object(payload) && Array.isArray(payload[resourceKey]) ? payload[resourceKey] as readonly unknown[] : undefined;
  if (list === undefined) throw new RenderInspectionError("invalid-response");
  const resources: unknown[] = [];
  let cursor: string | undefined;
  for (const item of list) {
    if (object(item) && string(item.cursor) !== undefined && item[resourceKey] !== undefined) {
      resources.push(item[resourceKey]);
      cursor = item.cursor as string;
    } else {
      resources.push(item);
      if (object(item) && string(item.cursor) !== undefined) cursor = item.cursor as string;
    }
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
  if (service.suspended === true || (object(service.maintenanceMode) && service.maintenanceMode.enabled === true)) return "unhealthy";
  return "unknown";
}

/** Creates a GET-only inspector. Credentials are obtained only when inspect is called. */
export function createRenderInspector(options: RenderInspectorOptions): { inspect(input: RenderInspectionInput): Promise<RenderInspection> } {
  const base = baseUrl(options.apiBaseUrl);
  return {
    async inspect(input: RenderInspectionInput): Promise<RenderInspection> {
      if (!validInput(input)) throw new RenderInspectionError("invalid-input");
      let token: string;
      try {
        token = await options.getBearerToken(input.signal);
      } catch {
        throw new RenderInspectionError("credential-unavailable");
      }
      if (token.trim().length === 0) throw new RenderInspectionError("credential-unavailable");
      const request = async (url: URL): Promise<Response> => {
        try {
          const response = await options.fetch(url, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, credentials: "omit", redirect: "error", signal: input.signal });
          if (!response.ok) throw providerError(response.status);
          return response;
        } catch (error) {
          if (error instanceof RenderInspectionError) throw error;
          if (input.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw new RenderInspectionError("aborted");
          throw new RenderInspectionError("network");
        }
      };
      const serviceUrl = new URL(`/v1/services/${encodeURIComponent(input.service)}`, base);
      let service: unknown;
      try {
        service = await parseJson(await request(serviceUrl));
      } catch (error) {
        if (error instanceof RenderInspectionError && error.kind === "http" && error.statusCode === 404) return { service: "missing", deployment: "none", serviceHealth: "unknown", domains: [] };
        throw error;
      }
      if (!object(service) || string(service.id) === undefined) throw new RenderInspectionError("invalid-response");
      const serviceId = service.id as string;
      const deployUrl = new URL(`/v1/services/${encodeURIComponent(serviceId)}/deploys`, base);
      deployUrl.searchParams.set("limit", "100");
      const deploys = page(await parseJson(await request(deployUrl)), "deploy").resources;
      const deployment = deploys.length === 0 ? "none" : deploymentState(deploys[0]);
      const expected = (input.expectedDomains ?? []).map((domain) => normalizedDomain(domain) as string);
      const found = new Map<string, boolean | undefined>();
      let domainsComplete = expected.length === 0;
      if (expected.length > 0) {
        let cursor: string | undefined;
        for (let index = 0; index < (input.maxPages ?? 20) && expected.some((domain) => !found.has(domain)); index += 1) {
          const domainsUrl = new URL(`/v1/services/${encodeURIComponent(serviceId)}/custom-domains`, base);
          domainsUrl.searchParams.set("limit", "100");
          if (cursor !== undefined) domainsUrl.searchParams.set("cursor", cursor);
          const domainPage = page(await parseJson(await request(domainsUrl)), "customDomain");
          for (const item of domainPage.resources) {
            if (!object(item)) continue;
            const name = string(item.name);
            const domain = name === undefined ? undefined : normalizedDomain(name);
            if (domain !== undefined && expected.includes(domain)) found.set(domain, item.verified === false ? false : true);
          }
          if (expected.every((domain) => found.has(domain)) || domainPage.cursor === undefined) {
            domainsComplete = true;
            break;
          }
          if (domainPage.cursor === cursor) break;
          cursor = domainPage.cursor;
        }
      }
      const domainChecks: RenderDomainCheck[] = expected.map((domain) => ({ domain, status: !found.has(domain) ? domainsComplete ? "missing" : "unknown" : found.get(domain) === false ? "unverified" : "present" }));
      return { service: "present", deployment, serviceHealth: serviceHealth(service), domains: domainChecks };
    },
  };
}
