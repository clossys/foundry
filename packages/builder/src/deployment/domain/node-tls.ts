/**
 * The real `TlsCertificateProbe` (`tls-check.ts`) a caller wires in outside
 * a test. `connect` defaults to `node:tls`'s own `connect`, kept as an
 * explicit parameter so this file's own tests never open a real socket.
 *
 * Connects with the platform's normal, fully-verified handshake --
 * `rejectUnauthorized` is never set to `false` here. Confirmed empirically,
 * not assumed: with the Node default (`rejectUnauthorized: true`),
 * `getPeerCertificate()` returns `null` once a handshake is rejected, so
 * there is no way to inspect an untrusted certificate's own fields without
 * disabling verification -- and disabling it would stop reporting the
 * platform's real verdict and start reporting this package's own guess
 * instead. When the handshake is rejected, the error the platform raises
 * IS the finding (`kind: "untrusted"`, `reason` carrying its message
 * verbatim) -- but only when this file actually recognizes the failure as
 * a certificate-verification one. `CERTIFICATE_ERROR_CODES` is a curated,
 * deliberately NOT exhaustive allowlist of Node/OpenSSL `error.code` values
 * that name a real verification failure (expired, self-signed, wrong
 * hostname, and so on). Any OTHER error -- an unrecognized code, or no code
 * at all, exactly the shape a transport failure (DNS, a dropped connection,
 * a proxy) tends to have -- reports `kind: "unreachable"` instead. This is
 * the conservative direction on purpose: understating "untrusted" as
 * "unreachable" only costs an indeterminate result; understating a real
 * transport failure as "untrusted" would report a live certificate finding
 * about a certificate this file never actually saw.
 */
import * as nodeTls from "node:tls";
import type { TlsCertificateProbe, TlsProbeObservation } from "./tls-check.js";

export type NodeTlsConnect = typeof nodeTls.connect;

export type CreateNodeTlsProbeOptions = {
  readonly port?: number;
  readonly timeoutMs?: number;
  readonly connect?: NodeTlsConnect;
};

/**
 * Node/OpenSSL `error.code` values that name a real certificate
 * verification failure -- see this file's header for why this is an
 * allowlist, not a denylist of transport codes to exclude.
 */
const CERTIFICATE_ERROR_CODES = new Set([
  // Node's own post-chain hostname check (tls.checkServerIdentity).
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
  // OpenSSL X509_V_ERR_* verification reasons, surfaced by Node as error.code.
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
  "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
  "CERT_SIGNATURE_FAILURE",
  "CERT_NOT_YET_VALID",
  "CERT_HAS_EXPIRED",
  "ERROR_IN_CERT_NOT_BEFORE_FIELD",
  "ERROR_IN_CERT_NOT_AFTER_FIELD",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_CHAIN_TOO_LONG",
  "CERT_REVOKED",
  "INVALID_CA",
  "PATH_LENGTH_EXCEEDED",
  "INVALID_PURPOSE",
  "CERT_UNTRUSTED",
  "CERT_REJECTED",
]);

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

      const socket = connect({ host: hostname, port, servername: hostname, timeout: timeoutMs }, () => {
        const cert = socket.getPeerCertificate();
        const validTo = cert?.valid_to ? new Date(cert.valid_to) : undefined;
        finish({
          kind: "trusted",
          notAfter: validTo !== undefined && !Number.isNaN(validTo.getTime()) ? validTo.toISOString() : new Date(0).toISOString(),
        });
      });

      socket.on("error", (error: NodeJS.ErrnoException) => {
        const code = error.code;
        if (code !== undefined && CERTIFICATE_ERROR_CODES.has(code)) {
          finish({ kind: "untrusted", reason: error.message });
          return;
        }
        finish({ kind: "unreachable", detail: error.message });
      });
      socket.on("timeout", () => finish({ kind: "unreachable", detail: "connection timed out" }));
    });
}
