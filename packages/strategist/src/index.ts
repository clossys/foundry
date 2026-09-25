/**
 * @clossys/strategist — the machinery, not the values.
 *
 * This package ships four halves, and the second through fourth are what
 * justify the first:
 *
 *   1. SCHEMA + READERS. Hand-rolled, dependency-free entity validators
 *      (`Fact`, `Mission`, `Positioning`, `Market`, `Audience`,
 *      `RoadmapItem`, `BrandEssence`, `BrandAttribute`, `DirectionEntity`
 *      — see `schema.ts`) plus two readers: `readStrategy` (`reader.ts`),
 *      a typed reader that loads and validates a consumer's real strategy
 *      directory, and `readStrategyDirectory` (`facts-dir.ts`), its pure,
 *      caller-fed counterpart that combines a directory of per-fact JSON
 *      leaves into one validated `Fact[]` (with per-fact `sourceFile`
 *      provenance). Pure data and validation, except `readStrategy`
 *      itself, which is this package's one deliberate I/O surface.
 *
 *   2. THE FACTS GATE. `checkFactsTraceability` (`facts-gate.ts`) scans
 *      prose (and copy in source) for numeric and superlative claims and
 *      fails when one cannot be traced back to a `facts.json` entry.
 *      `scanStrategyDirectory` (`scan.ts`) is its I/O half. `cli.ts` wires
 *      both into `strategist-check`, an installable CLI with the
 *      three-state exit-code contract this repository's other gates use:
 *      0 clean, 1 findings, 2 could not run.
 *
 *   3. THE BRAND DERIVATION. `BrandDerivation` and `checkBrandCoverage`
 *      (`brand-derivation.ts`) turn a `BrandAttribute` from a record into
 *      an obligation: named token slots and named voice rules a brand's
 *      attributes must actually account for, checked in both directions —
 *      every brandable slot has a derivation, and no derivation names a
 *      slot that doesn't exist — the same two-directional discipline
 *      `@example/ui/tokens`' own `brand-coverage.test.ts` uses. Slot
 *      and rule names are plain strings, never a typed import of
 *      `@example/ui/tokens` or `@example/copy/voice` — see
 *      `brand-derivation.ts`'s header comment for the seam.
 *
 *   4. DIRECTION INVALIDATION. Facts drift; direction — vision, mission,
 *      positioning, market, audience — is changed, deliberately, by
 *      someone who can say when and why. `DirectionEntity` (`schema.ts`)
 *      is one dated, versioned direction decision; `checkDirectionCoverage`
 *      and `checkDirectionCurrency` (`direction-invalidation.ts`) are the
 *      two checks that follow from that: does every direction entity have
 *      a derived artifact behind it and vice versa, and — the check
 *      presence alone cannot do — does every derived artifact's
 *      `reviewedAgainst` still name the CURRENT version, not one some
 *      other entity's `supersedes` has already replaced. See
 *      `direction-invalidation.ts`'s header comment for why this is two
 *      functions, not one.
 *
 * Nothing in this package's own source is a real company's mission,
 * positioning, facts, or brand — see the README's "What this package is
 * not" and `@example/ui/tokens`' README ("The three-layer contract")
 * for the pattern this mirrors: a schema and a checker ship here; the
 * values live in each consumer's own repository.
 */

export {
  DIRECTION_SUBJECT_FILES,
  ROADMAP_STATUSES,
  validateAudience,
  validateAudiences,
  validateBrand,
  validateBrandAttribute,
  validateBrandAttributes,
  validateBrandEssence,
  validateDirectionEntities,
  validateDirectionEntity,
  validateFact,
  validateFacts,
  validateMarket,
  validateMarkets,
  validateMission,
  validateMoney,
  validatePositioning,
  validateRoadmapItem,
  validateRoadmapItems,
  validateStrategistClaim,
  validateStrategistClaims,
  validateStrategyConstraint,
  validateStrategyConstraints,
} from "./schema.js";
export type {
  Audience,
  BrandAttribute,
  BrandDocument,
  BrandEssence,
  DirectionEntity,
  DirectionSubject,
  DirectionSubjectFile,
  Fact,
  Market,
  Mission,
  Money,
  OperatingValue,
  Positioning,
  RoadmapItem,
  RoadmapStatus,
  StrategistClaim,
  StrategistClaimStatus,
  StrategyConstraint,
  StrategyConstraintTarget,
} from "./schema.js";

