/**
 * Recipes (R15.5, slot-constitution.md section 3): the maker of candidates, stored at
 * `packages/<agent>/recipes/<id>/` as `recipe.json`, `craft.md` and an optional deterministic
 * `generate.mjs`. Recipes read standards (which they produce for); no judge reads a recipe (R16.1),
 * so nothing under `src/constitution/` (criteria, certify, checks) imports this module.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { packagePath } from "../package-path.js";
import { loadSchema, validateValue } from "../pipeline/schema.js";
import { sha256Hex } from "./hash.js";
import type { ModelAgent } from "./slot-model/index.js";
import { STANDARD_AGENTS, type Standard } from "./standards.js";

export const RECIPE_SCHEMA = "clossys.recipe/1";
/** Files a recipe never holds: a rubric is the judge's (R15.5, R16). */
export const RUBRIC_FILE = /(?:^|\/)(?:rubric|requirements|taste)(?:\.[a-z]+)?$/i;

export interface RecipeDoc {
  readonly schema: typeof RECIPE_SCHEMA;
  readonly id: string;
  readonly produces: readonly string[];
  readonly rung: "adopt" | "adapt" | "create";
  readonly axes: readonly string[];
  readonly generator?: string;
}

export interface Recipe {
  readonly agent: ModelAgent;
  readonly id: string;
  /** Workspace-relative folder. */
  readonly dir: string;
  readonly doc?: RecipeDoc;
  readonly raw?: unknown;
  /** Folder-relative path → sha256. */
  readonly files: Readonly<Record<string, string>>;
  /** The generator source, when the recipe names one and it exists. */
  readonly generatorText?: string;
  readonly issues: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The non-determinism a generate tool may not use (R15.5: identical bytes twice, no network, clock
 * or randomness). A static scan: any hit is an issue, whatever the branch it sits on.
 */
const NONDETERMINISM: readonly [RegExp, string][] = [
  [/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(\s*\)|\bperformance\s*\.\s*now\s*\(|\bprocess\s*\.\s*hrtime\b/, "reads the clock"],
  [/\bMath\s*\.\s*random\s*\(|\brandomUUID\s*\(|\brandomBytes\s*\(|\bgetRandomValues\s*\(|\brandomInt\s*\(/, "uses randomness"],
  [/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|["'](?:node:)?(?:http|https|net|tls|dgram|dns|http2)["']|["']undici["']|["']axios["']/, "uses the network"],
  [/["'](?:node:)?child_process["']/, "spawns processes"],
];

/** Static determinism issues of a generator's source (R15.5). */
export function generatorIssues(source: string): string[] {
  return NONDETERMINISM.filter(([pattern]) => pattern.test(source)).map(([, what]) => `generator ${what}`);
}

/** Reads one recipe folder. */
export function readRecipe(root: string, agent: ModelAgent, id: string): Recipe {
  const dir = join("packages", agent, "recipes", id).split("\\").join("/");
  const abs = packagePath(root, dir);
  const issues: string[] = [];
  const files: Record<string, string> = {};
  const walk = (current: string, prefix: string) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) { issues.push(`${prefix}${name} is a symbolic link`); continue; }
      if (stat.isDirectory()) walk(path, `${prefix}${name}/`);
      else if (stat.isFile()) files[`${prefix}${name}`] = sha256Hex(readFileSync(path));
    }
  };
  walk(abs, "");
  let raw: unknown, doc: RecipeDoc | undefined;
  if (!files["recipe.json"]) issues.push("no recipe.json");
  else {
    try { raw = JSON.parse(readFileSync(join(abs, "recipe.json"), "utf8")); } catch (error) { issues.push(`recipe.json: ${(error as Error).message}`); }
    if (raw !== undefined) {
      const schemaIssues = validateValue(raw, loadSchema("recipe"));
      for (const issue of schemaIssues) issues.push(`recipe.json${issue.path ? ` ${issue.path}` : ""}: ${issue.message}`);
      if (isRecord(raw) && raw.id !== id) issues.push(`recipe.json id ${JSON.stringify(raw.id)} is not the folder name ${id}`);
      if (isRecord(raw) && "rubric" in raw) issues.push("recipe.json carries a rubric: the judge's criteria live in the standard");
      if (!schemaIssues.length) doc = raw as RecipeDoc;
    }
  }
  if (!files["craft.md"]) issues.push("no craft.md");
  for (const name of Object.keys(files)) if (RUBRIC_FILE.test(name)) issues.push(`${name} is a rubric file: a recipe has no rubric`);
  let generatorText: string | undefined;
  if (doc?.generator) {
    if (!files[doc.generator]) issues.push(`generator ${doc.generator} is not a file in the recipe folder`);
    else {
      generatorText = readFileSync(join(abs, doc.generator), "utf8");
      issues.push(...generatorIssues(generatorText));
    }
  }
  return { agent, id, dir, ...(doc ? { doc } : {}), ...(raw !== undefined ? { raw } : {}), files, ...(generatorText !== undefined ? { generatorText } : {}), issues };
}

/** Every recipe of every agent under `root`. */
export function loadRecipes(root: string): Recipe[] {
  const out: Recipe[] = [];
  for (const agent of STANDARD_AGENTS) {
    const base = packagePath(root, `packages/${agent}/recipes`);
    if (!existsSync(base)) continue;
    for (const id of readdirSync(base).sort()) {
      if (id.startsWith(".")) continue;
      const stat = lstatSync(join(base, id));
      if (stat.isDirectory() && !stat.isSymbolicLink()) out.push(readRecipe(root, agent, id));
    }
  }
  return out;
}

/** The valid recipes of the standard's agent that produce for it (R15.5). */
export function recipesFor(recipes: readonly Recipe[], standard: Pick<Standard, "agent" | "id">): Recipe[] {
  return recipes.filter(recipe => recipe.agent === standard.agent && !recipe.issues.length && recipe.doc?.produces.includes(standard.id));
}

/**
 * R15.5 and R15.9 (the recipe half): every `produces` entry names a standard of the recipe's agent,
 * and an `adopt` recipe produces only for standards with seeds.
 */
export function produceIssues(recipe: Recipe, standards: readonly Standard[]): string[] {
  if (!recipe.doc) return [];
  const issues: string[] = [];
  for (const id of recipe.doc.produces) {
    const standard = standards.find(item => item.agent === recipe.agent && item.id === id);
    if (!standard) { issues.push(`produces ${id}, which is not a ${recipe.agent} standard`); continue; }
    if (recipe.doc.rung === "adopt" && !(standard.doc?.seeds.length)) issues.push(`adopt recipe produces for ${id}, which has no seeds`);
  }
  return issues;
}
