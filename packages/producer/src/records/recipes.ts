/**
 * Recipes (R15.5, slot-constitution.md section 3): the maker of candidates, stored at
 * `packages/<agent>/recipes/<id>/` as `recipe.json`, `craft.md` and an optional deterministic
 * `generate.mjs`. Recipes read standards (which they produce for); no judge reads a recipe (R16.1),
 * so nothing under `src/constitution/` (criteria, certify, checks) imports this module.
 *
 * A `plumb` recipe is deterministic: the plumb action it names (`action`, an action.json of kind
 * plumb whose `standards` list the standards it produces for) computes its candidates, its craft.md
 * runs clossys verbs only, and it has no model stage, no axes, no generator and no craft events.
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
  readonly rung: "adopt" | "adapt" | "create" | "plumb";
  readonly axes: readonly string[];
  readonly generator?: string;
  /** The plumb action that computes the candidates (rung plumb only). */
  readonly action?: string;
  /**
   * The deterministic checks a candidate this recipe crafts must pass: each a check the submit guard runs
   * (a rules.json check whose `guard` lists submit, or the ref-verbatim gate). Checked in code below.
   */
  readonly checks?: readonly string[];
  /** The source kinds (`meta.source.kind`) a candidate this recipe crafts may carry; `next --submit` refuses any other. */
  readonly sources?: readonly string[];
}

/** The plumb action a plumb recipe names, as its action.json declares it. */
export interface RecipeAction {
  readonly id: string;
  /** Workspace-relative action.json path. */
  readonly path: string;
  readonly kind: string;
  /** The standards (`<agent>/<id>`) whose candidates the action computes. */
  readonly standards: readonly string[];
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
  /** The named plumb action, when the recipe is plumb and its action.json reads. */
  readonly action?: RecipeAction;
  readonly issues: readonly string[];
}

/** The packages that hold action contracts (`packages/<package>/actions/<id>/action.json`). */
export const ACTION_PACKAGES = Object.freeze(["director", "designer", "writer", "publisher", "producer"] as const);

/** Reads the action contract `id` from whichever package holds it; an issue when none does or it does not read. */
export function readRecipeAction(root: string, id: string): { action?: RecipeAction; issue?: string } {
  for (const pkg of ACTION_PACKAGES) {
    const rel = `packages/${pkg}/actions/${id}/action.json`;
    const abs = packagePath(root, rel);
    if (!existsSync(abs)) continue;
    let doc: unknown;
    try { doc = JSON.parse(readFileSync(abs, "utf8")); } catch (error) { return { issue: `action ${id}: ${rel} does not parse: ${(error as Error).message}` }; }
    if (!isRecord(doc) || doc.id !== id) return { issue: `action ${id}: ${rel} does not declare id ${id}` };
    const standards = Array.isArray(doc.standards) ? doc.standards.filter((item): item is string => typeof item === "string") : [];
    return { action: { id, path: rel, kind: typeof doc.kind === "string" ? doc.kind : "(none)", standards } };
  }
  return { issue: `action ${id} is not an action.json under packages/*/actions/` };
}

/** A stage heading (`### <n>. <name> ...`) of a craft.md. */
const STAGE_HEADING = /^#{2,6}\s+\d+\.\s.*$/gm;
/** A model node: a heading marked `(model ...)`. */
const MODEL_HEADING = /^#{1,6}\s.*\(model\b.*$/gim;

/**
 * The issues of a plumb recipe's craft.md: no model stage, at least one stage, every stage marked
 * `(deterministic)`, and every command in a fenced block a `clossys <verb>` call (CLI verbs only).
 */
export function plumbCraftIssues(text: string): string[] {
  const issues: string[] = [];
  for (const heading of text.match(MODEL_HEADING) ?? []) issues.push(`craft.md has a model stage "${heading.trim()}": a plumb recipe runs no model`);
  const stages = text.match(STAGE_HEADING) ?? [];
  if (!stages.length) issues.push("craft.md has no numbered stage: a plumb recipe lists the clossys verbs it runs");
  for (const heading of stages) if (!/\(deterministic\)/.test(heading)) issues.push(`craft.md stage "${heading.trim()}" is not marked (deterministic)`);
  const commands: string[] = [];
  for (const block of text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)) {
    for (const line of block[1]!.split("\n").map(item => item.trim()).filter(Boolean)) commands.push(line);
  }
  if (!commands.length) issues.push("craft.md runs no command: a plumb recipe runs clossys verbs");
  for (const line of commands) if (!/^clossys [a-z]/.test(line)) issues.push(`craft.md runs "${line}", not a clossys verb: a plumb recipe's stages are CLI verbs only`);
  return issues;
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

