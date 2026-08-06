/**
 * Types and value lists for a `PolicyBinding`: a content-addressed pointer
 * to a policy document, small enough to commit even when the document it
 * points at is not. See the package README for the full picture — this file
 * is deliberately just shapes and constants, no logic.
 */

/**
 * A hash algorithm `computeDigest` and `verifyBinding` know how to use.
 * Exported as a list rather than checked as a hardcoded literal so that
 * adding a second algorithm later is additive — one new entry here, one new
 * `case` in `computeDigest` — not a breaking rewrite of every call site that
 * currently assumes `"sha256"` is the only option.
 */
export type DigestAlgorithm = "sha256";

/** The valid `digestAlgorithm` values, in the order new ones would be added. */
export const DIGEST_ALGORITHMS: readonly DigestAlgorithm[] = ["sha256"];

/** One thing `validateBindingShape` (or `verifyBinding`) found wrong (or, at `"warning"`, worth a look). */
export interface Finding {
  /** Stable identifier for the rule that produced this finding, e.g. `"digest-mismatch"`. */
  rule: string;
  /** `"error"` fails validation; `"warning"` does not. */
  severity: "error" | "warning";
  /** Human-readable description of the problem. */
  message: string;
  /** The field or subpath this finding is about, when there is a single clear one. */
  path?: string;
}

/**
 * A commitment to a policy document by digest, not by content. Safe to
 * commit in a public `package.json` even when the document itself is
 * private: a hash reveals nothing about its input, but lets a later,
 * separately-obtained copy be checked against it byte-for-byte.
 */
export interface PolicyBinding {
  /** Which policy document this binds to. Opaque to this package — never interpreted, only compared and printed. */
  policyId: string;
  /** Which hash function produced `digest`. */
  digestAlgorithm: DigestAlgorithm;
  /** Lowercase hex digest of the policy document's bytes, under `digestAlgorithm`. */
  digest: string;
}
