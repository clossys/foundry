import { DEPLOYMENT_ENVIRONMENTS, type DeploymentFinding, type DeploymentManifestDefinition } from "./types.js";

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const SURFACE_KEYS = new Set(["id", "provider", "environment", "health", "label"]);
const HEALTH_KEYS = new Set(["kind", "url", "expectedStatus"]);
const MANIFEST_KEYS = new Set(["schemaVersion", "surfaces"]);

function record(findings: DeploymentFinding[], rule: string, message: string, path?: string): void {
  findings.push({ rule, severity: "error", message, ...(path === undefined ? {} : { path }) });
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, findings: DeploymentFinding[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) record(findings, "unknown-property", "Unsupported property.", `${path}.${key}`);
  }
}

export function validateDeploymentManifest(value: unknown): readonly DeploymentFinding[] {
  const findings: DeploymentFinding[] = [];
  if (!object(value)) {
    record(findings, "manifest-object", "Deployment manifest must be an object.");
    return findings;
  }
  rejectUnknownKeys(value, MANIFEST_KEYS, "manifest", findings);
  if (value.schemaVersion !== "1") record(findings, "schema-version", "schemaVersion must be '1'.", "manifest.schemaVersion");
  if (!Array.isArray(value.surfaces) || value.surfaces.length === 0) {
    record(findings, "surfaces", "surfaces must be a non-empty array.", "manifest.surfaces");
    return findings;
  }
  const ids = new Set<string>();
  for (const [index, surface] of value.surfaces.entries()) {
    const path = `manifest.surfaces[${index}]`;
    if (!object(surface)) {
      record(findings, "surface-object", "Surface must be an object.", path);
      continue;
    }
    rejectUnknownKeys(surface, SURFACE_KEYS, path, findings);
    if (typeof surface.id !== "string" || !ID.test(surface.id)) record(findings, "surface-id", "Surface id must be a lowercase stable identifier.", `${path}.id`);
    else if (ids.has(surface.id)) record(findings, "duplicate-surface-id", "Surface ids must be unique.", `${path}.id`);
    else ids.add(surface.id);
    if (typeof surface.provider !== "string" || !ID.test(surface.provider)) record(findings, "provider", "Provider must be a lowercase stable identifier.", `${path}.provider`);
    if (!DEPLOYMENT_ENVIRONMENTS.includes(surface.environment as (typeof DEPLOYMENT_ENVIRONMENTS)[number])) record(findings, "environment", "Environment is not supported.", `${path}.environment`);
    if (surface.label !== undefined && (typeof surface.label !== "string" || surface.label.trim().length === 0)) record(findings, "label", "Label must be a non-empty string when supplied.", `${path}.label`);
    if (!object(surface.health)) {
      record(findings, "health-object", "Health check must be an object.", `${path}.health`);
      continue;
    }
    rejectUnknownKeys(surface.health, HEALTH_KEYS, `${path}.health`, findings);
    if (surface.health.kind !== "http") record(findings, "health-kind", "Health check kind must be 'http'.", `${path}.health.kind`);
    if (typeof surface.health.url !== "string") record(findings, "health-url", "Health check URL must be an HTTPS URL without credentials, query, or fragment.", `${path}.health.url`);
    else {
      try {
        const url = new URL(surface.health.url);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
      } catch {
        record(findings, "health-url", "Health check URL must be an HTTPS URL without credentials, query, or fragment.", `${path}.health.url`);
      }
    }
    if (surface.health.expectedStatus !== undefined && (typeof surface.health.expectedStatus !== "number" || !Number.isInteger(surface.health.expectedStatus) || surface.health.expectedStatus < 100 || surface.health.expectedStatus > 599)) record(findings, "health-status", "Expected status must be an integer from 100 through 599.", `${path}.health.expectedStatus`);
  }
  return findings;
}

export function isValidDeploymentManifest(value: unknown): value is DeploymentManifestDefinition {
  return !validateDeploymentManifest(value).some((finding) => finding.severity === "error");
}
