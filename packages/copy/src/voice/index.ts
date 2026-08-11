/**
 * @vespeneventures/copy/voice — public entry point. See README.md for the full
 * picture: the machinery-vs-values split this package mirrors from
 * @vespeneventures/ui/tokens, exactly what `checkCopy` does and does not
 * attempt, and the `factRef` seam into a separate `strategy` package this
 * package deliberately does not import from.
 */

export { FORMALITY_LEVELS, GLOSSARY_STATUSES } from "./types.js";
export type {
  PersonRule,
  TenseRule,
  FormalityLevel,
  VoiceRules,
  GlossaryStatus,
  GlossaryEntry,
  Claim,
  VoiceRecord,
  VoiceFinding,
} from "./types.js";

export { VOICE_FIELDS, TEMPLATE_PLACEHOLDER } from "./fields.js";
export type { VoiceFieldDefinition } from "./fields.js";

export { validateVoiceRecordShape, parseVoiceRecord } from "./schema.js";

export { checkCopy, auditClaimsRegister } from "./checker.js";
export type {
  VoiceCheckDimension,
  VoiceDimensionSkip,
  VoiceCheckWaiver,
  WaivedVoiceFinding,
  VoiceCheckOptions,
  VoiceCheckReport,
} from "./checker.js";
