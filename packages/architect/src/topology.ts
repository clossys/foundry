import {
  OPERATING_RESPONSIBILITIES,
  OPERATING_SCOPE_KINDS,
  OPERATING_SYSTEM_KINDS,
  type ArchitectureFinding,
  type AuthorityDefinition,
  type OperatingInterfaceDefinition,
  type OperatingSystemDefinition,
  type OperatingTopology,
  type OperatingTopologyCompatibilityReport,
  type OperatingTopologyDefinition,
  type OperatingTopologyChange,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finding(rule: string, message: string, path: string): ArchitectureFinding {
  return { rule, severity: "error", message, path };
}

function requiredString(value: unknown, key: string, path: string, findings: ArchitectureFinding[]): string | undefined {
  if (!isRecord(value) || typeof value[key] !== "string" || value[key].length === 0) {
    findings.push(finding("required-string", `${key} must be a non-empty string.`, path));
    return undefined;
  }
  return value[key] as string;
}

function arrayAt(value: UnknownRecord, key: string, path: string, findings: ArchitectureFinding[]): unknown[] {
  if (value[key] === undefined) return [];
  if (Array.isArray(value[key])) return value[key] as unknown[];
  findings.push(finding("collection-shape", `${key} must be an array when provided.`, path));
  return [];
}

function uniqueStrings(value: unknown, path: string, findings: ArchitectureFinding[]): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    findings.push(finding("responsibilities-shape", "responsibilities must be a non-empty array.", path));
    return [];
  }
  const result: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !(OPERATING_RESPONSIBILITIES as readonly string[]).includes(item)) {
      findings.push(finding("responsibility-known", "responsibility must be a supported value.", `${path}[${index}]`));
    } else if (result.includes(item)) {
      findings.push(finding("duplicate-responsibility", `Duplicate responsibility "${item}".`, `${path}[${index}]`));
    } else result.push(item);
  }
  return result;
}

/** Creates a detached topology definition without asserting that it is valid. */
export function defineOperatingTopology(definition: OperatingTopologyDefinition): OperatingTopology {
  return {
    id: definition.id,
    schemaVersion: definition.schemaVersion,
    scope: { ...definition.scope },
    systems: (definition.systems ?? []).map((system) => ({ ...system, responsibilities: [...system.responsibilities] })),
    authorities: (definition.authorities ?? []).map((authority) => ({ ...authority })),
    interfaces: (definition.interfaces ?? []).map((entry) => ({ ...entry, responsibilities: [...entry.responsibilities] })),
  };
}

