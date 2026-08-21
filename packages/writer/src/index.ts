/**
 * @vespeneventures/writer — public entry point. See README.md for the full
 * picture: the machinery-vs-values split this package mirrors from
 * the package's voice contract (itself mirroring @vespeneventures/ui/tokens), the
 * frozen CopyEntry/CopyRecord contract, and exactly what checkCopyRecord
 * does and does not attempt.
 *
 * Two halves ship from here, mirroring the split @vespeneventures/strategy
 * draws between its own entity/reader half and its facts gate:
 *
 *   1. THE REGISTRY. CopyEntry/CopyRecord (`types.ts`), their validation
 *      (`schema.ts`), and `readCopyRecord` (`registry.ts`) — a consumer
 *      registers its own copy and this package can load and validate it.
 *   2. THE SCANNER GATE. `scanCopySourceTree` (`scan.ts`) walks a real
 *      source tree and extracts every user-facing string/template literal
 *      as a `CopyCandidate`; `checkCopyTraceability` (`copy-gate.ts`) is
 *      the pure gate that checks each one against a `CopyRecord`. `cli.ts`
 *      wires both, plus `readCopyRecord`, into `writer-check`, an installable
 *      CLI with the same three-state exit-code contract
 *      `strategy-facts-check` uses: 0 clean, 1 findings, 2 could not run.
 *      `cli.ts` itself is intentionally NOT re-exported here — matching
 *      `@vespeneventures/strategy`'s own index.ts, a CLI's `main`/argv
 *      handling is not library surface, only its `bin` entry is.
 */

export type {
  CopyEntry,
  CopyEntryId,
  CopyEntryStatus,
  CopyFinding,
  CopyLocale,
  CopyRef,
  CopyRegistry,
  CopyRegistryEntry,
  CopyResolution,
  CopyResolver,
  CopySource,
  CopyTranslationProvenance,
  CopyValue,
  CopyRecord,
} from "./types.js";

// Content-derived fingerprinting for translation provenance — see
// fingerprint.ts's and locale-coverage.ts's doc comments for why a source
// text is fingerprinted rather than tracked by a human-maintained revision.
export { computeCopyFingerprint, COPY_FINGERPRINT_ALGORITHM } from "./fingerprint.js";

export { parseCopyRecord, parseCopyRegistry, validateCopyRecordShape, validateCopyRegistryShape } from "./schema.js";

export { createCopyResolver, resolveCopyRef } from "./resolve.js";
export type { CopyResolveIssue, CopyResolveIssueReason, CopyResolveResult } from "./resolve.js";

export { readCopyRecord } from "./registry.js";
export type { CopyRegistryReadIssue, CopyRegistryReadIssueReason, CopyRegistryReadResult } from "./registry.js";

export { checkCopyRecord } from "./checker.js";
export type {
  CopyEntryCheckResult,
  CopyEntrySkip,
  CopyRecordCheckOptions,
  CopyRecordCheckReport,
  CopyRecordFinding,
  CopyRecordWaivedFinding,
} from "./checker.js";

// Voice is a first-class part of copy. It is available from this root entry
// point for a single-package experience and from the focused `copy/voice`
// subpath for consumers that only need the verbal contract.
export * from "./voice/index.js";

export { extractCopyCandidates, PLACEHOLDER_SENTINEL, scanCopySourceTree } from "./scan.js";
export type {
  Citation,
  CopyCandidate,
  ExcludedLiteral,
  ExclusionReason,
  ParseFailure,
  ScanOptions,
  ScanResult,
  SkippedFile,
  UncheckedItem,
} from "./scan.js";

// Path exclusions for scanCopySourceTree's scanning surface — see
// path-exclusions.ts's top doc comment for the "mention vs. use" case this
// exists for, and why it is a DIFFERENT feature from scan.ts's own
// ExclusionReason (a per-literal classification, not a per-file scope
// decision).
export { validatePathExclusions } from "./path-exclusions.js";
export type {
  ExcludedPath,
  PathExclusion,
  PathExclusionFinding,
  PathExclusionFindingRule,
  PathExclusionValidation,
} from "./path-exclusions.js";

export { checkCopyTraceability } from "./copy-gate.js";
export type { CopyGateFinding, CopyGateIgnored, CopyGateResult, CopyGateRule } from "./copy-gate.js";

// Copy ADDRESSABILITY: is user-facing prose resolved from the copy
// registry by id, or typed inline in a component? A different, stricter
// question than traceability above — see addressability.ts's top doc
// comment for the full split.
export {
  checkAddressability,
  extractAddressabilityCandidates,
  scanAddressabilitySources,
} from "./addressability.js";
export type {
  AddressabilityGateResult,
  AddressabilityPosition,
  AddressabilityScanOptions,
  AddressabilityScanResult,
  AddressabilityUncheckedItem,
  AddressabilityVerdict,
  AddressabilityViolation,
} from "./addressability.js";

// Locale-coverage governance: is every declared locale covered by a source
// locale's registry, where has a target locale drifted, has a translation
// gone stale against an edited source (via content fingerprint), and does
// every entry's interpolation stay in parity across locales? See
// locale-coverage.ts's top-of-file doc comment for the full design.
export { checkLocaleCoverage } from "./locale-coverage.js";
export type {
  LocaleCoverageFinding,
  LocaleCoverageReport,
  LocaleCoverageSkip,
  LocaleCoverageSkipReason,
} from "./locale-coverage.js";
