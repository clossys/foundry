import type { DeploymentManifest } from "./types.js";

/** Sorts independent surfaces for stable artifacts without changing their meaning. */
export function normalizeDeploymentManifest(manifest: DeploymentManifest): DeploymentManifest {
  return {
    schemaVersion: manifest.schemaVersion,
    surfaces: [...manifest.surfaces]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((surface) => ({ ...surface, health: { ...surface.health } })),
  };
}

export function serializeDeploymentManifest(manifest: DeploymentManifest): string {
  return `${JSON.stringify(normalizeDeploymentManifest(manifest), null, 2)}\n`;
}
