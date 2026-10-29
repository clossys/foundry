/** Strategy cell machinery. Consumer content stays in the consumer root. */
export { ENGAGEMENT_CONTEXT_FIELD_IDS, audienceContextValue, fieldById as engagementContextFieldById, readEngagementContext, readEngagementContextFromBriefData } from "./engagement-context.js";
export type { EngagementContextField, EngagementContextFieldId, EngagementContextRead, EngagementContextSnapshot } from "./engagement-context.js";
export { assessStrategyTraceabilityRate } from "./strategy-traceability-rate.js";
export type { StrategyTraceabilityRateAssessment, StrategyTraceabilityRateFinding, StrategyTraceabilityRateState } from "./strategy-traceability-rate.js";
export { scanStrategyDirectory } from "./scan.js";
export type { ScanOptions } from "./scan.js";
export { buildFactIndex, isTracedSurfaceForm } from "./fact-index.js";
export type { FactIndex } from "./fact-index.js";
export { readFindings } from "./facts-dir.js";
export { checkGrounding } from "./facts-gate.js";
export type { FactsGateFinding, FactsGateIgnored, FactsGateOptions, FactsGateResult, FactsGateRule, ScannedFile } from "./facts-gate.js";
export { checkWontClaimDrift } from "./wont-claim-drift.js";
export type { WontClaimFinding, WontClaimResult, WontClaimState } from "./wont-claim-drift.js";
export type { ValidationIssue, ValidationResult, Validator } from "./validation.js";
export { loadCatalog, validateCatalog } from "./catalog.js";
export { openStrategy } from "./api.js";
export type { Strategy, StrategyInventoryReport } from "./api.js";
export { compileBrief } from "./brief.js";
export type { Brief, BriefCell } from "./brief.js";
export { validateBriefContract, discoverBriefContracts } from "./brief-contracts.js";
export type { BriefContract, BriefContractDiscovery } from "./brief-contracts.js";
export type { CatalogCell, CatalogNode, StrategyCatalog, CatalogRule, CatalogIssue, CatalogValidationResult } from "./catalog.js";

// Cell-model formats and the synchronous consumer-root reader.
export { parseCell, serializeCell } from "./format/cell.js";
export { parseRef, formatRef } from "./format/ref.js";
export { parseSession } from "./format/session.js";
export { parseFinding, validateFinding } from "./format/finding.js";
export { validateRequest } from "./format/request.js";
export { validateTree } from "./format/tree.js";
export { readStrategyRoot } from "./store.js";
export type {
  CellId, CellRef, Ref, Bullet, Cell, FormatIssue, FormatResult,
  StrategyTreeNode, StrategyTree, SessionLine, Session, Finding,
  StrategyRequest, StrategyRootIssue, StrategyModel,
} from "./format/types.js";
export { checkCell, checkCoherence, completion, strategyStatus, validWatch, blocks, cellJudgeId } from "./checks/index.js";
export type { Scope, JudgeVerdict, CheckOptions, CheckContext, CheckFinding, CellFinding, CoherenceFinding, CellCompletion, StorylineReport, StatusReport, CompletionReport } from "./checks/index.js";

export { buildCitationIndex } from "./citations/index.js";
export type { CitationEntry, CitationIndex, ScanInput } from "./citations/index.js";
export { propose, activate, createRequest, listRequests, resolveRequest } from "./write/index.js";
export type { ProposeOptions, ActivateOptions, NewRequest } from "./write/index.js";
export { review } from "./loop.js";
export type { ReviewReport, ReviewRequest } from "./loop.js";
