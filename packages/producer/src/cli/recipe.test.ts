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
import { STANDARD_AGENTS } from "../records/standards.js";
import { CliUsageError, USAGE } from "./args.js";
import { runCli } from "./main.js";
import { recipeInvocation, recipeUsage, runRecipeCli, stagesOf } from "./recipe.js";

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

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try { await run(); } catch (error) {
    expect(error).toBeInstanceOf(CliUsageError);
    return (error as Error).message;
  }
  throw new Error("expected a refusal");
}

/** An installed agent's stage check and the stages it exports, read from the module itself. */
const stageCheckOf = (agent: string) => join(installedPackageRoot(agent)!, "recipes/stage-check.mjs");
const exportedStages = async (agent: string): Promise<string[]> => [...(await import(pathToFileURL(stageCheckOf(agent)).href)).STAGES];

/** A clean create.app-section brief for SLOT in the fixture, built from the Designer stage check's own readers. */
async function cleanBrief(): Promise<Record<string, unknown>> {
  const check = await import(pathToFileURL(stageCheckOf("designer")).href);
  const world = check.stageWorld(FIXTURE, SLOT);
  const needed = [...new Set<string>([...world.inputs, ...world.required, ...world.traits.filter((id: string) => check.pinOf(FIXTURE, id))])];
  return {
    recipe: "create.app-section", standard: world.standardId, requirements: [...world.requirements],
    inputs: needed.map(id => ({ slot: id, candidate: check.pinOf(FIXTURE, id).candidate, sha256: check.pinOf(FIXTURE, id).sha256 })),
    tasteLog: check.tasteWindow(FIXTURE, world.standardId),
    brief: `Compose ${SLOT} from its pinned stock components only, quiet and exact per the pinned visual style.`,
  };
}

