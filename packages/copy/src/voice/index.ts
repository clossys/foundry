/**
 * @vespeneventures/copy/voice — public entry point. See README.md for the full
 * picture: the machinery-vs-values split this package mirrors from
 * @vespeneventures/ui/tokens, exactly what `checkCopy` does and does not
 * attempt, and the `factRef` seam into a separate `strategy` package this
 * package deliberately does not import from.
 */

export { FORMALITY_LEVELS, GLOSSARY_STATUSES, VOICE_SEVERITIES } from "./types.js";
export type {
  PersonRule,
  TenseRule,
  FormalityLevel,
  VoiceRules,
  GlossaryStatus,
  GlossaryEntry,
  Claim,
  VoiceChannel,
  VoicePattern,
  PatternRule,
  VoiceSeverity,
  VoiceRecord,
  VoiceFinding,
} from "./types.js";

export { VOICE_FIELDS, TEMPLATE_PLACEHOLDER } from "./fields.js";
export type { VoiceFieldDefinition } from "./fields.js";

export { validateVoiceRecordShape, parseVoiceRecord } from "./schema.js";

export { checkCopy, auditClaimsRegister, isCiBlockingSeverity } from "./checker.js";
export type {
  VoiceCheckDimension,
  VoiceDimensionSkip,
  VoiceCheckWaiver,
  WaivedVoiceFinding,
  VoiceCheckOptions,
  VoiceCheckReport,
} from "./checker.js";

// The regex-safety gate itself — exported so a consumer can validate a
// pattern (e.g. in an editor/CI step, before it ever reaches a VoiceRecord)
// using the exact same logic schema.ts/checker.ts already run internally,
// rather than reimplementing or second-guessing it. See
// `internal/pattern-safety.ts`'s top doc comment for the full, documented
// regex-safety position this package takes.
export { checkPatternSafety } from "./internal/pattern-safety.js";
export type { PatternSafetyIssue, PatternSafetyResult } from "./internal/pattern-safety.js";
