/**
 * The one place #1211's four live checks meet: DNS resolution, the TLS
 * certificate, the HTTP status of the root and key routes, and (when a
 * caller supplies one) the right deployment serving. Every check is
 * independent and every check degrades to `indeterminate` on its own --
 * this function performs no I/O itself beyond calling the three ports it is
 * handed, and folds a caller-supplied `hostingObservation` in rather than
 * calling any provider API directly (see `vercel-hosting.ts` for how a
 * Vercel inspection becomes one).
 *
 * `overall` is `satisfied` only when all four are -- never when the hosting
 * check was left unconfigured. A caller that genuinely does not want the
 * hosting dimension counted reads `dns`/`tls`/`http` directly instead of
 * `overall`; this function does not offer a way to silently drop a
 * dimension from `overall` itself, matching #914's "never satisfied over
 * ground it didn't examine."
 */
import { foldGateResults, gateIndeterminate } from "@clossys/controller/gates";
import type { GateResult } from "@clossys/controller/gates";
import { checkDnsRecords } from "./dns-check.js";
import type { DnsCheckIndeterminateReason, DnsResolver } from "./dns-check.js";
import { checkRoutes } from "./http-check.js";
import type { HttpCheckIndeterminateReason, WebSurfaceFetch } from "./http-check.js";
import { checkTlsCertificate } from "./tls-check.js";
import type { TlsCertificateProbe, TlsCheckIndeterminateReason } from "./tls-check.js";
import type { WebSurfaceDeclaration, WebSurfaceFinding } from "./types.js";

export type WebSurfaceHostingIndeterminateReason = "hosting-not-configured" | string;

export interface WebSurfaceLiveVerificationReport {
  readonly dns: GateResult<WebSurfaceFinding, DnsCheckIndeterminateReason>;
  readonly tls: GateResult<WebSurfaceFinding, TlsCheckIndeterminateReason>;
  readonly http: GateResult<WebSurfaceFinding, HttpCheckIndeterminateReason>;
  readonly hosting: GateResult<WebSurfaceFinding, WebSurfaceHostingIndeterminateReason>;
  readonly overall: GateResult<WebSurfaceFinding, string>;
}

export interface WebSurfaceVerificationPorts {
  readonly resolveDns: DnsResolver;
  readonly probeTls: TlsCertificateProbe;
  readonly fetch: WebSurfaceFetch;
  /**
   * A pre-computed "right deployment serving" verdict -- e.g. from
   * `observeVercelHosting` (`vercel-hosting.ts`) fed a caller's own
   * `createVercelInspector(...).inspect(...)` result. Omitted means this
   * dimension was never examined, and `hosting` (and therefore `overall`)
   * reports `indeterminate` rather than being silently left out.
   */
  readonly hostingObservation?: GateResult<WebSurfaceFinding, string>;
  readonly signal?: AbortSignal;
}

export async function verifyWebSurfaceLiveState(
  declaration: WebSurfaceDeclaration,
  ports: WebSurfaceVerificationPorts,
): Promise<WebSurfaceLiveVerificationReport> {
  const production = declaration.environments.find((entry) => entry.environment === "production");
  const primaryHostname = production?.hostname ?? declaration.domain;
  const hostnames = [...new Set(declaration.environments.map((entry) => entry.hostname))];

  const [dns, tls, http] = await Promise.all([
    checkDnsRecords({ domain: declaration.domain, records: declaration.records }, { resolve: ports.resolveDns, signal: ports.signal }),
    checkTlsCertificate(hostnames, { probe: ports.probeTls, signal: ports.signal }),
    checkRoutes(primaryHostname, declaration.routes, { fetch: ports.fetch, signal: ports.signal }),
  ]);
  const hosting: GateResult<WebSurfaceFinding, WebSurfaceHostingIndeterminateReason> = ports.hostingObservation
    ?? gateIndeterminate("hosting-not-configured", "No hosting observation was supplied; the right-deployment-serving check was not run.");

  const overall = foldGateResults<WebSurfaceFinding, string>([dns, tls, http, hosting], {
    emptyReason: "hosting-not-configured",
    emptyDetail: "No checks were run.",
  });

  return { dns, tls, http, hosting, overall };
}
