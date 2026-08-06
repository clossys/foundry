import { createHash } from "node:crypto";
import { DIGEST_ALGORITHMS } from "./types.js";
import type { DigestAlgorithm } from "./types.js";

/**
 * Digests `content` under `algorithm` (default `"sha256"`) and returns the
 * result as lowercase hex. `content` may be a `string` (hashed as UTF-8
 * bytes) or a `Uint8Array` (hashed as-is) — equivalent bytes under either
 * form produce the same digest.
 *
 * `algorithm` is checked against `DIGEST_ALGORITHMS` at runtime, not just
 * typed as `DigestAlgorithm` at compile time. The type alone is not a
 * guard: it erases completely once this crosses into plain JS, and
 * `createHash` itself will happily run anything OpenSSL supports — weak,
 * broken algorithms included — so a JS caller, or a TS caller sourcing
 * `algorithm` from config (a string, unchecked against the union) could
 * otherwise silently *produce* a digest under `"md5"` or `"sha1"` with no
 * error anywhere. That would leave the producing half of this primitive
 * unguarded while the verifying half (`validateBindingShape`'s
 * `digest-algorithm-known` rule) is strict.
 *
 * This throws, deliberately, rather than returning a `Finding` the way
 * `validateBindingShape`/`verifyBinding` do. Those two validate untrusted,
 * externally-supplied data and report on it without ever crashing. This
 * check is different in kind: an unsupported `algorithm` here is a
 * programmer or config error at the point a binding is *produced* — the
 * caller's own code choosing a weak algorithm — not a fact about some
 * external input to be tolerated and reported. That is a bug to fail loudly
 * and immediately on, not a finding to collect.
 */
export function computeDigest(content: string | Uint8Array, algorithm: DigestAlgorithm = "sha256"): string {
  if (!DIGEST_ALGORITHMS.includes(algorithm)) {
    throw new Error(
      `computeDigest: unsupported digest algorithm ${JSON.stringify(algorithm)}. Must be one of ${DIGEST_ALGORITHMS.join(", ")}.`,
    );
  }
  return createHash(algorithm).update(content).digest("hex");
}
