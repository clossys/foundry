/**
 * Live TLS certificate verification for one or more declared hostnames.
 * `probe` is injected (`node-tls.ts` supplies the real `node:tls`
 * implementation) so this stays pure and testable offline, matching every
 * other check in this subpath.
 *
 * A hostname this could not even connect to is `indeterminate`, never
 * `violated` -- being offline does not prove the certificate is bad. See
 * #914 and `dns-check.ts`'s identical discipline.
 */
import { createGateReasons, gateSatisfied, gateViolated } from "@clossys/controller/gates";
import type { GateResult } from "@clossys/controller/gates";
import type { WebSurfaceFinding } from "./types.js";

/**
 * One hostname's TLS observation. `chainTrusted` and `hostnameAuthorized`
 * are independent dimensions -- a self-signed certificate can still
 * correctly name the hostname it serves, and a CA-trusted certificate can
 * still be presented for the wrong name.
 */
export type TlsProbeObservation =
  | {
      readonly kind: "observed";
      readonly validNow: boolean;
      readonly notAfter: string;
      readonly hostnameAuthorized: boolean;
      readonly chainTrusted: boolean;
    }
  | { readonly kind: "unreachable"; readonly detail?: string };

export type TlsCertificateProbe = (hostname: string, signal?: AbortSignal) => Promise<TlsProbeObservation>;

export const TLS_CHECK_REASONS = createGateReasons(["tls-unreachable", "no-hostnames"] as const);
export type TlsCheckIndeterminateReason = (typeof TLS_CHECK_REASONS.reasons)[number];

/**
 * Checks TLS for every supplied hostname. `evaluated` (on a `satisfied`
 * result) counts hostnames this actually connected to and observed.
 */
export async function checkTlsCertificate(
  hostnames: readonly string[],
  ports: { readonly probe: TlsCertificateProbe; readonly signal?: AbortSignal },
): Promise<GateResult<WebSurfaceFinding, TlsCheckIndeterminateReason>> {
  if (hostnames.length === 0) return TLS_CHECK_REASONS.indeterminate("no-hostnames", "No hostnames were supplied to check.");

  const findings: WebSurfaceFinding[] = [];
  const failures: string[] = [];
  let evaluated = 0;

  for (const hostname of hostnames) {
    let observation: TlsProbeObservation;
    try {
      observation = await ports.probe(hostname, ports.signal);
    } catch (error) {
      failures.push(`${hostname}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (observation.kind === "unreachable") {
      failures.push(`${hostname}: ${observation.detail ?? "unreachable"}`);
      continue;
    }
    evaluated += 1;
    if (!observation.validNow) {
      findings.push({ rule: "tls-certificate-expired", severity: "error", message: `TLS certificate for ${hostname} is not valid now (expires ${observation.notAfter}).`, path: hostname });
    }
    if (!observation.hostnameAuthorized) {
      findings.push({ rule: "tls-certificate-hostname-mismatch", severity: "error", message: `TLS certificate for ${hostname} does not authorize this hostname.`, path: hostname });
    }
    if (!observation.chainTrusted) {
      findings.push({ rule: "tls-certificate-untrusted-chain", severity: "error", message: `TLS certificate chain for ${hostname} is not trusted.`, path: hostname });
    }
  }

  if (failures.length > 0) return TLS_CHECK_REASONS.indeterminate("tls-unreachable", failures.join("; "));
  if (findings.length > 0) return gateViolated(findings);
  return gateSatisfied(evaluated);
}
