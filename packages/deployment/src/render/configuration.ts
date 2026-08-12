import { validateDeploymentConfigurationPlan } from "../configuration.js";
import type { DeploymentConfigurationArtifact, DeploymentConfigurationPlan } from "../types.js";

function yaml(value: string): string {
  return JSON.stringify(value);
}

function renderService(plan: DeploymentConfigurationPlan, surfaceId: string): readonly string[] {
  const surface = plan.manifest.surfaces.find((candidate) => candidate.id === surfaceId && candidate.provider === "render");
  const requirement = plan.requirements.find((candidate) => candidate.surfaceId === surfaceId);
  if (surface === undefined || requirement === undefined) throw new TypeError("Invalid render configuration plan.");
  const lines = [
    "  - type: web",
    "    runtime: static",
    `    name: ${yaml(surface.id)}`,
    `    buildCommand: ${yaml(requirement.build.command)}`,
    `    staticPublishPath: ${yaml(`./${requirement.build.outputDirectory}`)}`,
  ];
  if (requirement.routing.length > 0) {
    lines.push("    routes:");
    for (const route of requirement.routing) {
      lines.push("      - type: rewrite", `        source: ${yaml(route.source)}`, `        destination: ${yaml(route.destination)}`);
    }
  }
  return lines;
}

function variableNames(plan: DeploymentConfigurationPlan): readonly string[] {
  return [...new Set(plan.requirements
    .filter((requirement) => plan.manifest.surfaces.some((surface) => surface.id === requirement.surfaceId && surface.provider === "render"))
    .flatMap((requirement) => requirement.requiredEnvironmentVariables))]
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Deterministically renders a static-site Render Blueprint. It performs no
 * filesystem, authentication, provider API, or deployment work.
 */
export function renderRenderConfiguration(plan: DeploymentConfigurationPlan): DeploymentConfigurationArtifact {
  if (validateDeploymentConfigurationPlan(plan).length > 0) throw new TypeError("Invalid deployment configuration plan.");
  const surfaceIds = plan.manifest.surfaces
    .filter((surface) => surface.provider === "render")
    .map((surface) => surface.id)
    .sort((left, right) => left.localeCompare(right));
  if (surfaceIds.length === 0) throw new TypeError("Deployment configuration plan has no render surface.");
  const requiredEnvironmentVariables = variableNames(plan);
  return {
    provider: "render",
    path: "render.yaml",
    content: `services:\n${surfaceIds.flatMap((surfaceId) => renderService(plan, surfaceId)).join("\n")}\n`,
    requiredEnvironmentVariables,
    repositorySetup: [
      "Review the generated render.yaml and write it at the repository root.",
      "Create or link a Render Blueprint for the repository and select render.yaml as its Blueprint file.",
      requiredEnvironmentVariables.length === 0
        ? "No provider environment-variable names are required by this plan."
        : `Set these names in the Render service settings without committing values: ${requiredEnvironmentVariables.join(", ")}.`,
      "Review the Blueprint in Render before applying it; this artifact does not authenticate, apply configuration, or deploy.",
    ],
  };
}
