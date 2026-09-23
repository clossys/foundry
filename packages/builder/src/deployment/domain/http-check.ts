/**
 * Live HTTP status verification for the root and any declared key routes,
 * against one hostname. `fetch` is injected -- the same seam the Vercel and
 * Render inspectors next door already use for their own requests -- so this
 * never opens a real connection in a test.
 */
import { createGateReasons, gateSatisfied, gateViolated } from "@clossys/controller/gates";
import type { GateResult } from "@clossys/controller/gates";
import type { WebSurfaceFinding } from "./types.js";

export type WebSurfaceFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const HTTP_CHECK_REASONS = createGateReasons(["http-unreachable", "no-routes"] as const);
export type HttpCheckIndeterminateReason = (typeof HTTP_CHECK_REASONS.reasons)[number];

/**
 * Checks every route resolves to `expectedStatus` (default `200`) over
 * HTTPS on `hostname`. `evaluated` (on a `satisfied` result) counts routes
 * this actually requested and observed a response for.
 */
export async function checkRoutes(
  hostname: string,
  routes: readonly string[],
  ports: { readonly fetch: WebSurfaceFetch; readonly expectedStatus?: number; readonly signal?: AbortSignal },
): Promise<GateResult<WebSurfaceFinding, HttpCheckIndeterminateReason>> {
  if (routes.length === 0) return HTTP_CHECK_REASONS.indeterminate("no-routes", "No routes were supplied to check.");
  const expectedStatus = ports.expectedStatus ?? 200;

  const findings: WebSurfaceFinding[] = [];
  const failures: string[] = [];
  let evaluated = 0;

  for (const route of routes) {
    const url = `https://${hostname}${route}`;
    let response: Response;
    try {
      response = await ports.fetch(url, { method: "GET", redirect: "follow", signal: ports.signal });
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    evaluated += 1;
    if (response.status !== expectedStatus) {
      findings.push({
        rule: "http-status-mismatch",
        severity: "error",
        message: `${url} returned ${response.status}, expected ${expectedStatus}.`,
        path: route,
      });
    }
  }

  if (failures.length > 0) return HTTP_CHECK_REASONS.indeterminate("http-unreachable", failures.join("; "));
  if (findings.length > 0) return gateViolated(findings);
  return gateSatisfied(evaluated);
}