/** The Designer ref-verbatim gate's id as a recipe names it (constitution/fix.ts REF_VERBATIM_ID: recipes.test.ts pins the two equal). */
export const REF_VERBATIM_CHECK = "ref-verbatim";
/**
 * The source kinds the ref-verbatim gate judges at every rung (constitution/guard.ts refVerbatimOf): composition
 * lineage (each part stock, each import a declared part) and registry lineage (byte-exact adoption).
 */
export const REF_VERBATIM_SOURCES: readonly string[] = Object.freeze(["composition", "registry"]);

let submitGuarded: ReadonlySet<string> | undefined;
/**
 * The checks the submit guard runs on every submitted candidate: each rules.json check whose `guard` lists
 * submit, plus the ref-verbatim gate. rules.json is read as data (as constitution/registry.ts reads it), so this
 * module imports no judge (R16.1).
 */
export function submitGuardedChecks(): ReadonlySet<string> {
  if (!submitGuarded) {
    const rules = JSON.parse(readFileSync(new URL("../../src/constitution/rules.json", import.meta.url), "utf8")) as { checks?: { id?: unknown; guard?: unknown }[] }[];
    const ids = rules.flatMap(rule => rule.checks ?? []).filter(check => Array.isArray(check.guard) && check.guard.includes("submit")).map(check => String(check.id));
    submitGuarded = new Set([REF_VERBATIM_CHECK, ...ids]);
  }
  return submitGuarded;
}

/**
 * The issues of a recipe's `checks` and `sources`: every named check is one the submit guard runs (a recipe never
 * names a check that does not run), none twice; a recipe naming the ref-verbatim gate limits `sources` to kinds the
 * gate judges at every rung (REF_VERBATIM_SOURCES), so its candidates cannot step outside the gate.
 */
export function checksIssues(doc: RecipeDoc, guarded: ReadonlySet<string> = submitGuardedChecks()): string[] {
  const issues: string[] = [];
  const twice = (list: readonly string[]) => list.filter((item, index) => list.indexOf(item) !== index);
  for (const id of new Set(twice(doc.checks ?? []))) issues.push(`checks names ${id} twice`);
  for (const id of new Set(twice(doc.sources ?? []))) issues.push(`sources names ${id} twice`);
  for (const id of doc.checks ?? []) if (!guarded.has(id)) issues.push(`checks names ${id}, which the submit guard does not run (a rules.json check guarded on submit, or ${REF_VERBATIM_CHECK})`);
  if (doc.checks?.includes(REF_VERBATIM_CHECK)) {
    if (!doc.sources) issues.push(`checks names ${REF_VERBATIM_CHECK} with no sources: list the source kinds (${REF_VERBATIM_SOURCES.join(", ")}) the gate judges at every rung`);
    else for (const kind of doc.sources) if (!REF_VERBATIM_SOURCES.includes(kind)) issues.push(`sources names ${kind}, which ${REF_VERBATIM_CHECK} does not judge at every rung (${REF_VERBATIM_SOURCES.join(", ")})`);
  }
  return issues;
}

/** A candidate's source kind: `meta.source.kind` of the body, or `clossys.source.kind` of a clossys.candidate/1 header. */
export function candidateSourceKind(candidate: unknown): string | undefined {
  if (!isRecord(candidate)) return undefined;
  const meta = isRecord(candidate.meta) ? candidate.meta : undefined;
  const header = isRecord(candidate.clossys) ? candidate.clossys : undefined;
  const body = isRecord(candidate.content) ? candidate.content : undefined;
  const bodyMeta = body && isRecord(body.meta) ? body.meta : undefined;
  for (const source of [meta?.source, header?.source, bodyMeta?.source]) if (isRecord(source) && typeof source.kind === "string") return source.kind;
  return undefined;
}

/**
 * Why `next --submit` refuses `candidate` as the output of a craft run under `recipe`: its source kind is not one of
 * the recipe's `sources`. Undefined when the recipe lists no sources or the kind is listed.
 */
