/**
 * @vespeneventures/copy — public entry point. See README.md for the full
 * picture: the machinery-vs-values split this package mirrors from
 * @vespeneventures/voice (itself mirroring @vespeneventures/tokens), the
 * frozen CopyEntry/CopyRecord contract, and exactly what checkCopyRecord
 * does and does not attempt.
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
