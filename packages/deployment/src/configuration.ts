import { normalizeDeploymentManifest } from "./normalize.js";
import {
  type DeploymentConfigurationPlan,
  type DeploymentConfigurationPlanDefinition,
  type DeploymentFinding,
  type DeploymentManifest,
} from "./types.js";
import { validateDeploymentManifest } from "./validate.js";

const PLAN_KEYS = new Set(["manifest", "requirements"]);
const REQUIREMENT_KEYS = new Set(["surfaceId", "build", "routing", "requiredEnvironmentVariables"]);
const BUILD_KEYS = new Set(["command", "outputDirectory"]);
const ROUTE_KEYS = new Set(["source", "destination"]);
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const ENVIRONMENT_VARIABLE = /^[A-Z][A-Z0-9_]{0,127}$/;

function record(findings: DeploymentFinding[], rule: string, message: string, path?: string): void {
  findings.push({ rule, severity: "error", message, ...(path === undefined ? {} : { path }) });
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, findings: DeploymentFinding[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) record(findings, "configuration-unknown-property", "Unsupported configuration property.", `${path}.${key}`);
  }
}

function isRelativeOutputDirectory(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256
    && value === value.trim()
    && !value.includes("\\")
    && value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function isRoutePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && value === value.trim()
    && value.startsWith("/")
    && !value.startsWith("//")
    && !/[\r\n\t?#]/.test(value);
}

function isBuildCommand(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= 1_000
    && !/[\r\n\0]/.test(value);
}

function validatePlan(value: unknown, findings: DeploymentFinding[]): void {
  if (!object(value)) {
    record(findings, "configuration-plan-object", "Deployment configuration plan must be an object.");
    return;
  }
  rejectUnknownKeys(value, PLAN_KEYS, "plan", findings);

  const manifestFindings = validateDeploymentManifest(value.manifest);
  for (const finding of manifestFindings) {
    record(findings, `configuration-${finding.rule}`, finding.message, finding.path === undefined ? undefined : `plan.${finding.path}`);
  }
  if (!Array.isArray(value.requirements) || value.requirements.length === 0) {
    record(findings, "configuration-requirements", "requirements must be a non-empty array.", "plan.requirements");
    return;
  }

  const manifestSurfaces = object(value.manifest) && Array.isArray(value.manifest.surfaces)
    ? value.manifest.surfaces.filter(object)
    : [];
  const providerBySurfaceId = new Map<string, string>();
  for (const surface of manifestSurfaces) {
    if (typeof surface.id === "string" && typeof surface.provider === "string") providerBySurfaceId.set(surface.id, surface.provider);
  }

  const requirementSurfaceIds = new Set<string>();
  const providerCounts = new Map<string, number>();
  for (const [index, requirement] of value.requirements.entries()) {
    const path = `plan.requirements[${index}]`;
    if (!object(requirement)) {
      record(findings, "configuration-requirement-object", "Requirement must be an object.", path);
      continue;
    }
    rejectUnknownKeys(requirement, REQUIREMENT_KEYS, path, findings);
    if (typeof requirement.surfaceId !== "string" || !ID.test(requirement.surfaceId)) {
      record(findings, "configuration-surface-id", "surfaceId must be a lowercase stable identifier.", `${path}.surfaceId`);
    } else if (requirementSurfaceIds.has(requirement.surfaceId)) {
      record(findings, "configuration-duplicate-surface-id", "Requirements must have unique surface ids.", `${path}.surfaceId`);
    } else {
      requirementSurfaceIds.add(requirement.surfaceId);
      const provider = providerBySurfaceId.get(requirement.surfaceId);
      if (provider === undefined) record(findings, "configuration-unknown-surface", "Requirement must reference a manifest surface.", `${path}.surfaceId`);
      else if (provider !== "vercel" && provider !== "render") record(findings, "configuration-provider", "Configuration planning supports only vercel and render surfaces.", `${path}.surfaceId`);
      else providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1);
    }

    if (!object(requirement.build)) {
      record(findings, "configuration-build-object", "build must be an object.", `${path}.build`);
    } else {
      rejectUnknownKeys(requirement.build, BUILD_KEYS, `${path}.build`, findings);
      if (!isBuildCommand(requirement.build.command)) record(findings, "configuration-build-command", "build.command must be a non-empty single-line command.", `${path}.build.command`);
      if (!isRelativeOutputDirectory(requirement.build.outputDirectory)) record(findings, "configuration-output-directory", "build.outputDirectory must be a non-empty relative path without dot segments.", `${path}.build.outputDirectory`);
    }

    if (requirement.routing !== undefined) {
      if (!Array.isArray(requirement.routing)) record(findings, "configuration-routing", "routing must be an array when supplied.", `${path}.routing`);
      else {
        const routeSources = new Set<string>();
        for (const [routeIndex, route] of requirement.routing.entries()) {
          const routePath = `${path}.routing[${routeIndex}]`;
          if (!object(route)) {
            record(findings, "configuration-route-object", "Route must be an object.", routePath);
            continue;
          }
          rejectUnknownKeys(route, ROUTE_KEYS, routePath, findings);
          if (!isRoutePath(route.source)) record(findings, "configuration-route-source", "Route source must be an internal path without a query or fragment.", `${routePath}.source`);
          else if (routeSources.has(route.source)) record(findings, "configuration-duplicate-route-source", "Route sources must be unique within a surface.", `${routePath}.source`);
          else routeSources.add(route.source);
          if (!isRoutePath(route.destination)) record(findings, "configuration-route-destination", "Route destination must be an internal path without a query or fragment.", `${routePath}.destination`);
        }
      }
    }

    if (requirement.requiredEnvironmentVariables !== undefined) {
      if (!Array.isArray(requirement.requiredEnvironmentVariables)) record(findings, "configuration-environment-variables", "requiredEnvironmentVariables must be an array when supplied.", `${path}.requiredEnvironmentVariables`);
      else {
        const names = new Set<string>();
        for (const [variableIndex, name] of requirement.requiredEnvironmentVariables.entries()) {
          const variablePath = `${path}.requiredEnvironmentVariables[${variableIndex}]`;
          if (typeof name !== "string" || !ENVIRONMENT_VARIABLE.test(name)) record(findings, "configuration-environment-variable-name", "Environment variables must be uppercase names containing only letters, digits, and underscores.", variablePath);
          else if (names.has(name)) record(findings, "configuration-duplicate-environment-variable", "Environment variable names must be unique within a surface.", variablePath);
          else names.add(name);
        }
      }
    }
  }

  for (const surface of manifestSurfaces) {
    if (typeof surface.id === "string" && !requirementSurfaceIds.has(surface.id)) record(findings, "configuration-missing-requirement", "Each manifest surface requires build, output, and routing requirements.", "plan.requirements");
  }
  if ((providerCounts.get("vercel") ?? 0) > 1) record(findings, "configuration-vercel-surface-count", "A repository configuration plan supports one vercel surface; use one plan per Vercel project.", "plan.requirements");
}

