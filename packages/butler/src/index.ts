/**
 * @vespeneventures/butler — everything about what a person wants, now and
 * standing.
 *
 * The question this role answers, and no other role does: **do we have what
 * this person wants — this request in their own confirmation, and their
 * standing instructions, still current?**
 *
 * Three halves ship here, and the third is what justifies the first two:
 *
 *   1. THE SCHEMA (`schema.ts`). Hand-rolled, dependency-free validators
 *      over the two record families: `IntentRecord` and `ConfirmationRecord`
 *      for one request read back to the person who made it, and
 *      `StandingInstruction` for the durable answers that keep speaking
 *      afterwards. Consent is three states — `absent`, `denied`, `granted`
 *      — never a boolean, so absence can never read as permission. Storage
 *      and audit are host-supplied ports (`StandingInstructionStore`,
 *      `StandingAuditLedger`); no implementation of either ships here.
 *
 *   2. THE EVALUATION (`contract.ts`). `evaluateStandingInstruction`
 *      compares one stored answer against the policy in force AND the
 *      clock, adding `stale` as a fourth EVALUATION status that is never a
 *      stored state. `decideStandingChange` is the pure decision core for
 *      one change, and `recordReopened`/`recordStaleness` build the audit
 *      events a host chooses to record.
 *
 *   3. THE GATES. Three checkers, all reachable from the single
 *      `butler-check` bin: `checkConfirmationCompleteness`,
 *      `checkCurrency`, and `checkWithdrawalParity`. Each is a pure
 *      function returning a three-state result, and `cli.ts` folds those
 *      onto the `0`/`1`/`2` exit contract without ever collapsing "could
 *      not run" into either "clean" or "findings".
 *
 * Two subpaths sit beside this one. `./inbound` is admission — whether an
 * event arriving on a channel should be acknowledged and processed at all,
 * decided as a pure function of the caller's own signature verification and
 * a host ledger's dedupe answer. `./web` is preference-surface state, and
 * is the only entry point that touches React.
 *
 * Nothing in this package's own source is a real topic vocabulary, a real
 * confidence floor, a real currency window, a jurisdiction rule, or an
 * obligation. It makes no claim of legal compliance. Ships the schema and
 * the checkers; every consumer authors its own values.
 */

export {
  CONFIRMATION_VERDICTS,
  INTENT_DISPOSITIONS,
  STANDING_AUDIT_EVENT_TYPES,
  STANDING_PROVENANCES,
  isConfirmationRecord,
  isIntentRecord,
  isStandingInstruction,
  validateConfidenceFloor,
  validateConfirmationRecord,
  validateConfirmationRecords,
  validateInstructionUsages,
  validateIntentRecord,
  validateIntentRecords,
  validatePolicyVersion,
  validatePreferencePaths,
  validateStandingInstruction,
  validateStandingInstructions,
} from "./schema.js";
export type {
  ConfidenceFloor,
  ConfirmationRecord,
  ConfirmationVerdict,
  CurrencyWindow,
  InstructionUsage,
  IntentDisposition,
  IntentRecord,
  PathCost,
  PolicyVersion,
  PreferencePath,
  StandingAction,
  StandingAuditEvent,
  StandingAuditEventType,
  StandingAuditLedger,
  StandingEvaluation,
  StandingEvaluationPolicy,
  StandingInstruction,
  StandingInstructionStore,
  StandingProvenance,
  StandingState,
  StandingTopic,
} from "./schema.js";

export {
  checkConfirmationCompleteness,
  checkCurrency,
  checkWithdrawalParity,
  decideStandingChange,
  evaluateStandingInstruction,
  recordReopened,
  recordStaleness,
} from "./contract.js";
export type {
  ConfirmationCompletenessResult,
  ConfirmationFailureReason,
  ConfirmationFinding,
  ConfirmationFindingKind,
  CurrencyFailureReason,
  CurrencyFinding,
  CurrencyFindingKind,
  CurrencyResult,
  WithdrawalParityFailureReason,
  WithdrawalParityFinding,
  WithdrawalParityFindingKind,
  WithdrawalParityResult,
} from "./contract.js";

export type { ValidationIssue, ValidationResult, Validator } from "./validation.js";