/** Validates shape, identities, references, ownership and declared interfaces without I/O. */
export function validateOperatingTopology(value: unknown): ArchitectureFinding[] {
  const findings: ArchitectureFinding[] = [];
  if (!isRecord(value)) return [finding("topology-shape", "An operating topology must be an object.", "$")];
  const topologyId = requiredString(value, "id", "id", findings);
  if (topologyId !== undefined && !/^[a-z][a-z0-9-]*$/.test(topologyId)) findings.push(finding("topology-id-shape", "id must be a lowercase namespace token.", "id"));
  requiredString(value, "schemaVersion", "schemaVersion", findings);

  const scope = value.scope;
  if (!isRecord(scope)) findings.push(finding("scope-shape", "scope must be an object.", "scope"));
  else {
    requiredString(scope, "id", "scope.id", findings);
    const kind = requiredString(scope, "kind", "scope.kind", findings);
    if (kind !== undefined && !(OPERATING_SCOPE_KINDS as readonly string[]).includes(kind)) findings.push(finding("scope-kind-known", "scope.kind must be portfolio or business.", "scope.kind"));
  }

  const systems = arrayAt(value, "systems", "systems", findings);
  const systemIds = new Set<string>();
  const systemResponsibilities = new Map<string, ReadonlySet<string>>();
  const responsibilityCoverage = new Set<string>();
  for (const [index, candidate] of systems.entries()) {
    const path = `systems[${index}]`;
    if (!isRecord(candidate)) { findings.push(finding("system-shape", "A system must be an object.", path)); continue; }
    const id = requiredString(candidate, "id", `${path}.id`, findings);
    if (id !== undefined) {
      if (systemIds.has(id)) findings.push(finding("duplicate-system-id", `Duplicate system id "${id}".`, `${path}.id`));
      systemIds.add(id);
    }
    const kind = requiredString(candidate, "kind", `${path}.kind`, findings);
    if (kind !== undefined && !(OPERATING_SYSTEM_KINDS as readonly string[]).includes(kind)) findings.push(finding("system-kind-known", "kind must be a supported system kind.", `${path}.kind`));
    const responsibilities = uniqueStrings(candidate.responsibilities, `${path}.responsibilities`, findings);
    for (const responsibility of responsibilities) responsibilityCoverage.add(responsibility);
    if (id !== undefined && !systemResponsibilities.has(id)) systemResponsibilities.set(id, new Set(responsibilities));
    for (const optional of ["provider", "locator"] as const) if (candidate[optional] !== undefined && typeof candidate[optional] !== "string") findings.push(finding(`${optional}-shape`, `${optional} must be a string when provided.`, `${path}.${optional}`));
    if (candidate.visibility !== undefined && !["public", "private", "restricted"].includes(candidate.visibility as string)) findings.push(finding("visibility-known", "visibility must be public, private, or restricted.", `${path}.visibility`));
  }
  if (systems.length === 0) findings.push(finding("systems-required", "At least one system is required.", "systems"));
  if (!responsibilityCoverage.has("control-plane")) findings.push(finding("control-plane-required", "At least one system must implement the control-plane responsibility.", "systems"));

  const authorities = arrayAt(value, "authorities", "authorities", findings);
  if (authorities.length === 0) findings.push(finding("authorities-required", "At least one authority is required.", "authorities"));
  const authorityResponsibilities = new Set<string>();
  for (const [index, candidate] of authorities.entries()) {
    const path = `authorities[${index}]`;
    if (!isRecord(candidate)) { findings.push(finding("authority-shape", "An authority must be an object.", path)); continue; }
    const responsibility = requiredString(candidate, "responsibility", `${path}.responsibility`, findings);
    if (responsibility !== undefined) {
      if (!(OPERATING_RESPONSIBILITIES as readonly string[]).includes(responsibility)) findings.push(finding("responsibility-known", "responsibility must be a supported value.", `${path}.responsibility`));
      if (!responsibilityCoverage.has(responsibility)) findings.push(finding("responsibility-unimplemented", `No system implements responsibility "${responsibility}".`, `${path}.responsibility`));
      if (authorityResponsibilities.has(responsibility)) findings.push(finding("duplicate-authority", `Responsibility "${responsibility}" has more than one authority.`, `${path}.responsibility`));
      authorityResponsibilities.add(responsibility);
    }
    requiredString(candidate, "owner", `${path}.owner`, findings);
    const record = requiredString(candidate, "systemOfRecord", `${path}.systemOfRecord`, findings);
    if (record !== undefined && !systemIds.has(record)) findings.push(finding("system-of-record-known", `systemOfRecord "${record}" is not a declared system.`, `${path}.systemOfRecord`));
    else if (record !== undefined && responsibility !== undefined && (OPERATING_RESPONSIBILITIES as readonly string[]).includes(responsibility) && !systemResponsibilities.get(record)?.has(responsibility)) {
      findings.push(finding("system-of-record-responsibility", `systemOfRecord "${record}" does not implement responsibility "${responsibility}".`, `${path}.systemOfRecord`));
    }
  }
  for (const responsibility of responsibilityCoverage) if (!authorityResponsibilities.has(responsibility)) findings.push(finding("authority-required", `Responsibility "${responsibility}" needs exactly one authority.`, "authorities"));

  const interfaces = arrayAt(value, "interfaces", "interfaces", findings);
  const interfaceIds = new Set<string>();
  for (const [index, candidate] of interfaces.entries()) {
    const path = `interfaces[${index}]`;
    if (!isRecord(candidate)) { findings.push(finding("interface-shape", "An interface must be an object.", path)); continue; }
    const id = requiredString(candidate, "id", `${path}.id`, findings);
    if (id !== undefined) {
      if (interfaceIds.has(id)) findings.push(finding("duplicate-interface-id", `Duplicate interface id "${id}".`, `${path}.id`));
      interfaceIds.add(id);
    }
    for (const endpoint of ["from", "to"] as const) {
      const system = requiredString(candidate, endpoint, `${path}.${endpoint}`, findings);
      if (system !== undefined && !systemIds.has(system)) findings.push(finding("interface-system-known", `${endpoint} system "${system}" is not declared.`, `${path}.${endpoint}`));
    }
    if (candidate.from !== undefined && candidate.from === candidate.to) findings.push(finding("interface-boundary", "An interface must cross two different systems.", path));
    const responsibilities = uniqueStrings(candidate.responsibilities, `${path}.responsibilities`, findings);
    for (const responsibility of responsibilities) {
      if (!responsibilityCoverage.has(responsibility)) findings.push(finding("interface-responsibility-unimplemented", `No system implements interface responsibility "${responsibility}".`, `${path}.responsibilities`));
    }
    if (candidate.description !== undefined && typeof candidate.description !== "string") findings.push(finding("description-shape", "description must be a string when provided.", `${path}.description`));
  }
  return findings;
}

function byId<T extends { id: string }>(left: T, right: T): number { return left.id.localeCompare(right.id); }

