/**
 * `canonicalizeValue` turns any JSON-serializable value into one
 * deterministic string, and `citeFact` uses it plus
 * `@clossys/controller/policy`'s own `computeDigest` to build a `FactCitation`
 * — this package's one write path for content-addressed integrity over a
 * fact's value. See `drift.ts`'s `checkLedgerDrift` for the read path that
 * later re-canonicalizes a caller-supplied current value and compares it
 * against what a citation committed to here.
 */

import { computeDigest } from "@clossys/controller/policy";
import type { DigestAlgorithm } from "@clossys/controller/policy";
import type { FactCitation } from "./types.js";

/**
 * Deterministically stringifies `value` so that two values that are
 * structurally equal — regardless of object-key insertion order — always
 * canonicalize to the same string, and therefore digest to the same hash.
 * Plain `JSON.stringify` does not have this property (key order is
 * insertion order), which would make `citeFact`/`checkLedgerDrift` report
 * spurious drift for a fact whose value is, say, a `Money`-shaped object
 * re-serialized with its keys in a different order.
 *
 * Accepts strings, numbers (finite only), booleans, `null`, plain objects,
 * and arrays — recursively. Throws on anything else (a function, a
 * `Symbol`, a non-finite number, `undefined` inside an object/array).
 * This throws rather than reporting a `LedgerFinding` deliberately, the
 * same producer-side-error precedent `@clossys/controller/policy`'s own
 * `computeDigest` sets for an unsupported `algorithm`: a fact value that
 * cannot be canonicalized is a caller programming error at the point a
 * citation is being *produced*, not a fact about untrusted external input
 * to tolerate and report.
 */
export function canonicalizeValue(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean" || t === "string") return JSON.stringify(value);
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new Error(`canonicalizeValue: cannot canonicalize a non-finite number (${String(value)}); this is a producer-side error, not a fact value.`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeValue(v)).join(",")}]`;
  }
  if (t === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeValue(record[k])}`).join(",")}}`;
  }
  throw new Error(`canonicalizeValue: cannot canonicalize a value of type "${t}" — only JSON-serializable values (string, finite number, boolean, null, plain object, array) are supported.`);
}

/**
 * Builds a `FactCitation`: computes `canonicalizeValue(value)`'s digest
 * under `algorithm` (default `"sha256"`, matching
 * `@clossys/controller/policy`'s own default) via `computeDigest`, and returns
 * `{ factRef, valueBinding: { policyId: factRef, digestAlgorithm, digest } }`
 * — `policyId` set to `factRef` by construction, satisfying `schema.ts`'s
 * `"citation-policy-id-mismatch"` rule by definition rather than by
 * caller discipline.
 *
 * This is the one place in this package that computes a digest FROM a real
 * value — `checkLedgerDrift` (`drift.ts`) is the one place that computes
 * one to COMPARE against an already-recorded citation, using
 * `@clossys/controller/policy`'s `verifyBinding` for that half so the compare
 * logic lives in exactly one place across this whole foundation.
 *
 * Throws (never returns a `LedgerFinding`) on an empty `factRef` or a
 * `value` `canonicalizeValue` cannot handle — both are caller programming
 * errors at the point a citation is being produced, the same distinction
 * `canonicalizeValue`'s own doc comment draws.
 */
export function citeFact(factRef: string, value: unknown, algorithm: DigestAlgorithm = "sha256"): FactCitation {
  if (typeof factRef !== "string" || factRef.length === 0) {
    throw new Error(`citeFact: factRef must be a non-empty string, got ${JSON.stringify(factRef)}.`);
  }
  const digest = computeDigest(canonicalizeValue(value), algorithm);
  return {
    factRef,
    valueBinding: { policyId: factRef, digestAlgorithm: algorithm, digest },
  };
}
