export { AGENT_PACKAGES, AgentResolutionError, resolveAgent } from "./agents.js";
export type { AgentKind, AgentResolver, ResolvedAgent } from "./agents.js";
// Slot engine records: element/preview/selection/release/slot-contract schemas, loaders and status.
export * from "./records/index.js";
export { materializeCatalogCandidate } from "./specimen/catalog-materialization.js";
export type { CatalogCandidateInput } from "./specimen/catalog-materialization.js";
export { libraryRecordSource } from "./specimen/library-source.js";
export type { LibrarySourceOptions } from "./specimen/library-source.js";
export {
  isSpecimenHealthMessage, parseSpecimenHealthMessage, specimenHealthValue,
  SPECIMEN_ERROR_SOURCES, SPECIMEN_HEALTH_FIELDS, SPECIMEN_HEALTH_MESSAGE_TYPE, SPECIMEN_HEALTH_REQUEST_TYPE, SPECIMEN_HEALTH_VERSION,
} from "./specimen/health-contract.js";
export type { SpecimenErrorSource, SpecimenHealthError, SpecimenHealthField, SpecimenHealthMessage, SpecimenHealthParse } from "./specimen/health-contract.js";
