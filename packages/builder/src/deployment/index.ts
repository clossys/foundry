/** Deployment contract and inspection primitives. This entrypoint performs no I/O. */
export { defineDeploymentManifest } from "./define.js";
export { defineDeploymentConfigurationPlan, isValidDeploymentConfigurationPlan, validateDeploymentConfigurationPlan } from "./configuration.js";
export { evaluateDeploymentHealth } from "./health.js";
export { normalizeDeploymentManifest, serializeDeploymentManifest } from "./normalize.js";
export { DEPLOYMENT_ENVIRONMENTS } from "./types.js";
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
} from "./types.js";
