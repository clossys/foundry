/**
 * The repository file `builder hosting install` and `builder hosting should-build`
 * read (issue #1526). Private scopes are names, registries, and credential
 * variable names. Values stay outside this document.
 */

import { isProviderTokenName } from "./environment.js";

export const HOSTING_DECLARATION_FILE = "builder.hosting.json";
export const HOSTING_ROUTE_FILE = ".npmrc";

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const SCOPE = /^@[a-z0-9][a-z0-9-]*$/;
const ENVIRONMENT_VARIABLE = /^[A-Z][A-Z0-9_]{0,127}$/;
const DECLARATION_KEYS = new Set(["schemaVersion", "surfaces"]);
const SURFACE_KEYS = new Set(["id", "inputs", "privateScopes", "buildEnvironment"]);
const SCOPE_KEYS = new Set(["scope", "registry", "credentialVariable"]);

export type HostingFinding = {
  readonly rule: string;
  readonly message: string;
  readonly path?: string;
};

export type HostingPrivateScope = {
  readonly scope: string;
  readonly registry: string;
  readonly credentialVariable: string;
};

export type HostingSurface = {
  readonly id: string;
  readonly inputs: readonly string[];
  readonly privateScopes: readonly HostingPrivateScope[];
  readonly buildEnvironment: readonly string[];
};

export type HostingDeclaration = {
  readonly schemaVersion: "1";
  readonly surfaces: readonly HostingSurface[];
};

function record(findings: HostingFinding[], rule: string, message: string, path?: string): void {
  findings.push({ rule, message, ...(path === undefined ? {} : { path }) });
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, findings: HostingFinding[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) record(findings, "unknown-property", "Unsupported property.", `${path}.${key}`);
  }
}

function isRelativeInput(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256
    && value === value.trim()
    && !value.startsWith("/")
    && !value.includes("\\")
    && !value.split("/").some((part) => part.length === 0 || part === "." || part === "..");
}

