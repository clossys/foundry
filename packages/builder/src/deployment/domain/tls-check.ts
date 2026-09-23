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
 * One hostname's TLS observation, from a real, FULLY validated handshake --
 * chain trust, hostname match, and the validity window, all checked
 * together by the platform's own TLS stack, exactly as a normal HTTPS
 * client would. `"untrusted"` carries the platform's own verification
 * failure message verbatim (never synthesized by this package), so a
 * finding says exactly what the TLS stack itself found wrong -- expired,
 * self-signed, wrong hostname, or any other reason it names. This
 * deliberately does not attempt to inspect an untrusted certificate's own
 * fields: doing so needs `rejectUnauthorized: false`, which turns off the
 * platform's real verification rather than reporting its result, and
 * (confirmed empirically, not assumed) `getPeerCertificate()` on a socket
 * whose handshake was rejected returns nothing to inspect anyway -- see
 * `node-tls.ts`'s own header.
 */
export type TlsProbeObservation =
  | { readonly kind: "trusted"; readonly notAfter: string }
  | { readonly kind: "untrusted"; readonly reason: string }
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
    if (observation.kind === "untrusted") {
      findings.push({
        rule: "tls-certificate-untrusted",
        severity: "error",
        message: `TLS certificate for ${hostname} did not pass verification: ${observation.reason}`,
        path: hostname,
      });
    }
  }

  if (failures.length > 0) return TLS_CHECK_REASONS.indeterminate("tls-unreachable", failures.join("; "));
  if (findings.length > 0) return gateViolated(findings);
  return gateSatisfied(evaluated);
}
