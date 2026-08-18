/** Pure contracts for caller-owned cross-plane composition. */
export { evaluateComposition } from "./evaluate.js";
export { validateCompositionEvaluationInput } from "./validate.js";
export { COMPOSITION_SCHEMA_VERSION } from "./types.js";
export type {
  CompositionCapabilitySupply,
  CompositionConstraint,
  CompositionConstraintResult,
  CompositionContributorRole,
  CompositionDeclaration,
  CompositionEvaluation,
  CompositionEvaluationInput,
  CompositionEvaluationStatus,
  CompositionException,
  CompositionFinding,
  CompositionFindingRule,
  CompositionOneOfConstraint,
  CompositionOperatorDecision,
  CompositionPlane,
  CompositionPolicyDeclaration,
  CompositionPreferenceDeclaration,
  CompositionPresenceConstraint,
  CompositionProvenance,
  CompositionProvenanceEntry,
  CompositionRequirementDeclaration,
  CompositionResolution,
  CompositionResolutionStatus,
  CompositionScope,
} from "./types.js";
