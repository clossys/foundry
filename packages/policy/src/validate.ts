import { DIGEST_ALGORITHMS } from "./types.js";
import type { DigestAlgorithm, Finding, PolicyBinding } from "./types.js";
import { computeDigest } from "./digest.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, list: readonly T[]): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/**
 * The hex length a digest under a given algorithm must be. A `Record` keyed
 * by `DigestAlgorithm`, not a single hardcoded `64`, so a second algorithm
 * added to `DIGEST_ALGORITHMS` gets its own expected length here rather than
 * silently reusing sha256's.
 */
const DIGEST_HEX_LENGTH: Record<DigestAlgorithm, number> = {
  sha256: 64,
};

/**
 * Structural validation of a value that claims to be a `PolicyBinding`: is
 * the shape right, not whether the digest it names actually matches
 * anything. Never throws — `null`, a string, an array, a number, or an
 * object missing every field are all just findings, never an exception,
 * because a validator that can crash on the exact malformed input it exists
 * to catch is not one `verifyBinding` could call unconditionally before a
 * digest comparison.
 */
export function validateBindingShape(value: unknown): Finding[] {
  const findings: Finding[] = [];

  // Rule: binding-present
  if (!isPlainObject(value)) {
    findings.push({
      rule: "binding-present",
      severity: "error",
      message: "A policy binding must be an object.",
      path: "$",
    });
    return findings; // nothing else below is checkable without an object
  }

  // Snapshot every field this function reads off `value`, exactly ONCE,
  // before any check runs — and use only these locals from here on. `value`
  // is `unknown` by design: a caller-supplied object whose shape this
  // function exists to not trust. Without this snapshot, a hostile `value`
  // (e.g. `digest` implemented as a getter, or `value` a Proxy) could return
  // a different result on each property read — passing a check on one read
  // and disagreeing with itself on the next — which is exactly the TOCTOU
  // shape `verifyBinding` depends on this function to not be vulnerable to.
  // Reading once removes that possibility by construction: there is only one
  // value in scope for every check below to (dis)agree with.
  const policyId = value.policyId;
  const digestAlgorithm = value.digestAlgorithm;
  const digest = value.digest;

  // Rule: policy-id-shape
  const policyIdOk = typeof policyId === "string" && policyId.length > 0;
  if (!policyIdOk) {
    findings.push({
      rule: "policy-id-shape",
      severity: "error",
      message: `policyId must be a non-empty string, got ${JSON.stringify(policyId)}.`,
      path: "policyId",
    });
  }

  // Rule: digest-algorithm-known
  const knownAlgorithm: DigestAlgorithm | undefined = isOneOf(digestAlgorithm, DIGEST_ALGORITHMS)
    ? digestAlgorithm
    : undefined;
  if (knownAlgorithm === undefined) {
    findings.push({
      rule: "digest-algorithm-known",
      severity: "error",
      message: `digestAlgorithm must be one of ${DIGEST_ALGORITHMS.join(", ")}, got ${JSON.stringify(digestAlgorithm)}.`,
      path: "digestAlgorithm",
    });
  }

  // Rule: digest-shape
  // Only checkable once we know a real algorithm to look up an expected
  // length for — an unknown digestAlgorithm is already reported above by
  // "digest-algorithm-known", and there is no length to check "digest"
  // against without one.
  if (knownAlgorithm !== undefined) {
    const expectedLength = DIGEST_HEX_LENGTH[knownAlgorithm];
    const pattern = new RegExp(`^[0-9a-f]{${expectedLength}}$`);
    const digestOk = typeof digest === "string" && pattern.test(digest);
    if (!digestOk) {
      findings.push({
        rule: "digest-shape",
        severity: "error",
        message: `digest must be exactly ${expectedLength} lowercase hex characters for "${knownAlgorithm}".`,
        path: "digest",
      });
    }
  }

  return findings;
}

/**
 * Verifies that `materializedContent` — bytes obtained separately, however
 * they arrived — is exactly the content `binding` committed to.
 *
 * Snapshots `binding`'s fields into a plain-object copy first (see the
 * TOCTOU note below), then runs `validateBindingShape` on that snapshot. If
 * that reports any `"error"`-severity finding, those are returned
 * immediately and no digest is computed: a binding whose own shape cannot be
 * trusted is not something a digest comparison against it can be trusted,
 * either. Otherwise, computes `computeDigest(materializedContent,
 * digestAlgorithm)` and compares it to `digest` — both read from the same
 * snapshot, never from `binding` again.
 *
 * A mismatch is one `Finding` with `rule: "digest-mismatch"`. Its message
 * deliberately does not include either digest value or any content — a
 * digest in a log is harmless on its own, but this function's contract
 * should not depend on every future call site making that judgement call
 * correctly forever.
 *
 * Digest comparison (`actualDigest !== digest` below) is deliberately a
 * plain `!==`, not a constant-time comparison. `digest` is not a secret —
 * this whole package's premise is that a digest is safe to commit publicly —
 * so there is nothing for a timing side-channel to extract here; a
 * constant-time comparison would only protect the recovery of a value that
 * was never confidential to begin with.
 */
export function verifyBinding(binding: PolicyBinding, materializedContent: string | Uint8Array): Finding[] {
  // Snapshot every field this function needs from `binding`, exactly ONCE,
  // before any check or comparison runs, into a fresh plain object — then
  // use only that snapshot (never `binding` itself) from here on.
  //
  // `binding` is caller-supplied and only *typed* as `PolicyBinding`; this
  // package's own docs elsewhere are explicit that its shape is not to be
  // trusted. Without this, a hostile `binding` — `digest` implemented as a
  // getter, or `binding` a Proxy — could return a well-formed value on the
  // read used by shape validation and a *different* value on a later read
  // used for the actual digest comparison (TOCTOU), making `verifyBinding`
  // report a clean pass for content that does not match what was bound.
  // Reading each field once, into a real plain-object snapshot, closes that
  // gap by construction: `validateBindingShape` below sees only the
  // snapshot's ordinary data properties, and the comparison further down
  // reuses those exact same locals — there is only one value of `digest` in
  // play for the rest of this function to ever disagree with.
  //
  // Guarded by `isPlainObject` first (mirroring `validateBindingShape`'s own
  // guard) because `binding` can, at runtime, be null or any other
  // non-object despite its static type — a plain JS caller, or a TS caller
  // that bypassed the type — and dereferencing a field off one would throw
  // before `validateBindingShape` ever got the chance to report it as an
  // ordinary finding instead.
  const snapshot: unknown = isPlainObject(binding)
    ? { policyId: binding.policyId, digestAlgorithm: binding.digestAlgorithm, digest: binding.digest }
    : binding;

  const shapeFindings = validateBindingShape(snapshot);
  if (shapeFindings.some((f) => f.severity === "error")) {
    return shapeFindings;
  }

  // `shapeFindings` is error-free, so `snapshot` passed shape validation —
  // and since `snapshot` is either the plain-object literal built above (not
  // `binding` itself) or, in the null/non-object branch, something that
  // could never have reached here at all, its fields are safe to read again
  // freely below without reopening the TOCTOU gap: they are ordinary data
  // properties on an object this function itself just created.
  const { policyId, digestAlgorithm, digest } = snapshot as PolicyBinding;

  const actualDigest = computeDigest(materializedContent, digestAlgorithm);
  if (actualDigest !== digest) {
    return [
      {
        rule: "digest-mismatch",
        severity: "error",
        message: `Materialized content for policy "${policyId}" does not match the digest it is bound to.`,
        path: "digest",
      },
    ];
  }

  return [];
}
