import { validateDeploymentConfigurationPlan } from "../configuration.js";
import type { DeploymentConfigurationArtifact, DeploymentConfigurationPlan } from "../types.js";

function variableNames(plan: DeploymentConfigurationPlan): readonly string[] {
  return [...new Set(plan.requirements
    .filter((requirement) => plan.manifest.surfaces.some((surface) => surface.id === requirement.surfaceId && surface.provider === "vercel"))
    .flatMap((requirement) => requirement.requiredEnvironmentVariables))]
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Deterministically renders the one repository-root vercel.json configuration
 * supported by a configuration plan. It performs no filesystem or network I/O.
 */
export function renderVercelConfiguration(plan: DeploymentConfigurationPlan): DeploymentConfigurationArtifact {
  if (validateDeploymentConfigurationPlan(plan).length > 0) throw new TypeError("Invalid deployment configuration plan.");
  const requirement = plan.requirements.find((candidate) => plan.manifest.surfaces.some((surface) => surface.id === candidate.surfaceId && surface.provider === "vercel"));
  if (requirement === undefined) throw new TypeError("Deployment configuration plan has no vercel surface.");
  const content = `${JSON.stringify({
    $schema: "https://openapi.vercel.sh/vercel.json",
    buildCommand: requirement.build.command,
    outputDirectory: requirement.build.outputDirectory,
    ...(requirement.routing.length === 0 ? {} : { rewrites: requirement.routing }),
  }, null, 2)}\n`;
  const requiredEnvironmentVariables = variableNames(plan);
  return {
    provider: "vercel",
    path: "vercel.json",
    content,
    requiredEnvironmentVariables,
    repositorySetup: [
      "Review the generated vercel.json and write it at the repository root.",
      "Import the repository into one Vercel project with its Root Directory set to the repository root.",
      requiredEnvironmentVariables.length === 0
        ? "No provider environment-variable names are required by this plan."
        : `Set these names in the Vercel project settings or CI without committing values: ${requiredEnvironmentVariables.join(", ")}.`,
      "Keep deployment triggering in the repository and provider integration; this artifact does not deploy or change provider settings.",
    ],
  };
}
