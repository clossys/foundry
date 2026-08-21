/**
 * `computeCopyFingerprint` — a deterministic, content-derived digest of a
 * copy entry's `text`, and nothing else (no locale, no timestamp, no id
 * folded in). This is the one piece of machinery that makes real
 * stale-translation detection possible: `locale-coverage.ts`'s
 * `checkLocaleCoverage` compares a target entry's recorded
 * `translation.sourceFingerprint` (`types.ts`'s `CopyTranslationProvenance`)
 * against a fresh `computeCopyFingerprint(sourceEntry.text)` to decide
 * whether a translation is still current.
 *
 * WHY CONTENT-DERIVED, NEVER A HUMAN-MAINTAINED REVISION NUMBER
 * ---------------------------------------------------------------------------
 * A translation is stale exactly when the source text it was translated
 * from no longer matches the current source text — that is the whole
 * definition. A hand-bumped revision counter answers a related but weaker
 * question ("did someone remember to bump the number"), and nothing in this
 * package's schema, or any schema, can enforce that a human touches the
 * counter in lockstep with every edit to `text`. A bumped counter next to
 * an untouched sentence looks identical, at the type level, to a genuinely
 * re-reviewed one — the discipline can drift silently, the same
 * "check that passes because it checked nothing" failure mode
 * `locale-coverage.ts`'s own top-of-file doc comment (and
 * `scripts/check-release-readiness.mjs`'s header, which it cites) already
 * warns about elsewhere in this package.
 *
 * A content hash cannot drift the same way. If the source `text` changed by
 * one character, `computeCopyFingerprint` returns a different value with
 * certainty; if it did not change, it returns the same value with equal
 * certainty. It requires no human bookkeeping to stay correct — the
 * fingerprint IS the source text, deterministically restated, rather than
 * someone's claim about the source text.
 *
 * Uses `node:crypto`, a Node.js built-in — not a runtime dependency. This
 * follows the exact precedent `registry.ts` already set for `node:fs`: see
 * this package's README, "The single most important constraint", and
 * `types.ts`'s own doc comment on this package's zero-runtime-dependency
 * discipline.
 */

import { createHash } from "node:crypto";

/**
 * The digest algorithm `computeCopyFingerprint` uses, and the value every
 * `CopyTranslationProvenance.fingerprintAlgorithm` produced by this function
 * should record. Exported as a named constant, not hardcoded at each call
 * site, so a future algorithm change is one edit instead of several
 * independently-drifting string literals.
 */
export const COPY_FINGERPRINT_ALGORITHM = "sha256";

/**
 * Computes a deterministic, content-derived fingerprint of `text` — a
 * `sha256` hex digest, nothing else folded in (no locale, no id, no
 * timestamp). Pure: the same `text` always produces the same fingerprint,
 * on any machine, in any process.
 *
 * A consumer's own translation tooling should call this at the moment a
 * translation is actually produced, recording the result as
 * `translation.sourceFingerprint` alongside `COPY_FINGERPRINT_ALGORITHM` as
 * `translation.fingerprintAlgorithm` — the same function
 * `checkLocaleCoverage` will later call again, on the then-current source
 * `text`, to decide whether that recorded fingerprint still matches.
 */
export function computeCopyFingerprint(text: string): string {
  return createHash(COPY_FINGERPRINT_ALGORITHM).update(text, "utf8").digest("hex");
}