/** An https registry URL with no userinfo, query, or fragment. */
export function isDeclaredRegistry(value: unknown): value is string {
  if (typeof value !== "string" || value !== value.trim() || value.length === 0 || value.length > 256) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.username.length === 0
      && url.password.length === 0
      && url.search.length === 0
      && url.hash.length === 0
      && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export function registriesMatch(declared: string, routed: string): boolean {
  const normalize = (value: string): string => (value.endsWith("/") ? value.slice(0, -1) : value);
  return normalize(declared) === normalize(routed);
}

function validate(value: unknown, findings: HostingFinding[]): void {
  if (!object(value)) {
    record(findings, "declaration-object", "Hosting declaration must be an object.");
    return;
  }
  rejectUnknownKeys(value, DECLARATION_KEYS, "declaration", findings);
  if (value.schemaVersion !== "1") record(findings, "schema-version", "schemaVersion must be '1'.", "declaration.schemaVersion");
  if (!Array.isArray(value.surfaces) || value.surfaces.length === 0) {
    record(findings, "surfaces", "surfaces must be a non-empty array.", "declaration.surfaces");
    return;
  }
  const ids = new Set<string>();
  for (const [index, surface] of value.surfaces.entries()) {
    const path = `declaration.surfaces[${index}]`;
    if (!object(surface)) {
      record(findings, "surface-object", "Surface must be an object.", path);
      continue;
    }
    rejectUnknownKeys(surface, SURFACE_KEYS, path, findings);
    if (typeof surface.id !== "string" || !ID.test(surface.id)) record(findings, "surface-id", "Surface id must be a lowercase stable identifier.", `${path}.id`);
    else if (ids.has(surface.id)) record(findings, "duplicate-surface-id", "Surface ids must be unique.", `${path}.id`);
    else ids.add(surface.id);

    if (!Array.isArray(surface.inputs)) record(findings, "inputs", "inputs must be an array of relative paths.", `${path}.inputs`);
    else {
      const seen = new Set<string>();
      for (const [inputIndex, input] of surface.inputs.entries()) {
        const inputPath = `${path}.inputs[${inputIndex}]`;
        if (!isRelativeInput(input)) record(findings, "input-path", "Each input must be a relative path without dot segments.", inputPath);
        else if (seen.has(input)) record(findings, "duplicate-input", "Inputs must be unique within a surface.", inputPath);
        else seen.add(input);
      }
    }

    if (!Array.isArray(surface.privateScopes)) record(findings, "private-scopes", "privateScopes must be an array.", `${path}.privateScopes`);
    else {
      const seenScopes = new Set<string>();
      for (const [scopeIndex, entry] of surface.privateScopes.entries()) {
        const scopePath = `${path}.privateScopes[${scopeIndex}]`;
        if (!object(entry)) {
          record(findings, "private-scope-object", "Private scope must be an object.", scopePath);
          continue;
        }
        rejectUnknownKeys(entry, SCOPE_KEYS, scopePath, findings);
        if (typeof entry.scope !== "string" || !SCOPE.test(entry.scope)) record(findings, "scope", "scope must be a lowercase npm scope.", `${scopePath}.scope`);
        else if (seenScopes.has(entry.scope)) record(findings, "duplicate-scope", "Private scopes must be unique within a surface.", `${scopePath}.scope`);
        else seenScopes.add(entry.scope);
        if (!isDeclaredRegistry(entry.registry)) record(findings, "registry", "registry must be an https URL without credentials, query, or fragment.", `${scopePath}.registry`);
        if (typeof entry.credentialVariable !== "string" || !ENVIRONMENT_VARIABLE.test(entry.credentialVariable)) {
          record(findings, "credential-variable", "credentialVariable must be an uppercase environment name.", `${scopePath}.credentialVariable`);
        } else if (isProviderTokenName(entry.credentialVariable)) {
          record(findings, "credential-variable", "A provider token is not a registry credential variable.", `${scopePath}.credentialVariable`);
        }
      }
    }

    if (surface.buildEnvironment !== undefined) {
      if (!Array.isArray(surface.buildEnvironment)) record(findings, "build-environment", "buildEnvironment must be an array of names when supplied.", `${path}.buildEnvironment`);
      else {
        const seen = new Set<string>();
        for (const [nameIndex, name] of surface.buildEnvironment.entries()) {
          const namePath = `${path}.buildEnvironment[${nameIndex}]`;
          if (typeof name !== "string" || !ENVIRONMENT_VARIABLE.test(name)) record(findings, "build-environment-name", "Build environment entries must be uppercase names.", namePath);
          else if (seen.has(name)) record(findings, "duplicate-build-environment-name", "Build environment names must be unique within a surface.", namePath);
          else seen.add(name);
        }
      }
    }
  }
}

export function validateHostingDeclaration(value: unknown): readonly HostingFinding[] {
  const findings: HostingFinding[] = [];
  try {
    validate(value, findings);
  } catch {
    record(findings, "declaration-unreadable", "Hosting declaration could not be read safely.");
  }
  return findings;
}

export function defineHostingDeclaration(value: unknown): HostingDeclaration {
  if (validateHostingDeclaration(value).length > 0) throw new TypeError("Invalid hosting declaration.");
  const declaration = value as {
    schemaVersion: "1";
    surfaces: readonly {
      id: string;
      inputs: readonly string[];
      privateScopes: readonly HostingPrivateScope[];
      buildEnvironment?: readonly string[];
    }[];
  };
  return {
    schemaVersion: "1",
    surfaces: declaration.surfaces.map((surface) => ({
      id: surface.id,
      inputs: [...surface.inputs],
      privateScopes: surface.privateScopes.map((entry) => ({
        scope: entry.scope,
        registry: entry.registry,
        credentialVariable: entry.credentialVariable,
      })),
      buildEnvironment: [...(surface.buildEnvironment ?? [])],
    })),
  };
}

/** Scope routes declared by a repository npmrc. Lines that are not scope routes are ignored. */
export function readScopeRoutes(npmrc: string): ReadonlyMap<string, string> {
  const routes = new Map<string, string>();
  for (const line of npmrc.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const match = /^(@[A-Za-z0-9][A-Za-z0-9-]*):registry=(\S+)$/.exec(trimmed);
    if (match?.[1] !== undefined && match[2] !== undefined) routes.set(match[1], match[2]);
  }
  return routes;
}
