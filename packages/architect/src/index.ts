/** Provider-neutral operating-architecture contracts and evidence-based assessment. */
export {
  OPERATING_RESPONSIBILITIES,
  OPERATING_SCOPE_KINDS,
  OPERATING_SYSTEM_KINDS,
} from "./types.js";
export {
  compareOperatingTopologies,
  defineOperatingTopology,
  normalizeOperatingTopology,
  serializeOperatingTopology,
  validateOperatingTopology,
} from "./topology.js";
export {
  assessArchitectureExceptions,
  validateArchitectureChangeObservations,
} from "./assessment.js";
export type {
  ArchitectureAssessmentOptions,
  ArchitectureAssessmentState,
  ArchitectureChangeObservation,
  ArchitectureExceptionAssessment,
  ArchitectureFinding,
  ArchitectureFindingSeverity,
  AssessedArchitectureChange,
  AssessedBoundaryCrossing,
  AuthorityDefinition,
  BoundaryCrossingObservation,
  OperatingInterfaceDefinition,
  OperatingResponsibility,
  OperatingScopeDefinition,
  OperatingScopeKind,
  OperatingSystemDefinition,
  OperatingSystemKind,
  OperatingTopology,
  OperatingTopologyChange,
  OperatingTopologyCompatibilityReport,
  OperatingTopologyDefinition,
} from "./types.js";