export function recipeSourceIssue(recipe: Recipe, candidate: unknown): string | undefined {
  const sources = recipe.doc?.sources;
  if (!sources) return undefined;
  const kind = candidateSourceKind(candidate);
  if (kind !== undefined && sources.includes(kind)) return undefined;
  return `recipe ${recipe.id} crafts ${sources.join(" or ")} candidates; this one's meta.source.kind is ${kind ?? "(none)"}`;
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
  let action: RecipeAction | undefined;
  if (doc?.rung === "plumb") {
    if (!doc.action) issues.push("rung plumb names no action: a plumb recipe names the plumb action that computes its candidates");
    if (doc.axes.length) issues.push(`rung plumb lists axes ${doc.axes.join(", ")}: a plumb recipe has no diverge stage`);
    if (doc.generator) issues.push(`rung plumb names generator ${doc.generator}: a plumb recipe runs clossys verbs only`);
    if (doc.action) {
      const read = readRecipeAction(root, doc.action);
      if (read.issue) issues.push(read.issue);
      if (read.action) {
        action = read.action;
        if (read.action.kind !== "plumb") issues.push(`action ${doc.action} is kind ${read.action.kind}, not plumb`);
      }
    }
    if (files["craft.md"]) issues.push(...plumbCraftIssues(readFileSync(join(abs, "craft.md"), "utf8")));
  } else if (doc?.action) issues.push(`action ${doc.action} is for a plumb recipe; a ${doc.rung} recipe is crafted and names no action`);
  if (doc) issues.push(...checksIssues(doc));
  let generatorText: string | undefined;
  if (doc?.generator) {
    if (!files[doc.generator]) issues.push(`generator ${doc.generator} is not a file in the recipe folder`);
    else {
      generatorText = readFileSync(join(abs, doc.generator), "utf8");
      issues.push(...generatorIssues(generatorText));
    }
  }
  return { agent, id, dir, ...(doc ? { doc } : {}), ...(raw !== undefined ? { raw } : {}), files, ...(generatorText !== undefined ? { generatorText } : {}), ...(action ? { action } : {}), issues };
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

/** Whether a plumb recipe's action declares that it computes candidates for `<agent>/<standard>`. */
const actionProducesFor = (recipe: Recipe, standard: string) => recipe.doc?.rung !== "plumb" || !!recipe.action?.standards.includes(`${recipe.agent}/${standard}`);

/** The valid recipes of the standard's agent that produce for it (R15.5); a plumb recipe only where its action does. */
export function recipesFor(recipes: readonly Recipe[], standard: Pick<Standard, "agent" | "id">): Recipe[] {
  return recipes.filter(recipe => recipe.agent === standard.agent && !recipe.issues.length && recipe.doc?.produces.includes(standard.id) && actionProducesFor(recipe, standard.id));
}

/**
 * R15.5 and R15.9 (the recipe half): every `produces` entry names a standard of the recipe's agent,
 * an `adopt` recipe produces only for standards with seeds, and a `plumb` recipe produces only for
 * standards its plumb action lists in `standards`.
 */
export function produceIssues(recipe: Recipe, standards: readonly Standard[]): string[] {
  if (!recipe.doc) return [];
  const issues: string[] = [];
  for (const id of recipe.doc.produces) {
    const standard = standards.find(item => item.agent === recipe.agent && item.id === id);
    if (!standard) { issues.push(`produces ${id}, which is not a ${recipe.agent} standard`); continue; }
    if (recipe.doc.rung === "adopt" && !(standard.doc?.seeds.length)) issues.push(`adopt recipe produces for ${id}, which has no seeds`);
    if (recipe.action && !actionProducesFor(recipe, id)) issues.push(`plumb action ${recipe.action.id} does not produce for ${recipe.agent}/${id} (its standards: ${recipe.action.standards.join(", ") || "none"})`);
  }
  return issues;
}

/**
 * The recipe one P2 run's craft events name (R15.7): the diverge's `recipe`, else the first event's
 * that names one; the agent's own recipe of that id, else any agent's.
 */
export function craftRunRecipe(events: readonly Readonly<Record<string, unknown>>[], recipes: readonly Recipe[], agent: string): Recipe | undefined {
  const diverge = events.find(event => event.op === "craft:diverge");
  const recipeId = [...(diverge ? [diverge] : []), ...events].map(event => event.recipe).find((value): value is string => typeof value === "string");
  if (recipeId === undefined) return undefined;
  return recipes.find(item => item.id === recipeId && item.agent === agent) ?? recipes.find(item => item.id === recipeId);
}

/**
 * The one plumb-rung craft rule (R15.7), shared by the judge (constitution/rules/r15.ts craftIssues)
 * and the craft writers (records/slot-write.ts appendCraftEvent, writeCritique): a run's craft events
 * under a plumb recipe are the fault, because its plumb action computes the candidate. The issue, or
 * undefined. The writer passes the open run plus the event it is about to append.
 */
export function plumbCraftRunIssue(events: readonly Readonly<Record<string, unknown>>[], recipes: readonly Recipe[], agent: string): string | undefined {
  const recipe = craftRunRecipe(events, recipes, agent);
  return recipe?.doc?.rung === "plumb" && events.length ? `recipe ${recipe.id} is plumb: a plumb recipe records no craft events (its plumb action computes the candidate)` : undefined;
}
