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
