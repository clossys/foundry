/**
 * @vespeneventures/strategy — the machinery, not the values.
 *
 * This package ships three halves, and the second and third are what
 * justify the first:
 *
 *   1. SCHEMA + READERS. Hand-rolled, dependency-free entity validators
 *      (`Fact`, `Mission`, `Positioning`, `Market`, `Audience`,
 *      `RoadmapItem`, `BrandEssence`, `BrandAttribute` — see `schema.ts`)
 *      plus `readStrategy` (`reader.ts`), a typed reader that loads and
 *      validates a consumer's real strategy directory. Pure data and
 *      validation, except `readStrategy` itself, which is this package's
 *      one deliberate I/O surface.
 *
 *   2. THE FACTS GATE. `checkFactsTraceability` (`facts-gate.ts`) scans
 *      prose (and copy in source) for numeric and superlative claims and
 *      fails when one cannot be traced back to a `facts.json` entry.
 *      `scanStrategyDirectory` (`scan.ts`) is its I/O half. `cli.ts` wires
 *      both into `strategy-facts-check`, an installable CLI with the
 *      three-state exit-code contract this repository's other gates use:
 *      0 clean, 1 findings, 2 could not run.
 *
 *   3. THE BRAND DERIVATION. `BrandDerivation` and `checkBrandCoverage`
 *      (`brand-derivation.ts`) turn a `BrandAttribute` from a record into
 *      an obligation: named token slots and named voice rules a brand's
 *      attributes must actually account for, checked in both directions —
 *      every brandable slot has a derivation, and no derivation names a
 *      slot that doesn't exist — the same two-directional discipline
 *      `@vespeneventures/ui/tokens`' own `brand-coverage.test.ts` uses. Slot
 *      and rule names are plain strings, never a typed import of
 *      `@vespeneventures/ui/tokens` or `@vespeneventures/copy/voice` — see
 *      `brand-derivation.ts`'s header comment for the seam.
 *
 * Nothing in this package's own source is a real company's mission,
 * positioning, facts, or brand — see the README's "What this package is
 * not" and `@vespeneventures/ui/tokens`' README ("The three-layer contract")
 * for the pattern this mirrors: a schema and a checker ship here; the
 * values live in each consumer's own repository.
 */

export {
  ROADMAP_STATUSES,
  validateAudience,
  validateAudiences,
  validateBrandAttribute,
  validateBrandAttributes,
  validateBrandEssence,
  validateFact,
  validateFacts,
  validateMarket,
  validateMarkets,
  validateMission,
  validateMoney,
  validatePositioning,
  validateRoadmapItem,
  validateRoadmapItems,
} from "./schema.js";
export type {
  Audience,
  BrandAttribute,
  BrandEssence,
  BrandEvidence,
  Fact,
  Market,
  Mission,
  Money,
  OperatingValue,
  Positioning,
  RoadmapItem,
  RoadmapStatus,
} from "./schema.js";

export { checkBrandCoverage, validateBrandDerivation, validateBrandDerivations } from "./brand-derivation.js";
export type { BrandCoverageFailureReason, BrandCoverageResult, BrandDerivation } from "./brand-derivation.js";

export { readStrategy } from "./reader.js";
export type { StrategyBundle, StrategyReadIssue, StrategyReadIssueReason } from "./reader.js";

export { buildFactIndex, isTracedSurfaceForm } from "./fact-index.js";
export type { FactIndex } from "./fact-index.js";

export { checkFactsTraceability } from "./facts-gate.js";
export type {
  FactsGateFinding,
  FactsGateIgnored,
  FactsGateResult,
  FactsGateRule,
  ScannedFile,
} from "./facts-gate.js";

export { scanStrategyDirectory } from "./scan.js";
export type { ScanOptions } from "./scan.js";

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
