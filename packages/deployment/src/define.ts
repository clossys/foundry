import type { DeploymentManifest, DeploymentManifestDefinition } from "./types.js";

/** Produces a detached, explicit deployment manifest. Validate author input separately. */
export function defineDeploymentManifest(definition: DeploymentManifestDefinition): DeploymentManifest {
  return {
    schemaVersion: definition.schemaVersion,
    surfaces: definition.surfaces.map((surface) => ({
      id: surface.id,
      provider: surface.provider,
      environment: surface.environment,
      health: {
        kind: surface.health.kind,
        url: surface.health.url,
        expectedStatus: surface.health.expectedStatus ?? 200,
      },
      ...(surface.label === undefined ? {} : { label: surface.label }),
    })),
  };
}
