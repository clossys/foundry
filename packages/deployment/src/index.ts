/** Deployment contract and inspection primitives. This entrypoint performs no I/O. */
export { defineDeploymentManifest } from "./define.js";
export { evaluateDeploymentHealth } from "./health.js";
export { normalizeDeploymentManifest, serializeDeploymentManifest } from "./normalize.js";
export { DEPLOYMENT_ENVIRONMENTS } from "./types.js";
export { isValidDeploymentManifest, validateDeploymentManifest } from "./validate.js";
export type {
  DeploymentEnvironment,
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
} from "./types.js";
