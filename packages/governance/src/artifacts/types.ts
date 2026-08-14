/**
 * Types for the consumer-owned governed-artifact verification contract: a
 * declared artifact kind + schema version, an exact-content checksum, and
 * structural source/revision provenance, combined into one deterministic,
 * fail-closed verification order. See `verify.ts` for the order itself,
 * why it is fixed, and what a clean result does and does not prove.
 *
 * This module owns shapes only — no logic lives here, matching every other
 * subpath's own `types.ts` in this package.
 */

import type { DigestAlgorithm } from "@vespeneventures/policy";

/**
 * The exact-content checksum a governed artifact manifest declares.
 * `algorithm` reuses `@vespeneventures/policy`'s own `DigestAlgorithm` —
 * currently just `"sha256"` — rather than declaring a second, independent
 * closed union: this contract can never claim to accept an algorithm
 * `policy` itself does not know how to verify, and it gains a new one the
 * moment `policy` does, with no edit required here. See `verify.ts` for why
 * digest comparison is delegated to `policy`'s own binding mechanism rather
 * than reimplemented.
 */
export interface GovernedArtifactChecksum {
  readonly algorithm: DigestAlgorithm;
  readonly digest: string;
}

/**
 * Structural source/revision provenance for a governed artifact.
 * `source` and `revision` are opaque, consumer-defined identifiers — a
 * repository URL, a package name, a commit SHA, a release tag, whatever the
 * consumer's own trust policy actually cares about. This package never
 * interprets, resolves, fetches, or compares them against anything external.
 *
 * Validated for PRESENCE AND SHAPE ONLY. Structural validity is NOT
 * authenticity: nothing in this contract proves `source` or `revision` are
 * genuine, that the named revision actually produced the checked content,
 * or who authored it. See `verify.ts`'s top-level doc comment, "What this
 * proves, and what it does not," for the exact boundary.
 */
export interface GovernedArtifactProvenance {
  readonly source: string;
  readonly revision: string;
  /** RFC 3339 timestamp with `Z` or an explicit offset, when supplied. Optional — absence is not a finding. */
  readonly recordedAt?: string;
}

/**
 * A consumer-owned governed artifact manifest: what kind of artifact this
 * is, which version of that kind's schema it claims, the exact-content
 * checksum, and structural provenance. `verifyGovernedArtifact` validates
 * exactly this envelope — never the semantic payload the checksum covers,
 * which remains the consumer's own schema-specific concern (see the
 * package README's contract boundary).
 */
export interface GovernedArtifactManifest {
  readonly kind: string;
  readonly schemaVersion: string;
  readonly checksum: GovernedArtifactChecksum;
  readonly provenance: GovernedArtifactProvenance;
}

/** Caller-supplied trust configuration for one `verifyGovernedArtifact` (or `verifyGovernedArtifacts`) call. */
export interface GovernedArtifactVerificationOptions {
  /** The only artifact kind this call accepts. A manifest declaring any other `kind` is rejected. */
  readonly artifactKind: string;
  /**
   * Every schema version this call accepts for `artifactKind`, in the
   * caller's own preferred order — order carries no meaning to this
   * package; it is never sorted, deduplicated silently, or used to pick a
   * "latest". An empty list is a caller CONFIGURATION error, not an
   * artifact that is trivially accepted: see `verify.ts`.
   */
  readonly supportedSchemaVersions: readonly string[];
}

/** One entry in a batch passed to `verifyGovernedArtifacts`. */
export interface GovernedArtifactBatchEntry {
  /** Caller-chosen label used only to prefix this entry's findings; never interpreted, never compared to anything. */
  readonly id: string;
  readonly manifest: unknown;
  readonly content: string | Uint8Array;
}

/**
 * The rule vocabulary this module's `Finding`s use. `Finding.rule` itself
 * stays typed as plain `string` (from `@vespeneventures/policy`, exactly
 * like the rest of this package's gates — see `../gates/types.ts`), so this
 * union is documentation and a convenience for a consumer that wants to
 * `switch` on `finding.rule`, never a runtime-enforced closed type.
 *
 * Rules prefixed `artifact/` are owned by this module. The four bare rules
 * at the end (`policy-id-shape`, `digest-algorithm-known`, `digest-shape`,
 * `digest-mismatch`) are NOT owned here — they are `@vespeneventures/policy`'s
 * own rule names, passed through verbatim from `validateBindingShape` /
 * `verifyBinding` rather than re-derived, so a caller sees exactly which
 * layer actually reported the problem. See `verify.ts`.
 */
export type GovernedArtifactFindingRule =
  | "artifact/options-shape"
  | "artifact/options-unknown-field"
  | "artifact/options-kind-blank"
  | "artifact/options-supported-versions-shape"
  | "artifact/options-supported-versions-empty"
  | "artifact/options-supported-version-blank"
  | "artifact/field-accessor"
  | "artifact/manifest-shape"
  | "artifact/manifest-unknown-field"
  | "artifact/kind-shape"
  | "artifact/schema-version-shape"
  | "artifact/checksum-shape"
  | "artifact/checksum-unknown-field"
  | "artifact/provenance-shape"
  | "artifact/provenance-unknown-field"
  | "artifact/provenance-source"
  | "artifact/provenance-revision"
  | "artifact/provenance-recorded-at"
  | "artifact/kind-mismatch"
  | "artifact/schema-version-unsupported"
  | "artifact/empty-batch"
  | "artifact/duplicate-batch-id"
  | "policy-id-shape"
  | "digest-algorithm-known"
  | "digest-shape"
  | "digest-mismatch";
