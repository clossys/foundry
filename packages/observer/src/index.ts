/**
 * @clossys/observer — measures what actually happened: telemetry
 * contracts, retention, redaction, and gate efficacy. See README.md for the
 * full contract and this package's decision record for why it is a
 * separate package from any gate it measures.
 *
 * This barrel deliberately exports no function that accepts both
 * `EscapeRateMetric` and `UnobservedSurfaceMetric` at once. See
 * `metrics.check.ts` for the compiled proof that the two share no field to
 * combine even if a caller tried.
 */

export type { ObservationState, Observation } from "./observation.js";
export { isObserved, isCouldNotRead, isUnobserved } from "./observation.js";

export type { LiveStateSurface, LiveStateFindingKind } from "./live-state.js";
export {
  liveStateFindingKinds,
  validateLiveStateSurface,
  OBSERVER_TELEMETRY_LOG_SURFACE,
} from "./live-state.js";

export type { TelemetryAttributeValue, TelemetryEvent } from "./telemetry.js";
export {
  TELEMETRY_RETENTION_WINDOW_DAYS,
  isWithinRetentionWindow,
  validateTelemetryEvent,
} from "./telemetry.js";

export {
  REDACTION_PLACEHOLDER,
  redactEvent,
  serializeEventAsJSON,
  serializeEventAsLogLine,
  serializeEventAsCsvRow,
  serializeEventAllForms,
} from "./redaction.js";

export type {
  GateRunRecord,
  GateRunHistoryObserved,
  GateRunHistoryRead,
  RunHistoryReader,
  GateEfficacyReport,
} from "./gate-efficacy.js";
export { computeGateEfficacy } from "./gate-efficacy.js";

export type { LandedChangeOutcome, EscapeRateMetric } from "./escape-rate.js";
export { computeEscapeRate } from "./escape-rate.js";

export type {
  DeclaredSubject,
  TelemetryPresence,
  SubjectTelemetryRead,
  UnobservedSurfaceMetric,
} from "./unobserved-surface.js";
export { computeUnobservedSurface } from "./unobserved-surface.js";

export type {
  CoverageDeclaration,
  DeclaredPackageAbsence,
  CoverageDeclarationFinding,
  ParsedCoverageDeclaration,
  InvalidCoverageDeclaration,
  WriteCoverageDeclarationInput,
} from "./coverage-declaration.js";
export {
  COVERAGE_DECLARATION_SCHEMA_VERSION,
  validateCoverageDeclarationShape,
  parseCoverageDeclaration,
  writeCoverageDeclaration,
} from "./coverage-declaration.js";

export type {
  CoverageCellState,
  FleetInstalledPackage,
  FleetInstalledInventory,
  UnclassifiedReason,
  InstalledCoverageCell,
  DeclaredAbsentCoverageCell,
  UnclassifiedCoverageCell,
  CoverageCell,
  FleetCoverageContradiction,
  FleetRepositoryCoverageInput,
  FleetCoverageInput,
  CoverageCellCounts,
  FleetCoverageVerdict,
  FleetCoverageReport,
} from "./coverage.js";
export { UNCLASSIFIED_REASONS, gradeFleetCoverage, fleetCoverageVerdictToExitCode } from "./coverage.js";
