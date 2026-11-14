/**
 * The criteria catalog (R15.3): every `index.json` under `src/constitution/criteria/` (the shared
 * `core/` and the per-agent `<agent>/<standard-unit>/` folders), joined to its modules and fixtures.
 * The registry of record is the JSON; a module or fixture it names must exist, ids are unique across
 * folders, and each criterion carries at least one pass and one fail fixture.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Criterion, CriterionCase, CriterionEntry } from "./types.js";

/** The criteria source folder (src/ and dist/ both resolve to it, as rules.json does). */
export const CRITERIA_ROOT = fileURLToPath(new URL("../../../../src/constitution/criteria/", import.meta.url));
/** The compiled (or, under vitest, source) criteria folder the modules load from. */
const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CODE_EXT = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
export const CRITERION_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;

/** One catalog row: the index entry and the folder (relative to the criteria root, posix) it sits in. */
export interface CatalogEntry extends CriterionEntry { readonly folder: string }
export interface CriterionFixtures { readonly pass: readonly CriterionCase[]; readonly fail: readonly CriterionCase[] }
export interface Catalog { readonly entries: readonly CatalogEntry[]; readonly issues: readonly string[] }

/** The `index.json` files below `root`, as posix folders relative to it, sorted. */
export function indexFolders(root = CRITERIA_ROOT): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === "__fixtures__" || name === "node_modules" || name.startsWith(".")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "index.json") found.push(relative(root, dir).split(sep).join("/"));
    }
  };
  if (existsSync(root)) walk(root);
  return found.sort();
}

const cache = new Map<string, Catalog>();
/** The catalog under `root` with every structural issue; cached per root. */
export function criteriaCatalog(root = CRITERIA_ROOT): Catalog {
  const hit = cache.get(root);
  if (hit) return hit;
  const entries: CatalogEntry[] = [];
  const issues: string[] = [];
  const seen = new Map<string, string>();
  for (const folder of indexFolders(root)) {
    const at = `${folder}/index.json`;
    let doc: unknown;
    try { doc = JSON.parse(readFileSync(join(root, folder, "index.json"), "utf8")); }
    catch (error) { issues.push(`${at}: ${(error as Error).message}`); continue; }
    const record = doc as { schema?: unknown; criteria?: unknown };
    if (record?.schema !== "clossys.criteria/1" || !Array.isArray(record.criteria)) { issues.push(`${at}: not a clossys.criteria/1 index`); continue; }
    for (const raw of record.criteria as unknown[]) {
      const row = raw as Partial<CriterionEntry>;
      if (typeof row?.id !== "string" || !CRITERION_ID.test(row.id)) { issues.push(`${at}: criterion id ${JSON.stringify(row?.id)} is not <area>.<name>`); continue; }
      if (seen.has(row.id)) { issues.push(`${at}: ${row.id} is already registered in ${seen.get(row.id)}`); continue; }
      seen.set(row.id, at);
      if (typeof row.module !== "string" || !/^[a-z][a-z0-9-]*$/.test(row.module) || !existsSync(join(root, folder, `${row.module}.ts`))) issues.push(`${at}: ${row.id} module ${String(row.module)} has no ${String(row.module)}.ts`);
      if (typeof row.export !== "string" || !/^[A-Za-z_$][\w$]*$/.test(row.export)) issues.push(`${at}: ${row.id} export is not an identifier`);
      if (typeof row.summary !== "string" || !row.summary.trim()) issues.push(`${at}: ${row.id} has no summary`);
      if (typeof row.fixtures !== "string" || !row.fixtures.startsWith("__fixtures__/")) { issues.push(`${at}: ${row.id} fixtures must sit under __fixtures__/`); continue; }
      try {
        const fixtures = readFixtureFile(join(root, folder, row.fixtures));
        if (!fixtures.pass.length || !fixtures.fail.length) issues.push(`${at}: ${row.id} needs at least one pass and one fail fixture`);
      } catch (error) { issues.push(`${at}: ${row.id} fixtures: ${(error as Error).message}`); }
      entries.push({ ...(row as CriterionEntry), folder });
    }
  }
  const catalog = { entries, issues };
  cache.set(root, catalog);
  return catalog;
}

function readFixtureFile(path: string): CriterionFixtures {
  const doc = JSON.parse(readFileSync(path, "utf8")) as Partial<CriterionFixtures>;
  if (!Array.isArray(doc.pass) || !Array.isArray(doc.fail)) throw new Error("not {pass: [], fail: []}");
  for (const item of [...doc.pass, ...doc.fail]) {
    if (typeof item?.subject?.kind !== "string" || typeof item.subject.text !== "string") throw new Error("every case needs subject.kind and subject.text");
  }
  return doc as CriterionFixtures;
}

/** The registered criterion ids. */
export const criterionIds = (root = CRITERIA_ROOT): Set<string> => new Set(criteriaCatalog(root).entries.map(entry => entry.id));

/** The pass and fail fixtures of one entry. */
export const readFixtures = (entry: CatalogEntry, root = CRITERIA_ROOT): CriterionFixtures => readFixtureFile(join(root, entry.folder, entry.fixtures));

/** The function of one entry, imported from its module. */
export async function loadCriterion(entry: CatalogEntry): Promise<Criterion> {
  const module = await import(pathToFileURL(join(CODE_ROOT, entry.folder, `${entry.module}${CODE_EXT}`)).href) as Record<string, unknown>;
  const fn = module[entry.export];
  if (typeof fn !== "function") throw new Error(`criterion ${entry.id}: ${entry.folder}/${entry.module} exports no function ${entry.export}`);
  return fn as Criterion;
}

/** Resolves an id to its function; throws on an unregistered id. */
export async function criterionById(id: string, root = CRITERIA_ROOT): Promise<Criterion> {
  const entry = criteriaCatalog(root).entries.find(item => item.id === id);
  if (!entry) throw new Error(`criterion ${id} is not registered under src/constitution/criteria`);
  return loadCriterion(entry);
}
