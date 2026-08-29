/**
 * @clossys/giver — everything about what you get: what you asked
 * for, and what we owe you.
 *
 * The question this role answers, and no other role does: **did this
 * person get what they asked for, or a reason, or a human — and everything
 * we owed them, on time?**
 *
 * Three halves ship here, and the third is what justifies the first two:
 *
 *   1. THE SCHEMA (`schema.ts`). Hand-rolled, dependency-free validators
 *      over four record families: hand-offs and their placements, answers
 *      and the grounds retained behind them, obligations and the delivery
 *      proofs that discharge them, and the standing read those decisions
 *      rest on. Every identifier is opaque; no record holds the text of a
 *      request, an answer, or a message.
 *
 *   2. THE DECISION (`contract.ts`). `decideOutcome` returns a ternary —
 *      `delivered`, `refused`, `handed off` — never a binary, and it is
 *      the one place the precedence rule between a standing refusal and a
 *      thing we owe is resolved. `evaluateObligation` returns the
 *      obligation ternary — `discharged`, `breached`, `unprovable` — and
 *      never rounds the third up into the first.
 *
 *   3. THE GATES. Three checkers, all reachable from the single
 *      `giver-check` bin: `checkHandoffPlacement`, `checkGrounding`, and
 *      `checkObligationDischarge`. Each is a pure function returning a
 *      three-state result, and `cli.ts` folds those onto the `0`/`1`/`2`
 *      exit contract without ever collapsing "could not run" into either
 *      "clean" or "findings".
 *
 * The defect this package repays is a send path whose policy collaborator
 * was optional and defaulted to permissive, so a host that wired nothing
 * sent everything to everyone with no error anywhere. Nothing here has
 * that shape: every collaborator `decideOutcome` needs is a required
 * field, `DeliveryBasis` has no variant meaning "we could not tell", and
 * `VerdictRefusalGrounds` has no variant that lets an undecidable request
 * become a quiet refusal instead of reaching a person.
 *
 * One subpath sits beside this one. `./record` is the document seam — the
 * declared filename and schema for the standing-decision document this
 * package READS as JSON and never imports — plus the emitters that turn
 * one verdict into exactly the records these gates read back.
 *
 * Nothing in this package's own source is a real obligation, a real
 * register, a real category, a real service level or a jurisdiction rule.
 * It makes no claim of legal compliance. Ships the schema and the
 * checkers; every consumer authors its own values.
 */

export {
  ANSWER_OUTCOME_KINDS,
  DELIVERY_STATES,
  HANDOFF_REASONS,
  INDETERMINATE_STANDING_STATUSES,
  STANDING_READ_STATUSES,
  isAnswerRecord,
  isHandoffRecord,
  isObligationRecord,
  validateAnswerRecord,
  validateAnswerRecords,
  validateDeliveryProofs,
  validateHandoffRecord,
  validateHandoffRecords,
  validateObligationRecord,
  validateObligationRecords,
  validatePlacementRecords,
  validateRetainedGrounds,
} from "./schema.js";
export type {
  AnswerOutcome,
  AnswerRecord,
  DeliveryProof,
  DeliveryState,
  GroundCitation,
  HandoffReason,
  HandoffRecord,
  HandoffSla,
  ObligationRecord,
  ObligationWindow,
  PlacementRecord,
  PolicyVersion,
  RetainedGround,
  StandingRead,
} from "./schema.js";

export {
  INDETERMINATE_DISCHARGE_FINDING_KINDS,
  VERDICT_KINDS,
  checkGrounding,
  checkHandoffPlacement,
  checkObligationDischarge,
  decideOutcome,
  evaluateObligation,
} from "./contract.js";
export type {
  DeliveryBasis,
  GroundingFailureReason,
  GroundingFinding,
  GroundingFindingKind,
  GroundingResult,
  GroundsReadiness,
  HandoffPlacementFailureReason,
  HandoffPlacementFinding,
  HandoffPlacementFindingKind,
  HandoffPlacementResult,
  HumanAvailability,
  ObligationBreachReason,
  ObligationDischargeFailureReason,
  ObligationDischargeFinding,
  ObligationDischargeFindingKind,
  ObligationDischargeResult,
  ObligationStatus,
  OutcomeInputs,
  OwedObligation,
  UnplacedHandoff,
  Verdict,
  VerdictRefusalGrounds,
} from "./contract.js";

export type { ValidationIssue, ValidationResult, Validator } from "./validation.js";
