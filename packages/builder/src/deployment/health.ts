import type { DeploymentHealthStatus, DeploymentHealthSummary, DeploymentObservation } from "./types.js";

const statuses: readonly DeploymentHealthStatus[] = ["healthy", "degraded", "unhealthy", "unknown"];

export function evaluateDeploymentHealth(observations: readonly DeploymentObservation[]): DeploymentHealthSummary {
  const counts: Record<DeploymentHealthStatus, number> = { healthy: 0, degraded: 0, unhealthy: 0, unknown: 0 };
  let recognizedObservations = 0;
  for (const observation of observations) {
    if (statuses.includes(observation.status)) {
      counts[observation.status] += 1;
      recognizedObservations += 1;
    }
  }
  const status: DeploymentHealthStatus = counts.unhealthy > 0
    ? "unhealthy"
    : counts.degraded > 0
      ? "degraded"
      : counts.unknown > 0 || recognizedObservations === 0
        ? "unknown"
        : "healthy";
  return { status, ...counts };
}
