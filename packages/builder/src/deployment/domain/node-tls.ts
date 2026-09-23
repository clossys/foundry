/**
 * The real `TlsCertificateProbe` (`tls-check.ts`) a caller wires in outside
 * a test. `connect` defaults to `node:tls`'s own `connect`, kept as an
 * explicit parameter so this file's own tests never open a real socket.
 *
 * `rejectUnauthorized: false` (CodeQL js/disabling-certificate-validation,
 * suppressed inline below with its own justification) is deliberate and
 * measured, never a blanket "trust anything": this socket NEVER sends or
 * receives application data -- the callback below only ever reads
 * `getPeerCertificate()` and `socket.authorized`, and every path (`finish`)
 * destroys the socket immediately after. An untrusted or expired
 * certificate is exactly the finding this probe exists to report
 * (`chainTrusted: false` / `validNow: false`, read from the real
 * certificate rather than a placeholder), so refusing to look at an invalid
 * one would defeat the probe's own purpose. Confirmed empirically, not
 * assumed: with the Node default (`rejectUnauthorized: true`),
 * `getPeerCertificate()` returns `null` once the handshake is rejected --
 * there is no dates-and-subject-preserving way to answer "what, exactly, is
 * wrong with this certificate" without this option.
 */
import * as nodeTls from "node:tls";
import type { TlsCertificateProbe, TlsProbeObservation } from "./tls-check.js";

export type NodeTlsConnect = typeof nodeTls.connect;

export type CreateNodeTlsProbeOptions = {
  readonly port?: number;
  readonly timeoutMs?: number;
  readonly connect?: NodeTlsConnect;
};

export function createNodeTlsProbe(options: CreateNodeTlsProbeOptions = {}): TlsCertificateProbe {
  const port = options.port ?? 443;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const connect = options.connect ?? nodeTls.connect;

  return (hostname: string, signal?: AbortSignal): Promise<TlsProbeObservation> =>
    new Promise((resolve) => {
      if (signal?.aborted) {
        resolve({ kind: "unreachable", detail: "aborted" });
        return;
      }

      let settled = false;
      const finish = (observation: TlsProbeObservation): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(observation);
      };

      const socket = connect({
        host: hostname,
        port,
        servername: hostname,
        timeout: timeoutMs,
        rejectUnauthorized: false, // codeql[js/disabling-certificate-validation]: read-only inspection, never a real data connection -- see this file's header.
      }, () => {
        const cert = socket.getPeerCertificate();
        if (cert === undefined || Object.keys(cert).length === 0) {
          finish({ kind: "unreachable", detail: "no certificate was presented" });
          return;
        }
        const validFrom = cert.valid_from ? new Date(cert.valid_from) : undefined;
        const validTo = cert.valid_to ? new Date(cert.valid_to) : undefined;
        const now = Date.now();
        const validNow = validFrom !== undefined && validTo !== undefined && !Number.isNaN(validFrom.getTime()) && !Number.isNaN(validTo.getTime())
          && now >= validFrom.getTime() && now <= validTo.getTime();
        let hostnameAuthorized: boolean;
        try {
          hostnameAuthorized = nodeTls.checkServerIdentity(hostname, cert) === undefined;
        } catch {
          hostnameAuthorized = false;
        }
        finish({
          kind: "observed",
          validNow,
          notAfter: validTo !== undefined && !Number.isNaN(validTo.getTime()) ? validTo.toISOString() : new Date(0).toISOString(),
          hostnameAuthorized,
          chainTrusted: socket.authorized === true,
        });
      });

      socket.on("error", (error: Error) => finish({ kind: "unreachable", detail: error.message }));
      socket.on("timeout", () => finish({ kind: "unreachable", detail: "connection timed out" }));
    });
}
