/** Public, provider-neutral deployment contract types. */
export const DEPLOYMENT_ENVIRONMENTS = [
  "production",
  "preview",
  "staging",
  "development",
] as const;

export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

export type DeploymentHealthCheckDefinition = {
  readonly kind: "http";
  readonly url: string;
  readonly expectedStatus?: number;
};

export type DeploymentSurfaceDefinition = {
  readonly id: string;
  readonly provider: string;
  readonly environment: DeploymentEnvironment;
  readonly health: DeploymentHealthCheckDefinition;
  readonly label?: string;
};

export type DeploymentManifestDefinition = {
  readonly schemaVersion: "1";
  readonly surfaces: readonly DeploymentSurfaceDefinition[];
};

export type DeploymentHealthCheck = {
  readonly kind: "http";
  readonly url: string;
  readonly expectedStatus: number;
};

export type DeploymentSurface = {
  readonly id: string;
  readonly provider: string;
  readonly environment: DeploymentEnvironment;
  readonly health: DeploymentHealthCheck;
  readonly label?: string;
};

export type DeploymentManifest = {
  readonly schemaVersion: "1";
  readonly surfaces: readonly DeploymentSurface[];
};

/** Explicit, non-secret static-site build requirements for one deployment surface. */
export type DeploymentBuildRequirementDefinition = {
  readonly command: string;
  readonly outputDirectory: string;
};

/** An internal rewrite. Routing order is preserved because it is semantically significant. */
export type DeploymentRoutingRequirementDefinition = {
  readonly source: string;
  readonly destination: string;
};

/** Requirements that map one verified surface to provider configuration. */
export type DeploymentConfigurationRequirementDefinition = {
  readonly surfaceId: string;
  readonly build: DeploymentBuildRequirementDefinition;
  readonly routing?: readonly DeploymentRoutingRequirementDefinition[];
  /** Names only. Values are deliberately outside this contract. */
  readonly requiredEnvironmentVariables?: readonly string[];
};

/** A manifest plus the explicit build, output, routing, and variable-name requirements to plan. */
export type DeploymentConfigurationPlanDefinition = {
  readonly manifest: DeploymentManifest;
  readonly requirements: readonly DeploymentConfigurationRequirementDefinition[];
};

export type DeploymentBuildRequirement = DeploymentBuildRequirementDefinition;

export type DeploymentRoutingRequirement = DeploymentRoutingRequirementDefinition;

export type DeploymentConfigurationRequirement = {
  readonly surfaceId: string;
  readonly build: DeploymentBuildRequirement;
  readonly routing: readonly DeploymentRoutingRequirement[];
  readonly requiredEnvironmentVariables: readonly string[];
};

/** A validated, detached, deterministically ordered provider-configuration plan. */
export type DeploymentConfigurationPlan = {
  readonly manifest: DeploymentManifest;
  readonly requirements: readonly DeploymentConfigurationRequirement[];
};

/** A provider artifact the caller may review and write to its own repository. */
export type DeploymentConfigurationArtifact = {
  readonly provider: "vercel" | "render";
  readonly path: "vercel.json" | "render.yaml";
  readonly content: string;
  readonly requiredEnvironmentVariables: readonly string[];
  readonly repositorySetup: readonly string[];
};

export type DeploymentFinding = {
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly path?: string;
};

export type DeploymentHealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export type DeploymentObservation = {
  readonly surfaceId: string;
  readonly status: DeploymentHealthStatus;
};

export type DeploymentHealthSummary = {
  readonly status: DeploymentHealthStatus;
  readonly healthy: number;
  readonly degraded: number;
  readonly unhealthy: number;
  readonly unknown: number;
};
