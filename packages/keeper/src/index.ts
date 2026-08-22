/**
 * @vespeneventures/keeper — everything about what you gave us, and what we
 * understand from it.
 *
 * The question this role answers, and no other role does: **does everything
 * we hold about this person trace to something they did, and can they see it
 * and correct it?**
 *
 * Three halves ship here, and the third is what justifies the first two:
 *
 *   1. THE SCHEMA (`schema.ts`). Hand-rolled, dependency-free validators over
 *      held items and the source events they trace to, the disclosure routes
 *      by which a person reaches them, the consumer's own declared retention
 *      schedule, and the deletions recorded against them. Every identifier is
 *      opaque; no record holds authored material, saved work, or a belief's
 *      own wording. The store itself is a host-supplied port.
 *
 *   2. THE DECISION (`contract.ts`). `decideHolding` returns the ternary —
 *      `held`, `forgotten`, `unjustifiable` — and every basis for keeping
 *      something names the source event it traces to, so a reason to hold
 *      that rests on nothing the person did has no shape to be written in.
 *
 *   3. THE GATES. Three checkers, all reachable from the single
 *      `keeper-check` bin: `checkAttribution`, `checkVisibility` and
 *      `checkDisposal`. Each is a pure function returning a three-state
 *      result, and `cli.ts` folds those onto the `0`/`1`/`2` exit contract
 *      without ever collapsing "could not run" into either "clean" or
 *      "findings".
 *
 * THE BOUNDARY RULE. An instruction constrains us; an understanding only
 * informs us. A belief inferred from behaviour may inform anything; the
 * moment it starts constraining what happens to a person it has become an
 * instruction, and one they are entitled to have been asked about first.
 * `BeliefUse` makes that boundary a type — a constraining belief must carry a
 * confirmation field, written `null` on purpose if the person was never asked
 * — and `checkAttribution` reports the `null` case by name.
 *
 * NO PERSON-ATTRIBUTABLE RECORD IS WRITTEN TO GIT. Git cannot delete, and
 * this role's whole job is disposal. So there is no store here: `HoldingStore`
 * and `DisclosureDirectory` are host-implemented ports with no implementation
 * shipped, and nothing in this package writes anything anywhere.
 *
 * One subpath sits beside this one. `./web` is the showing step — the hook a
 * consumer builds a "here is everything we hold about you" surface on, with
 * correction and erasure reachable through the same call shape as reading.
 * Its React peer is optional and is asserted at import time.
 *
 * Nothing in this package's own source is a real retention period, a real
 * holding class, a real belief class, a real disclosure surface or a
 * jurisdiction rule. It makes no claim of legal compliance. Ships the schema
 * and the checkers; every consumer authors its own values.
 */

export {
  BELIEF_USE_MODES,
  DELETION_EFFECTS,
  DISCLOSURE_REACHES,
  HOLDING_ORIGINS,
  INDETERMINATE_PROVENANCE_KINDS,
  PROVENANCE_KINDS,
  isHeldItem,
  isSourceEvent,
  validateDeletionRecords,
  validateDisclosureRecords,
  validateHeldItem,
  validateHeldItems,
  validateRetentionRules,
  validateSourceEvent,
  validateSourceEvents,
} from "./schema.js";
export type {
  BeliefConfirmation,
  BeliefUse,
  DeletionEffect,
  DeletionRecord,
  DisclosureDirectory,
  DisclosureReach,
  DisclosureRecord,
  HeldItem,
  HoldingOrigin,
  HoldingStore,
  InferredBelief,
  Provenance,
  RetentionRule,
  SourceEvent,
  SourceEventLedger,
} from "./schema.js";

export { GIVER_RETAINED_GROUNDS_SCHEMA_VERSION, validateGiverRetainedGroundsDocument } from "./giver-record.js";
export type { GiverRetainedGround, GiverRetainedGroundsDocument } from "./giver-record.js";

export {
  DISPOSAL_VIOLATION_REASONS,
  HOLDING_KINDS,
  INDETERMINATE_ATTRIBUTION_FINDING_KINDS,
  INDETERMINATE_DISPOSAL_FINDING_KINDS,
  INDETERMINATE_VISIBILITY_FINDING_KINDS,
  checkAttribution,
  checkDisposal,
  checkVisibility,
  decideHolding,
} from "./contract.js";
export type {
  AttributionFailureReason,
  AttributionFinding,
  AttributionFindingKind,
  AttributionResult,
  DispositionRead,
  DisposalFailureReason,
  DisposalFinding,
  DisposalFindingKind,
  DisposalResult,
  ForgettingGrounds,
  Holding,
  HoldingBasis,
  HoldingInputs,
  ReachRead,
  RetentionRead,
  SourceRead,
  SuccessionClaim,
  UnjustifiableFault,
  VisibilityFailureReason,
  VisibilityFinding,
  VisibilityFindingKind,
  VisibilityResult,
} from "./contract.js";

export type { ValidationIssue, ValidationResult, Validator } from "./validation.js";
