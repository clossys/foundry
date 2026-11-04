import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadCatalog, type StrategyCatalog } from "./catalog.js";
import type { CellId } from "./format/types.js";
import { isPlainObject, type ValidationIssue, type ValidationResult } from "./validation.js";

export interface BriefContract {
  id: string; schemaVersion: 1; owner: string; requires: CellId[]; optional: CellId[];
  /** Carry these labelled Direction bullets; Watch tripwires are always carried. */
  keys?: Record<CellId, string[]>;
}
export interface BriefContractDiscovery { contracts: BriefContract[]; issues: ValidationIssue[] }
const contractId = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

export function validateBriefContract(value: unknown, catalog: StrategyCatalog = loadCatalog()): ValidationResult<BriefContract> {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (!isPlainObject(value)) return { ok: false, issues: [{ path: "contract", message: "Expected a brief contract object" }] };
  for (const field of Object.keys(value)) if (!["id", "schemaVersion", "owner", "requires", "optional", "keys"].includes(field)) add(field, "Unknown contract field");
  if (typeof value.id !== "string" || !contractId.test(value.id)) add("id", "Expected a safe dotted contract id");
  if (value.schemaVersion !== 1) add("schemaVersion", "Expected schemaVersion 1");
  if (typeof value.owner !== "string" || !value.owner.trim()) add("owner", "Expected a nonempty owner");
  const known = new Set(catalog.cells.map(cell => cell.id)); const selected = new Set<string>();
  for (const field of ["requires", "optional"] as const) {
    const ids = value[field];
    if (!Array.isArray(ids)) { add(field, "Expected an array of cell ids"); continue; }
    for (const [i, id] of ids.entries()) {
      if (typeof id !== "string" || !known.has(id)) add(`${field}[${i}]`, "Unknown cell id");
      else if (selected.has(id)) add(`${field}[${i}]`, "Duplicate required/optional cell id");
      else selected.add(id);
    }
  }
  if (value.keys !== undefined) {
    if (!isPlainObject(value.keys)) add("keys", "Expected a cell-id map of labelled bullet keys");
    else for (const [id, keys] of Object.entries(value.keys)) {
      if (!known.has(id) || !selected.has(id)) add(`keys.${id}`, "Keys must name a selected known cell");
      if (!Array.isArray(keys) || keys.some(key => typeof key !== "string" || !key.trim()) || new Set(keys).size !== keys.length) add(`keys.${id}`, "Expected unique nonempty bullet labels");
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as BriefContract };
}

/** Resolve every path component before use. No symlink in a strategy-root path is followed. */
function confined(root: string, path: string): string {
  if (lstatSync(root).isSymbolicLink()) throw new Error("Symlink root is not allowed");
  const anchor = realpathSync(root);
  if (!lstatSync(anchor).isDirectory()) throw new Error("Expected a directory root");
  const rel = relative(anchor, resolve(anchor, path));
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Path is outside root");
  let current = anchor;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("Symlink path is not allowed");
  }
  return current;
}
function absent(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === "ENOENT"; }

/** Internal shared reader for contract/cache files; undefined means absent, other failures throw. */
export function readBriefRootFile(root: string, path: string): string | undefined {
  let fd: number | undefined;
  try {
    const full = confined(resolve(root), path);
    fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd);
    if (!opened.isFile()) throw new Error("Expected a regular file");
    const current = lstatSync(confined(resolve(root), path));
    if (current.dev !== opened.dev || current.ino !== opened.ino) throw new Error("File changed while opening");
    return readFileSync(fd, "utf8");
  } catch (error) { if (absent(error)) return undefined; throw error; }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** Canonical contract meaning: input order does not create a false conflict. */
function signature(contract: BriefContract): string {
  return JSON.stringify({ id: contract.id, schemaVersion: contract.schemaVersion, owner: contract.owner, requires: [...contract.requires].sort(), optional: [...contract.optional].sort(),
    keys: contract.keys ? Object.fromEntries(Object.entries(contract.keys).sort(([a], [b]) => a.localeCompare(b)).map(([id, keys]) => [id, [...keys].sort()])) : undefined });
}

/** Combines sources without silently allowing a conflicting id to override another. */
export function mergeBriefContracts(values: unknown[], catalog: StrategyCatalog = loadCatalog()): BriefContractDiscovery {
  const contracts = new Map<string, BriefContract>(); const blocked = new Set<string>(); const issues: ValidationIssue[] = [];
  for (const [i, value] of values.entries()) {
    const result = validateBriefContract(value, catalog);
    if (!result.ok) { issues.push(...result.issues.map(issue => ({ ...issue, path: `contracts[${i}].${issue.path}` }))); continue; }
    const contract = result.value; const previous = contracts.get(contract.id);
    if (previous && signature(previous) !== signature(contract)) {
      issues.push({ path: `contracts[${i}].id`, message: `Conflicting brief contract id: ${contract.id}` });
      contracts.delete(contract.id); blocked.add(contract.id);
    } else if (!blocked.has(contract.id)) contracts.set(contract.id, contract);
  }
  return { contracts: [...contracts.values()].sort((a, b) => a.id.localeCompare(b.id)), issues };
}

/**
 * Discovers local contracts plus installed @clossys package-root files using normal
 * ancestor node_modules lookup. Installed package links are an explicit external
 * discovery source; their real package root is confined separately. No package is imported.
 */
export function discoverBriefContracts(root: string, catalog: StrategyCatalog = loadCatalog()): BriefContractDiscovery {
  const values: unknown[] = []; const issues: ValidationIssue[] = []; const seen = new Set<string>();
  const issue = (path: string, message: string) => issues.push({ path, message });
  function read(anchor: string, path: string) {
    try {
      const bytes = readBriefRootFile(anchor, path); if (bytes === undefined) return;
      try { values.push(JSON.parse(bytes)); } catch { issue(path, "Invalid brief contract JSON"); }
    } catch { issue(path, "Brief contract path is unreadable or unsafe"); }
  }
  try {
    const local = confined(resolve(root), "contracts");
    for (const name of readdirSync(local).sort()) if (name.endsWith(".json")) read(resolve(root), `contracts/${name}`);
  } catch (error) { if (!absent(error)) issue("contracts", "Brief contract directory is unreadable or unsafe"); }
  for (let ancestor = resolve(root); ; ancestor = dirname(ancestor)) {
    const scope = join(ancestor, "node_modules", "@clossys");
    try {
      if (lstatSync(scope).isSymbolicLink() || !lstatSync(scope).isDirectory()) throw new Error("Unsafe package scope");
      for (const name of readdirSync(scope).sort()) {
        try {
          const packageRoot = realpathSync(join(scope, name));
          if (!lstatSync(packageRoot).isDirectory() || seen.has(packageRoot)) continue;
          seen.add(packageRoot); read(packageRoot, "strategy-brief.json");
        } catch { issue(join(scope, name), "Installed contract package is unreadable"); }
      }
    } catch (error) { if (!absent(error)) issue(scope, "Installed brief contract scope is unreadable or unsafe"); }
    if (dirname(ancestor) === ancestor) break;
  }
  const merged = mergeBriefContracts(values, catalog);
  return { contracts: merged.contracts, issues: [...issues, ...merged.issues] };
}
