/**
 * `clossys recipe` (CONTAM-U3 D5): a recipe's own tools by recipe id from a consumer root. The consumer fixture has
 * no packages/ folder, so every recipe and tool below is found in the installed packages, as in a real install.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { installedPackageRoot } from "../package-path.js";
import { CliUsageError, USAGE } from "./args.js";
import { runCli } from "./main.js";
import { recipeInvocation, runRecipeCli } from "./recipe.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, "../../test-fixtures/consumer");
const SLOT = "sections.empty-state";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "clossys-recipe-"));
  dirs.push(dir);
  return dir;
}

function refusal(run: () => unknown): string {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(CliUsageError);
    return (error as Error).message;
  }
  throw new Error("expected a refusal");
}

describe("clossys recipe: what a command line runs", () => {
  it("check runs the stage check of the agent that owns the recipe, from the installed package, with the discovered root", () => {
    const run = recipeInvocation(["check", "create.app-section", "brief", SLOT, "brief.json"], join(FIXTURE, "clossys"));
    expect(run.recipe).toMatchObject({ agent: "designer", id: "create.app-section" });
    expect(run.root).toBe(FIXTURE);
    expect(run.script).toBe(join(installedPackageRoot("designer")!, "recipes/stage-check.mjs"));
    expect(run.args).toEqual(["brief", SLOT, "brief.json", "--root", FIXTURE]);
    const writer = recipeInvocation(["check", "create.copy", "draft", "copy.hero", "draft.md", "--root", FIXTURE], "/");
    expect(writer.script).toBe(join(installedPackageRoot("writer")!, "recipes/stage-check.mjs"));
    expect(writer.args).toEqual(["draft", "copy.hero", "draft.md", "--root", FIXTURE]);
  });

  it("generate runs the generator the recipe declares", () => {
    const run = recipeInvocation(["generate", "create.tokens", "spec.json", "--root", FIXTURE], "/");
    expect(run.script).toBe(join(installedPackageRoot("designer")!, "recipes/create.tokens/generate.mjs"));
    expect(run.args).toEqual(["spec.json", "--root", FIXTURE]);
  });

  it("refuses an unknown recipe, a recipe with no generator, a wrong argument count, an unknown tool and a bare --root", () => {
    expect(refusal(() => recipeInvocation(["check", "create.nothing", "brief", SLOT, "b.json", "--root", FIXTURE], "/"))).toMatch(/^no recipe create\.nothing in the installed packages \(recipes: .*create\.app-section.*\)$/);
    expect(refusal(() => recipeInvocation(["generate", "create.component", "spec.json", "--root", FIXTURE], "/"))).toBe("recipe create.component declares no generator (recipe.json generator): there is nothing to generate");
    expect(refusal(() => recipeInvocation(["check", "create.app-section", "brief", SLOT, "--root", FIXTURE], "/"))).toMatch(/^recipe check takes <stage> <slot> <file>/);
    expect(refusal(() => recipeInvocation(["generate", "create.tokens", "--root", FIXTURE], "/"))).toMatch(/^recipe generate takes the generator's input/);
    expect(refusal(() => recipeInvocation(["run", "create.tokens"], "/"))).toMatch(/^recipe takes check or generate, got run/);
    expect(refusal(() => recipeInvocation(["check"], "/"))).toMatch(/^recipe check requires a recipe id/);
    expect(refusal(() => recipeInvocation(["check", "create.app-section", "brief", SLOT, "b.json", "--root"], "/"))).toMatch(/^--root requires a value/);
  });

  it("is a clossys verb, listed in the usage", async () => {
    expect(USAGE).toContain("Recipe: clossys recipe check <recipe-id> brief|diverge|draft <slot> <file>");
    const refused = await runCli(["recipe", "check", "create.nothing", "brief", SLOT, "b.json", "--root", FIXTURE], "/");
    expect(refused.exitCode).toBe(2);
    expect(refused.message).toMatch(/^no recipe create\.nothing in the installed packages/);
    expect((await runRecipeCli([], "/")).exitCode).toBe(2);
    expect(await runRecipeCli(["--help"], "/")).toMatchObject({ exitCode: 0, message: expect.stringContaining("clossys recipe check <recipe-id>") });
  });
});

describe("clossys recipe check: the stage check by recipe id from a consumer root", () => {
  it("passes a clean brief (exit 0) and fails one written for another recipe (exit 1)", async () => {
    const check = await import(pathToFileURL(join(installedPackageRoot("designer")!, "recipes/stage-check.mjs")).href);
    const world = check.stageWorld(FIXTURE, SLOT);
    const needed = [...new Set<string>([...world.inputs, ...world.required, ...world.traits.filter((id: string) => check.pinOf(FIXTURE, id))])];
    const brief = {
      recipe: "create.app-section", standard: world.standardId, requirements: [...world.requirements],
      inputs: needed.map(id => ({ slot: id, candidate: check.pinOf(FIXTURE, id).candidate, sha256: check.pinOf(FIXTURE, id).sha256 })),
      tasteLog: check.tasteWindow(FIXTURE, world.standardId),
      brief: `Compose ${SLOT} from its pinned stock components only, quiet and exact per the pinned visual style.`,
    };
    const dir = scratch();
    writeFileSync(join(dir, "brief.json"), JSON.stringify(brief));
    writeFileSync(join(dir, "other.json"), JSON.stringify({ ...brief, recipe: "create.frame" }));
    expect(await runCli(["recipe", "check", "create.app-section", "brief", SLOT, "brief.json", "--root", FIXTURE], dir)).toMatchObject({ exitCode: 0, printed: true });
    expect(await runCli(["recipe", "check", "create.app-section", "brief", SLOT, "other.json", "--root", FIXTURE], dir)).toMatchObject({ exitCode: 1, printed: true });
    expect(await runCli(["recipe", "check", "create.app-section", "brief", SLOT, "missing.json", "--root", FIXTURE], dir)).toMatchObject({ exitCode: 2, printed: true });
  });
});
