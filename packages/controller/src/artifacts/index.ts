/**
 * `@clossys/controller/artifacts` — a reusable contract for
 * verifying a consumer-owned governed artifact that combines a declared
 * kind + schema version, an exact-content checksum, and structural
 * source/revision provenance, in one deterministic, fail-closed order. See
 * `verify.ts` for the order itself and the package README's "Governed
 * artifact verification" section for the full contract boundary.
 *
 * Digest comparison is delegated entirely to `@clossys/controller/policy`'s
 * own binding mechanism — this module hashes nothing itself.
 */
export { verifyGovernedArtifact, verifyGovernedArtifacts } from "./verify.js";
export { readGovernedArtifactManifest, validateGovernedArtifactManifest, validateGovernedArtifactOptions } from "./validate.js";
export type { GovernedArtifactManifestRead } from "./validate.js";
export type {
  GovernedArtifactBatchEntry,
  GovernedArtifactChecksum,
  GovernedArtifactFindingRule,
  GovernedArtifactManifest,
  GovernedArtifactProvenance,
  GovernedArtifactVerificationOptions,
} from "./types.js";

// Re-exported so a consumer of this subpath never needs a separate import
// from ../policy/index.js just to type a Finding or hand-build a
// PolicyBinding — matching how ../gates/index.ts re-exports the same pair.
export type { DigestAlgorithm, Finding, PolicyBinding } from "../policy/index.js";
