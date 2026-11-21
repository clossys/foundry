/**
 * `clossys recipe check <recipe-id> <stage> <slot> <file>` and `clossys recipe generate <recipe-id> <spec.json>`:
 * a recipe's own mechanical tools, run by recipe id from the consumer root (CONTAM-U3 D5). A craft.md runs in
 * the consumer root, which has no `packages/` folder, so `node packages/<agent>/recipes/...` resolves nothing
 * there. This verb finds the recipe the way every reader does (records/recipes.ts loadRecipes, through
 * packagePath: the installed `@clossys/<agent>` in a consumer root, `packages/<agent>/` in the Foundry
 * repository), then runs the tool it owns with the caller's arguments and the discovered root:
 *
 * - check: the agent's stage check, `recipes/stage-check.mjs` beside the recipe folder (slot-constitution.md
 *   section 5b), with `<stage> <slot> <file> --root <root>`. The stages are the ones that stage check exports as
 *   `STAGES` (the list its own CLI accepts), never a list kept here. A stage file that names a `recipe` must
 *   name the recipe the verb was given: the stage is judged as that recipe's, so another recipe's file is refused;
 * - generate: the generator the recipe declares (`recipe.json` `generator`), with `<args> --root <root>`; its
 *   stdout is the draft.
 *
 * The tool writes its own output and its exit code is the verb's. An unknown recipe id, a recipe id two agents
 * share, a missing stage check, a stage check that exports no STAGES, a stage it does not take, a stage file
 * naming another recipe and a recipe that declares no generator are refused with exit 2; nothing falls back to
 * another tool. It records nothing: the stage is recorded by `clossys next --stage`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { installedPackageRoot, packagePath } from "../package-path.js";
import { loadRecipes, type Recipe } from "../records/recipes.js";
import { STANDARD_AGENTS } from "../records/standards.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const RECIPE_TOOLS = ["check", "generate"] as const;
export type RecipeTool = typeof RECIPE_TOOLS[number];

const USAGE_HEAD = "Usage: clossys recipe check <recipe-id> <stage> <slot> <file> [--root <dir>]\n"
  + "       clossys recipe generate <recipe-id> <spec.json> [--root <dir>]\n"
  + "  check runs the stage check of the agent that owns the recipe on one craft stage's output (exit 0 clean, 1 with one line per issue).\n"
  + "  generate runs the generator the recipe declares and prints the draft.\n"
  + "  The recipe is found by id in the installed packages (the Foundry checkout's packages/ when run there); the root is --root or the workspace around the working directory.\n";

/** What one `clossys recipe` run executes: the tool's absolute path, its arguments and the working directory. */
export interface RecipeInvocation {
  readonly tool: RecipeTool;
  readonly recipe: Recipe;
  readonly root: string;
  readonly script: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

/** The stages a stage check takes: its exported `STAGES`. A check that exports none is refused. */
export async function stagesOf(script: string, agent: string): Promise<readonly string[]> {
  const stages: unknown = (await import(pathToFileURL(script).href)).STAGES;
  if (!Array.isArray(stages) || !stages.length || !stages.every(stage => typeof stage === "string" && stage.length > 0)) {
    throw new CliUsageError(`the ${agent} stage check (${script}) exports no STAGES, so the stages it takes are unknown and this run is refused`);
  }
  return stages as readonly string[];
}

/** The usage, with each installed agent's stages read from its stage check. */
export async function recipeUsage(): Promise<string> {
  const lines: string[] = [];
  for (const agent of STANDARD_AGENTS) {
    const root = installedPackageRoot(agent);
    if (root === undefined) continue;
    const script = join(root, "recipes", "stage-check.mjs");
    if (!existsSync(script)) continue;
    lines.push(`    ${agent}: ${(await stagesOf(script, agent)).join("|")}`);
  }
  return `${USAGE_HEAD}  <stage> is one the recipe's agent's stage check takes:\n${lines.join("\n")}`;
}

/** The one recipe named `id`, or a refusal naming what exists. */
export function recipeById(root: string, id: string): Recipe {
  const recipes = loadRecipes(root);
  const found = recipes.filter(recipe => recipe.id === id);
  if (found.length === 1) return found[0]!;
  if (found.length > 1) throw new CliUsageError(`recipe ${id} is defined by ${found.map(recipe => recipe.agent).join(" and ")}: a recipe id names one recipe, so this run is refused`);
  const known = recipes.map(recipe => recipe.id).sort();
  throw new CliUsageError(`no recipe ${id} in the installed packages${known.length ? ` (recipes: ${known.join(", ")})` : ""}`);
}

/**
 * Refuses a JSON stage file whose `recipe` names another recipe. A missing file, and a file without a `recipe`,
 * are left to the stage check, which reports them itself (exit 2 and R15.5).
 */
function refuseOtherRecipe(id: string, file: string, cwd: string): void {
  const path = resolve(cwd, file);
  if (!file.endsWith(".json") || !existsSync(path)) return;
  let doc: unknown;
  try { doc = JSON.parse(readFileSync(path, "utf8")); } catch (error) {
    throw new CliUsageError(`recipe check ${id}: cannot read ${file} as JSON: ${(error as Error).message}`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc) || !("recipe" in doc)) return;
  const named = (doc as { recipe: unknown }).recipe;
  if (named !== id) throw new CliUsageError(`recipe check ${id}: ${file} names recipe ${JSON.stringify(named)}, not ${id}; a stage file is checked as the recipe it names, so this run is refused`);
}

/** Resolves a `clossys recipe` command line to the tool it runs; refuses with a usage error otherwise. */
export async function recipeInvocation(argv: readonly string[], cwd: string): Promise<RecipeInvocation> {
  const args = [...argv];
  let given: string | undefined;
  const at = args.indexOf("--root");
  if (at >= 0) {
    given = args[at + 1];
    if (given === undefined || given.startsWith("--")) throw new CliUsageError(`--root requires a value`);
    args.splice(at, 2);
  }
  const [tool, id, ...rest] = args;
  if (!(RECIPE_TOOLS as readonly string[]).includes(tool ?? "")) throw new CliUsageError(`recipe takes check or generate, got ${tool ?? "nothing"}`);
  if (!id || id.startsWith("--")) throw new CliUsageError(`recipe ${tool} requires a recipe id`);
  if (tool === "check" && rest.length !== 3) throw new CliUsageError(`recipe check takes <stage> <slot> <file> after the recipe id`);
  if (tool === "generate" && !rest.length) throw new CliUsageError(`recipe generate takes the generator's input after the recipe id`);
  const root = discoverRoot(resolve(cwd, given ?? "."));
  const recipe = recipeById(root, id);
  let rel: string;
  if (tool === "check") rel = `packages/${recipe.agent}/recipes/stage-check.mjs`;
  else {
    const generator = recipe.doc?.generator;
    if (!generator) throw new CliUsageError(`recipe ${id} declares no generator (recipe.json generator): there is nothing to generate`);
    rel = `${recipe.dir}/${generator}`;
  }
  const script = packagePath(root, rel);
  if (!existsSync(script)) throw new CliUsageError(`recipe ${id}: ${rel} is not in the installed ${recipe.agent} package, so this run is refused`);
  if (tool === "check") {
    const [stage, , file] = rest as [string, string, string];
    const stages = await stagesOf(script, recipe.agent);
    if (!stages.includes(stage)) throw new CliUsageError(`recipe check ${id}: the ${recipe.agent} stage check takes ${stages.join("|")}, got ${stage}`);
    refuseOtherRecipe(id, file, cwd);
  }
  return { tool: tool as RecipeTool, recipe, root, script, args: [...rest, "--root", root], cwd };
}

export async function runRecipeCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  if (!argv.length || argv[0] === "--help" || (argv.includes("--help") && argv.length <= 2)) return { exitCode: argv.length ? 0 : 2, message: await recipeUsage() };
  const run = await recipeInvocation(argv, cwd);
  const result = spawnSync(process.execPath, [run.script, ...run.args], { cwd: run.cwd, stdio: "inherit" });
  if (result.error) return { exitCode: 2, message: `clossys recipe ${run.tool} ${run.recipe.id}: ${result.error.message}` };
  const status = result.status;
  return { exitCode: status === 0 || status === 1 ? status : 2, message: "", printed: true };
}
