/** Deployment contract and inspection primitives. This entrypoint performs no I/O. */
export { defineDeploymentManifest } from "./define.js";
export { defineDeploymentConfigurationPlan, isValidDeploymentConfigurationPlan, validateDeploymentConfigurationPlan } from "./configuration.js";
export { evaluateDeploymentHealth } from "./health.js";
export { normalizeDeploymentManifest, serializeDeploymentManifest } from "./normalize.js";
export { DEPLOYMENT_ENVIRONMENTS } from "./types.js";
export {
  REQUIRED_BOUND_DEPLOYMENT_ENVIRONMENT,
  checkDeploymentBranchBindings,
  defineDeploymentBranchBindings,
  isValidDeploymentBranchBindings,
  validateDeploymentBranchBindings,
} from "./branch-binding.js";
export type {
  DeploymentBranchBinding,
  DeploymentBranchBindingCheck,
  DeploymentBranchBindingDefinition,
  DeploymentBranchBindingFindingRule,
} from "./branch-binding.js";
export { checkDeploymentSurfaceDevPort, devScriptPorts } from "./dev-port.js";
export { verifyDeployRecord, DEPLOY_RECORD_INDETERMINATE_REASONS } from "./deploy-record.js";
export type { DeployRecordIndeterminateReason } from "./deploy-record.js";
export {
  planProductionRefUpdate,
  verifyProductionRefUpdate,
  PRODUCTION_REF_UPDATE_INDETERMINATE_REASONS,
} from "./production-ref-update.js";
export type {
  ProductionRefUpdateFindingRule,
  ProductionRefUpdateIndeterminateReason,
  ProductionRefUpdateObservation,
  ProductionRefUpdatePlan,
} from "./production-ref-update.js";
export { isValidDeploymentManifest, validateDeploymentManifest } from "./validate.js";
export type {
  DeploymentEnvironment,
  DeploymentBuildRequirement,
  DeploymentBuildRequirementDefinition,
  DeploymentConfigurationArtifact,
  DeploymentConfigurationPlan,
  DeploymentConfigurationPlanDefinition,
  DeploymentConfigurationRequirement,
  DeploymentConfigurationRequirementDefinition,
  DeploymentFinding,
  DeploymentHealthCheck,
  DeploymentHealthCheckDefinition,
  DeploymentHealthStatus,
  DeploymentHealthSummary,
  DeploymentManifest,
  DeploymentManifestDefinition,
  DeploymentObservation,
  DeploymentSurface,
  DeploymentSurfaceDefinition,
  DeploymentRoutingRequirement,
  DeploymentRoutingRequirementDefinition,
  DeployRecordDefinition,
  DeployRecordEnvironmentClassification,
  DeployRecordEnvironmentNameDefinition,
  DeployRecordEnvironmentObservation,
  DeployRecordEnvironmentScope,
  DeployRecordEnvironmentTarget,
  DeployRecordFindingRule,
  DeployRecordObservation,
  DeployRecordProtection,
} from "./types.js";