export { checkBrandCoverage, validateBrandDerivation, validateBrandDerivations } from "./brand-derivation.js";
export type { BrandCoverageFailureReason, BrandCoverageResult, BrandDerivation } from "./brand-derivation.js";

export { checkDirectionCoverage, checkDirectionCurrency } from "./direction-invalidation.js";
export type {
  DirectionCoverageFailureReason,
  DirectionCoverageResult,
  DirectionCurrencyFailureReason,
  DirectionCurrencyFinding,
  DirectionCurrencyFindingKind,
  DirectionCurrencyResult,
} from "./direction-invalidation.js";

export { readStrategy, brandDerivationsFromBundle } from "./reader.js";
export type { StrategyBundle, StrategyReadIssue, StrategyReadIssueReason } from "./reader.js";

export { checkStrategyHandoff, currentDirectionId, strategyDirectoryUnreadable } from "./handoff.js";
export type { HandoffFinding, HandoffResult } from "./handoff.js";

export { projectStrategyContract, projectAndValidateStrategyContract } from "./projector.js";

export { checkClaimMarkers, checkConstraintMarkers, checkStrategyApply } from "./markers-gate.js";
export type { MarkersGateFinding, MarkersGateResult, MarkersGateRule } from "./markers-gate.js";

export { readStrategyDirectory } from "./facts-dir.js";
export type { FactsDirectoryInput, FactsDirectoryIssue, FactsDirectoryIssueReason, FactsDirectoryResult } from "./facts-dir.js";

export { buildFactIndex, isTracedSurfaceForm } from "./fact-index.js";
export type { FactIndex } from "./fact-index.js";

export { checkFactsTraceability } from "./facts-gate.js";
export { assessStrategyTraceabilityRate } from "./strategy-traceability-rate.js";
export type {
  StrategyTraceabilityRateAssessment,
  StrategyTraceabilityRateFinding,
  StrategyTraceabilityRateState,
} from "./strategy-traceability-rate.js";
export type {
  FactsGateFinding,
  FactsGateIgnored,
  FactsGateOptions,
  FactsGateResult,
  FactsGateRule,
  ScannedFile,
} from "./facts-gate.js";

export { scanStrategyDirectory } from "./scan.js";
export type { ScanOptions } from "./scan.js";

export {
  CURRENT_STRATEGY_DIR_SEGMENTS,
  LEGACY_STRATEGY_DIR_SEGMENTS,
  resolveDefaultStrategyDirectory,
} from "./strategy-dir-default.js";
export type { StrategyDirectoryDefault } from "./strategy-dir-default.js";

export {
  ENGAGEMENT_CONTEXT_FIELD_IDS,
  audienceContextValue,
  fieldById as engagementContextFieldById,
  readEngagementContext,
  readEngagementContextFromBriefData,
} from "./engagement-context.js";
export type {
  EngagementContextField,
  EngagementContextFieldId,
  EngagementContextRead,
  EngagementContextSnapshot,
} from "./engagement-context.js";

export { pendingAudienceIntakeQuestions, seedAudienceFromContext } from "./audience-intake.js";
export type { AudienceIntakeQuestion, AudienceIntakeQuestionId, AudienceSeedResult } from "./audience-intake.js";

export {
  STRATEGY_RECORD_KINDS,
  createStrategyProvenance,
  getApprovedClaims,
  serializeStrategyContract,
  validateStrategyContract,
} from "./contract.js";
export type {
  ApprovedClaimApproval,
  ApprovedClaimRecord,
  AudienceRecord,
  BrandRecord,
  ClaimRecord,
  ClaimStatus,
  ConstraintKind,
  ConstraintRecord,
  ConstraintTarget,
  EvidenceKind,
  EvidenceRecord,
  HypothesisClaimRecord,
  PositioningRecord,
  ProductRecord,
  RecordProvenance,
  StrategyContract,
  StrategyProvenance,
  StrategyRecord,
  StrategyRecordBase,
  StrategyRecordKind,
  StrategyRecordReference,
} from "./contract.js";

export type { ValidationIssue, ValidationResult, Validator } from "./validation.js";
