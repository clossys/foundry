/**
 * Compile-time contracts for the governed-artifact types. Named
 * `*.check.ts`, not `*.test.ts`: this package's `tsconfig.json` excludes
 * `**\/*.test.ts` from `include`, so `npm run typecheck` never compiles a
 * test file, and `vitest` only transpiles one without type-checking it — a
 * `@ts-expect-error` written in a `.test.ts` file would silently assert
 * nothing. See `../repository/types.check.ts` for the established pattern
 * and this repository's own contribution guide for the full "type-level
 * assertions live in `.check.ts(x)` files" convention. Never imported by
 * `index.ts` or any runtime code.
 */
import type { DigestAlgorithm } from "@vespeneventures/policy";
import type { GovernedArtifactChecksum, GovernedArtifactProvenance } from "./types.js";

type ExpectTrue<Value extends true> = Value;

/** Compile-time proof the checksum algorithm field is exactly policy's own closed union, not an open string. */
export type ChecksumAlgorithmMatchesPolicy = ExpectTrue<
  GovernedArtifactChecksum["algorithm"] extends DigestAlgorithm ? true : false
>;

// @ts-expect-error — "md5" is not a member of policy's DigestAlgorithm union; an unsupported algorithm literal must not typecheck.
export const unsupportedAlgorithmRejected: GovernedArtifactChecksum = { algorithm: "md5", digest: "d".repeat(64) };

// Valid — "sha256" is the one algorithm policy currently supports.
export const supportedAlgorithmAccepted: GovernedArtifactChecksum = { algorithm: "sha256", digest: "d".repeat(64) };

// @ts-expect-error — provenance.source is required; omitting it must not typecheck.
export const provenanceMissingSource: GovernedArtifactProvenance = { revision: "abc123" };

// @ts-expect-error — provenance.revision is required; omitting it must not typecheck.
export const provenanceMissingRevision: GovernedArtifactProvenance = { source: "https://example.invalid/repo" };

// Valid — recordedAt is optional; omitting it alone must typecheck cleanly.
export const provenanceRecordedAtOptional: GovernedArtifactProvenance = { source: "s", revision: "r" };

// Valid — recordedAt may also be supplied.
export const provenanceRecordedAtSupplied: GovernedArtifactProvenance = { source: "s", revision: "r", recordedAt: "2026-08-13T00:00:00Z" };