/**
 * Reports structural planning errors without reading environment variables,
 * secret stores, repositories, or provider state.
 */
export function validateDeploymentConfigurationPlan(value: unknown): readonly DeploymentFinding[] {
  const findings: DeploymentFinding[] = [];
  try {
    validatePlan(value, findings);
  } catch {
    record(findings, "configuration-plan-unreadable", "Deployment configuration plan could not be read safely.");
  }
  return findings;
}

export function isValidDeploymentConfigurationPlan(value: unknown): value is DeploymentConfigurationPlanDefinition {
  return !validateDeploymentConfigurationPlan(value).some((finding) => finding.severity === "error");
}

/** Creates a detached, normalized plan after callers have validated their manifest and requirements. */
export function defineDeploymentConfigurationPlan(definition: DeploymentConfigurationPlanDefinition): DeploymentConfigurationPlan {
  if (!isValidDeploymentConfigurationPlan(definition)) throw new TypeError("Invalid deployment configuration plan.");
  return {
    manifest: normalizeDeploymentManifest(definition.manifest as DeploymentManifest),
    requirements: definition.requirements
      .map((requirement) => ({
        surfaceId: requirement.surfaceId,
        build: { command: requirement.build.command, outputDirectory: requirement.build.outputDirectory },
        routing: (requirement.routing ?? []).map((route) => ({ source: route.source, destination: route.destination })),
        requiredEnvironmentVariables: [...(requirement.requiredEnvironmentVariables ?? [])].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => left.surfaceId.localeCompare(right.surfaceId)),
  };
}