describe("clossys recipe: what a command line runs", () => {
  it("check runs the stage check of the agent that owns the recipe, from the installed package, with the discovered root", async () => {
    const run = await recipeInvocation(["check", "create.app-section", "brief", SLOT, "brief.json"], join(FIXTURE, "clossys"));
    expect(run.recipe).toMatchObject({ agent: "designer", id: "create.app-section" });
    expect(run.root).toBe(FIXTURE);
    expect(run.script).toBe(stageCheckOf("designer"));
    expect(run.args).toEqual(["brief", SLOT, "brief.json", "--root", FIXTURE]);
    const writer = await recipeInvocation(["check", "create.copy", "draft", "copy.hero", "draft.md", "--root", FIXTURE], "/");
    expect(writer.script).toBe(stageCheckOf("writer"));
    expect(writer.args).toEqual(["draft", "copy.hero", "draft.md", "--root", FIXTURE]);
  });

  it("generate runs the generator the recipe declares", async () => {
    const run = await recipeInvocation(["generate", "create.tokens", "spec.json", "--root", FIXTURE], "/");
    expect(run.script).toBe(join(installedPackageRoot("designer")!, "recipes/create.tokens/generate.mjs"));
    expect(run.args).toEqual(["spec.json", "--root", FIXTURE]);
  });

  it("refuses an unknown recipe, a recipe with no generator, a wrong argument count, an unknown tool and a bare --root", async () => {
    expect(await refusal(() => recipeInvocation(["check", "create.nothing", "brief", SLOT, "b.json", "--root", FIXTURE], "/"))).toMatch(/^no recipe create\.nothing in the installed packages \(recipes: .*create\.app-section.*\)$/);
    expect(await refusal(() => recipeInvocation(["generate", "create.component", "spec.json", "--root", FIXTURE], "/"))).toBe("recipe create.component declares no generator (recipe.json generator): there is nothing to generate");
    expect(await refusal(() => recipeInvocation(["check", "create.app-section", "brief", SLOT, "--root", FIXTURE], "/"))).toMatch(/^recipe check takes <stage> <slot> <file>/);
    expect(await refusal(() => recipeInvocation(["generate", "create.tokens", "--root", FIXTURE], "/"))).toMatch(/^recipe generate takes the generator's input/);
    expect(await refusal(() => recipeInvocation(["run", "create.tokens"], "/"))).toMatch(/^recipe takes check or generate, got run/);
    expect(await refusal(() => recipeInvocation(["check"], "/"))).toMatch(/^recipe check requires a recipe id/);
    expect(await refusal(() => recipeInvocation(["check", "create.app-section", "brief", SLOT, "b.json", "--root"], "/"))).toMatch(/^--root requires a value/);
  });

  it("refuses a stage the agent's stage check does not take, naming the stages that check exports", async () => {
    const designer = await exportedStages("designer");
    expect(designer).not.toContain("draft");
    expect(await refusal(() => recipeInvocation(["check", "create.app-section", "draft", SLOT, "d.json", "--root", FIXTURE], "/")))
      .toBe(`recipe check create.app-section: the designer stage check takes ${designer.join("|")}, got draft`);
    const writer = await exportedStages("writer");
    expect(writer).toContain("draft");
    expect(await refusal(() => recipeInvocation(["check", "create.copy", "render", "copy.hero", "d.md", "--root", FIXTURE], "/")))
      .toBe(`recipe check create.copy: the writer stage check takes ${writer.join("|")}, got render`);
    for (const stage of writer) await expect(recipeInvocation(["check", "create.copy", stage, "copy.hero", "d.md", "--root", FIXTURE], "/")).resolves.toMatchObject({ args: [stage, "copy.hero", "d.md", "--root", FIXTURE] });
  });

  it("refuses a stage check that exports no STAGES", async () => {
    const script = join(scratch(), "stage-check.mjs");
    writeFileSync(script, "export const main = () => ({ code: 0, text: '' });\n");
    expect(await refusal(() => stagesOf(script, "designer"))).toBe(`the designer stage check (${script}) exports no STAGES, so the stages it takes are unknown and this run is refused`);
  });

  it("is a clossys verb; its usage lists each installed agent's stages as that agent's stage check exports them", async () => {
    expect(USAGE).toContain("Recipe: clossys recipe check <recipe-id> <stage> <slot> <file>");
    const usage = await recipeUsage();
    let listed = 0;
    for (const agent of STANDARD_AGENTS) {
      if (!installedPackageRoot(agent)) continue;
      expect(usage).toContain(`    ${agent}: ${(await exportedStages(agent)).join("|")}\n`.trimEnd());
      listed++;
    }
    expect(listed).toBe(STANDARD_AGENTS.length);
    expect(usage).toContain("    designer: brief|diverge");
    expect(usage).not.toMatch(/designer: [^\n]*draft/);
    const refused = await runCli(["recipe", "check", "create.nothing", "brief", SLOT, "b.json", "--root", FIXTURE], "/");
    expect(refused.exitCode).toBe(2);
    expect(refused.message).toMatch(/^no recipe create\.nothing in the installed packages/);
    expect((await runRecipeCli([], "/")).exitCode).toBe(2);
    expect(await runRecipeCli(["--help"], "/")).toMatchObject({ exitCode: 0, message: usage });
  });
});

describe("clossys recipe check: the stage check by recipe id from a consumer root", () => {
  it("passes a clean brief (exit 0) and fails a brief that names no recipe (exit 1, R15.5 from the stage check)", async () => {
    const brief = await cleanBrief();
    const dir = scratch();
    writeFileSync(join(dir, "brief.json"), JSON.stringify(brief));
    const unnamed = { ...brief };
    delete unnamed.recipe;
    writeFileSync(join(dir, "unnamed.json"), JSON.stringify(unnamed));
    expect(await runCli(["recipe", "check", "create.app-section", "brief", SLOT, "brief.json", "--root", FIXTURE], dir)).toMatchObject({ exitCode: 0, printed: true });
    expect(await runCli(["recipe", "check", "create.app-section", "brief", SLOT, "unnamed.json", "--root", FIXTURE], dir)).toMatchObject({ exitCode: 1, printed: true });
    expect(await runCli(["recipe", "check", "create.app-section", "brief", SLOT, "missing.json", "--root", FIXTURE], dir)).toMatchObject({ exitCode: 2, printed: true });
  });

  it("refuses (exit 2) a stage file whose recipe is not the recipe id, before any stage check runs", async () => {
    const brief = await cleanBrief();
    const dir = scratch();
    writeFileSync(join(dir, "brief.json"), JSON.stringify(brief));
    writeFileSync(join(dir, "frame.json"), JSON.stringify({ ...brief, recipe: "create.frame" }));
    writeFileSync(join(dir, "broken.json"), "{ not json");
    const asFrame = await runCli(["recipe", "check", "create.frame", "brief", SLOT, "brief.json", "--root", FIXTURE], dir);
    expect(asFrame.exitCode).toBe(2);
    expect(asFrame.message.split("\n")[0]).toBe(`recipe check create.frame: brief.json names recipe "create.app-section", not create.frame; a stage file is checked as the recipe it names, so this run is refused`);
    expect(asFrame.printed).toBeUndefined();
    expect(await runCli(["recipe", "check", "create.app-section", "brief", SLOT, "frame.json", "--root", FIXTURE], dir)).toMatchObject({ exitCode: 2, message: expect.stringMatching(/^recipe check create\.app-section: frame\.json names recipe "create\.frame", not create\.app-section/) });
    expect(await runCli(["recipe", "check", "create.app-section", "diverge", SLOT, "frame.json", "--root", FIXTURE], dir)).toMatchObject({ exitCode: 2, message: expect.stringMatching(/names recipe "create\.frame"/) });
    expect(await runCli(["recipe", "check", "create.app-section", "brief", SLOT, "broken.json", "--root", FIXTURE], dir)).toMatchObject({ exitCode: 2, message: expect.stringMatching(/^recipe check create\.app-section: cannot read broken\.json as JSON: /) });
  });
});