/** Returns one canonical property layout and ordering. */
export function normalizeOperatingTopology(definition: OperatingTopologyDefinition): OperatingTopology {
  const value = defineOperatingTopology(definition);
  const systems: OperatingSystemDefinition[] = value.systems.map((system) => {
    const next: OperatingSystemDefinition = { id: system.id, kind: system.kind, responsibilities: [...system.responsibilities].sort() };
    if (system.provider !== undefined) next.provider = system.provider;
    if (system.locator !== undefined) next.locator = system.locator;
    if (system.visibility !== undefined) next.visibility = system.visibility;
    return next;
  });
  const authorities: AuthorityDefinition[] = value.authorities.map((entry) => ({ responsibility: entry.responsibility, owner: entry.owner, systemOfRecord: entry.systemOfRecord }));
  const interfaces: OperatingInterfaceDefinition[] = value.interfaces.map((entry) => {
    const next: OperatingInterfaceDefinition = { id: entry.id, from: entry.from, to: entry.to, responsibilities: [...entry.responsibilities].sort() };
    if (entry.description !== undefined) next.description = entry.description;
    return next;
  });
  return { id: value.id, schemaVersion: value.schemaVersion, scope: { id: value.scope.id, kind: value.scope.kind }, systems: systems.sort(byId), authorities: authorities.sort((a, b) => a.responsibility.localeCompare(b.responsibility)), interfaces: interfaces.sort(byId) };
}

export function serializeOperatingTopology(definition: OperatingTopologyDefinition): string {
  return `${JSON.stringify(normalizeOperatingTopology(definition), null, 2)}\n`;
}

function mapById<T extends { id: string }>(values: readonly T[]): Map<string, T> { return new Map(values.map((value) => [value.id, value])); }

/** Compares stable architectural contracts. Description and schemaVersion are not compatibility surface. */
export function compareOperatingTopologies(previous: OperatingTopologyDefinition, next: OperatingTopologyDefinition): OperatingTopologyCompatibilityReport {
  const previousFindings = validateOperatingTopology(previous);
  const nextFindings = validateOperatingTopology(next);
  if (previousFindings.some((entry) => entry.severity === "error") || nextFindings.some((entry) => entry.severity === "error")) return { compatible: false, changes: [], previousFindings, nextFindings };
  const before = normalizeOperatingTopology(previous);
  const after = normalizeOperatingTopology(next);
  const changes: OperatingTopologyChange[] = [];
  if (before.id !== after.id) changes.push({ kind: "breaking", subject: "topology", id: after.id, message: `Topology id changed from "${before.id}" to "${after.id}".` });
  if (JSON.stringify(before.scope) !== JSON.stringify(after.scope)) changes.push({ kind: "breaking", subject: "scope", id: after.scope.id, message: "Operating scope changed." });
  const compareCollection = <T extends { id: string }>(subject: "system" | "interface", left: readonly T[], right: readonly T[], contract: (value: T) => unknown): void => {
    const oldValues = mapById(left); const newValues = mapById(right);
    for (const [id, value] of oldValues) {
      const replacement = newValues.get(id);
      if (replacement === undefined) changes.push({ kind: "breaking", subject, id, message: `${subject} "${id}" was removed.` });
      else if (JSON.stringify(contract(value)) !== JSON.stringify(contract(replacement))) changes.push({ kind: "breaking", subject, id, message: `${subject} "${id}" changed contract.` });
    }
    for (const [id] of newValues) if (!oldValues.has(id)) changes.push({ kind: "additive", subject, id, message: `${subject} "${id}" was added.` });
  };
  compareCollection("system", before.systems, after.systems, (entry) => entry);
  compareCollection("interface", before.interfaces, after.interfaces, (entry) => ({ id: entry.id, from: entry.from, to: entry.to, responsibilities: entry.responsibilities }));
  const oldAuthorities = new Map(before.authorities.map((entry) => [entry.responsibility, entry]));
  const newAuthorities = new Map(after.authorities.map((entry) => [entry.responsibility, entry]));
  for (const [id, value] of oldAuthorities) {
    const replacement = newAuthorities.get(id);
    if (replacement === undefined) changes.push({ kind: "breaking", subject: "authority", id, message: `authority "${id}" was removed.` });
    else if (JSON.stringify(value) !== JSON.stringify(replacement)) changes.push({ kind: "breaking", subject: "authority", id, message: `authority "${id}" changed contract.` });
  }
  for (const [id] of newAuthorities) if (!oldAuthorities.has(id)) changes.push({ kind: "additive", subject: "authority", id, message: `authority "${id}" was added.` });
  changes.sort((a, b) => `${a.subject}:${a.id}:${a.kind}`.localeCompare(`${b.subject}:${b.id}:${b.kind}`));
  return { compatible: changes.every((entry) => entry.kind !== "breaking"), changes, previousFindings, nextFindings };
}
