/**
 * @vespeneventures/copy — public entry point. See README.md for the full
 * picture: the machinery-vs-values split this package mirrors from
 * @vespeneventures/voice (itself mirroring @vespeneventures/tokens), the
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
 *      wires both, plus `readCopyRecord`, into `copy-check`, an installable
 *      CLI with the same three-state exit-code contract
 *      `strategy-facts-check` uses: 0 clean, 1 findings, 2 could not run.
 *      `cli.ts` itself is intentionally NOT re-exported here — matching
 *      `@vespeneventures/strategy`'s own index.ts, a CLI's `main`/argv
 *      handling is not library surface, only its `bin` entry is.
 */

export type { CopyEntry, CopyEntryId, CopyFinding, CopyRecord } from "./types.js";

export { parseCopyRecord, validateCopyRecordShape } from "./schema.js";

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

// Re-exported so a consumer of this package never needs a direct dependency
// on @vespeneventures/voice just to read the types checkCopyRecord's own
// signature and report shape use — mirrors @vespeneventures/gates' own
// re-export of @vespeneventures/catalog/policy types for the same reason.
export type { VoiceCheckReport, VoiceCheckWaiver, VoiceFinding, VoiceRecord } from "@vespeneventures/voice";

export { extractCopyCandidates, PLACEHOLDER_SENTINEL, scanCopySourceTree } from "./scan.js";
export type { Citation, CopyCandidate, ExcludedLiteral, ExclusionReason, ParseFailure, ScanOptions, ScanResult, SkippedFile } from "./scan.js";

export { checkCopyTraceability } from "./copy-gate.js";
export type { CopyGateFinding, CopyGateIgnored, CopyGateResult, CopyGateRule } from "./copy-gate.js";
