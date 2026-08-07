/**
 * @vespeneventures/strategy — the machinery, not the values.
 *
 * This package ships two halves, and the second is what justifies the
 * first:
 *
 *   1. SCHEMA + READERS. Hand-rolled, dependency-free entity validators
 *      (`Fact`, `Mission`, `Positioning`, `Market`, `Audience`,
 *      `RoadmapItem` — see `schema.ts`) plus `readStrategy` (`reader.ts`),
 *      a typed reader that loads and validates a consumer's real strategy
 *      directory. Pure data and validation, except `readStrategy` itself,
 *      which is this package's one deliberate I/O surface.
 *
 *   2. THE FACTS GATE. `checkFactsTraceability` (`facts-gate.ts`) scans
 *      prose (and copy in source) for numeric and superlative claims and
 *      fails when one cannot be traced back to a `facts.json` entry.
 *      `scanStrategyDirectory` (`scan.ts`) is its I/O half. `cli.ts` wires
 *      both into `strategy-facts-check`, an installable CLI with the
 *      three-state exit-code contract this repository's other gates use:
 *      0 clean, 1 findings, 2 could not run.
 *
 * Nothing in this package's own source is a real company's mission,
 * positioning, or facts — see the README's "What this package is not" and
 * `@vespeneventures/tokens`' README ("The three-layer contract") for the
 * pattern this mirrors: a schema and a checker ship here; the values live
 * in each consumer's own repository.
 */

export {
  ROADMAP_STATUSES,
  validateAudience,
  validateAudiences,
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
  Fact,
  Market,
  Mission,
  Money,
  OperatingValue,
  Positioning,
  RoadmapItem,
  RoadmapStatus,
} from "./schema.js";

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

export type { ValidationIssue, ValidationResult, Validator } from "./validation.js";
