import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { craftRunRecipe, craftRunRecipeIssues, generatorIssues, loadRecipes, plumbCraftIssues, produceIssues, readRecipe, recipeSourceIssue, recipesFor, standardRecipe, submitGuardedChecks } from "./recipes.js";
import { sourceKindOf, submissionSources, viewSourceKind } from "./slot-current.js";
import { loadStandards } from "./standards.js";

const FIXTURES = fileURLToPath(new URL("../constitution/__fixtures__/", import.meta.url));
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "recipes-"));
  cpSync(join(FIXTURES, "standards", "fixture-headline"), join(root, "packages", "writer", "standards", "fixture-headline"), { recursive: true });
  cpSync(join(FIXTURES, "recipes", "fixture-headline-craft"), join(root, "packages", "writer", "recipes", "fixture-headline-craft"), { recursive: true });
  return root;
}
const recipeJson = (root: string, value: unknown) => put(join(root, "packages", "writer", "recipes", "fixture-headline-craft", "recipe.json"), `${JSON.stringify(value)}\n`);
const BASE = { schema: "clossys.recipe/1", id: "fixture-headline-craft", produces: ["fixture-headline"], rung: "create", axes: ["tone", "length", "structure"] };

describe("records/recipes", () => {
  it("reads the fixture recipe clean and pairs it with its standard", () => {
    const root = workspace();
    const recipe = readRecipe(root, "writer", "fixture-headline-craft");
    expect(recipe.issues).toEqual([]);
    expect(recipe.doc).toEqual(BASE);
    expect(Object.keys(recipe.files)).toEqual(["craft.md", "recipe.json"]);
    const standards = loadStandards(root);
    expect(produceIssues(recipe, standards)).toEqual([]);
    expect(recipesFor(loadRecipes(root), standards[0]!).map(item => item.id)).toEqual(["fixture-headline-craft"]);
    expect(recipesFor(loadRecipes(root), { agent: "designer", id: "fixture-headline" })).toEqual([]);
  });

  it("refuses a rubric (file or field), a closed-schema breach and an id that is not the folder", () => {
    const root = workspace();
    recipeJson(root, { ...BASE, rubric: { clarity: 5 } });
    expect(readRecipe(root, "writer", "fixture-headline-craft").issues.join("\n")).toMatch(/carries a rubric/);
    recipeJson(root, { ...BASE, id: "other" });
    expect(readRecipe(root, "writer", "fixture-headline-craft").issues.join("\n")).toMatch(/is not the folder name/);
    recipeJson(root, BASE);
    put(join(root, "packages", "writer", "recipes", "fixture-headline-craft", "taste.md"), "## x\n");
    expect(readRecipe(root, "writer", "fixture-headline-craft").issues).toEqual(["taste.md is a rubric file: a recipe has no rubric"]);
  });

  it("flags clock, randomness, network and process use in a generator", () => {
    expect(generatorIssues("export default s => s.trim();")).toEqual([]);
    expect(generatorIssues("Date.now(); Math.random(); import('node:https'); require('child_process');")).toEqual([
      "generator reads the clock", "generator uses randomness", "generator uses the network", "generator spawns processes",
    ]);
    expect(generatorIssues("const d = new Date(0);")).toEqual([]);
  });

  it("an adopt recipe needs a seeded standard, and every produces entry must exist", () => {
    const root = workspace();
    recipeJson(root, { ...BASE, rung: "adopt", produces: ["fixture-headline", "ghost"] });
    const recipe = readRecipe(root, "writer", "fixture-headline-craft");
    expect(produceIssues(recipe, loadStandards(root))).toEqual([
      "adopt recipe produces for fixture-headline, which has no seeds",
      "produces ghost, which is not a writer standard",
    ]);
  });
  it("a plumb recipe reads its plumb action and pairs only with the standards that action lists", () => {
    const root = workspace();
    recipeJson(root, { ...BASE, rung: "plumb", axes: [], action: "fixture.plumb" });
    put(join(root, "packages", "writer", "recipes", "fixture-headline-craft", "craft.md"), "# plumb\n\n### 1. compute (deterministic)\n\n```sh\nclossys produce writer/<slot>\n```\n");
    put(join(root, "packages", "producer", "actions", "fixture.plumb", "action.json"), `${JSON.stringify({ schema: "clossys.action/1", id: "fixture.plumb", kind: "plumb", standards: ["writer/fixture-headline"] })}\n`);
    const recipe = readRecipe(root, "writer", "fixture-headline-craft");
    expect(recipe.issues).toEqual([]);
    expect(recipe.action).toEqual({ id: "fixture.plumb", path: "packages/producer/actions/fixture.plumb/action.json", kind: "plumb", standards: ["writer/fixture-headline"] });
    const standards = loadStandards(root);
    expect(produceIssues(recipe, standards)).toEqual([]);
    expect(recipesFor(loadRecipes(root), standards[0]!).map(item => item.id)).toEqual(["fixture-headline-craft"]);
    put(join(root, "packages", "producer", "actions", "fixture.plumb", "action.json"), `${JSON.stringify({ schema: "clossys.action/1", id: "fixture.plumb", kind: "plumb", standards: ["writer/other"] })}\n`);
    const elsewhere = readRecipe(root, "writer", "fixture-headline-craft");
    expect(produceIssues(elsewhere, standards)).toEqual(["plumb action fixture.plumb does not produce for writer/fixture-headline (its standards: writer/other)"]);
    expect(recipesFor(loadRecipes(root), standards[0]!)).toEqual([]);
  });

  it("plumbCraftIssues: CLI verbs only, every stage deterministic, no model stage", () => {
    expect(plumbCraftIssues("### 1. build (deterministic)\n\n```sh\nclossys publisher release <pub> --build\n```\n")).toEqual([]);
    expect(plumbCraftIssues("### 1. brief (model)\n\n```sh\nclossys next x --stage brief\n```\n")).toEqual([
      'craft.md has a model stage "### 1. brief (model)": a plumb recipe runs no model',
      'craft.md stage "### 1. brief (model)" is not marked (deterministic)',
    ]);
    expect(plumbCraftIssues("### 1. run (deterministic)\n\n```sh\nnpm run build\n```\n")).toEqual(['craft.md runs "npm run build", not a clossys verb: a plumb recipe\'s stages are CLI verbs only']);
  });
  it("checks: a recipe names only checks the submit guard runs; ref-verbatim recipes craft judged kinds only (mutation)", () => {
    const root = workspace();
    expect(submitGuardedChecks().has("R05.1")).toBe(true);
    expect(submitGuardedChecks().has("ref-verbatim")).toBe(true);
    expect(submitGuardedChecks().has("R02.1")).toBe(false);
    recipeJson(root, { ...BASE, checks: ["R05.1", "ref-verbatim"], sources: ["composition"] });
    expect(readRecipe(root, "writer", "fixture-headline-craft").issues).toEqual([]);
    recipeJson(root, { ...BASE, checks: ["R05.1", "R99.1"], sources: ["composition"] });
    expect(readRecipe(root, "writer", "fixture-headline-craft").issues).toEqual(["checks names R99.1, which the submit guard does not run (a rules.json check guarded on submit, or ref-verbatim)"]);
    recipeJson(root, { ...BASE, checks: ["ref-verbatim"], sources: ["original"] });
    expect(readRecipe(root, "writer", "fixture-headline-craft").issues).toEqual(["sources names original, which ref-verbatim does not judge at every rung (composition, registry)"]);
    recipeJson(root, { ...BASE, checks: ["R05.1", "ref-verbatim"], sources: ["composition"] });
    const recipe = readRecipe(root, "writer", "fixture-headline-craft");
    expect(recipeSourceIssue(recipe, "composition")).toBeUndefined();
    expect(recipeSourceIssue(recipe, "original")).toBe("recipe fixture-headline-craft crafts composition candidates; this one's meta.source.kind is original");
    expect(recipeSourceIssue(recipe, undefined)).toBe("recipe fixture-headline-craft crafts composition candidates; this one's meta.source.kind is (none)");
    // parts: the part classes of a composition, only beside a composition source and always with component.
    recipeJson(root, { ...BASE, checks: ["ref-verbatim"], sources: ["composition"], parts: ["component", "frame", "section"] });
    expect(readRecipe(root, "writer", "fixture-headline-craft").issues).toEqual([]);
    recipeJson(root, { ...BASE, sources: ["original"], parts: ["component"] });
    expect(readRecipe(root, "writer", "fixture-headline-craft").issues).toEqual(["parts names the part classes of a composition, but sources does not list composition"]);
    recipeJson(root, { ...BASE, checks: ["ref-verbatim"], sources: ["composition"], parts: ["frame"] });
    expect(readRecipe(root, "writer", "fixture-headline-craft").issues).toEqual(["parts does not list component: every composition places pinned stock components"]);
    recipeJson(root, { ...BASE, checks: ["ref-verbatim"], sources: ["composition"], parts: ["component", "page"] });
    expect(readRecipe(root, "writer", "fixture-headline-craft").issues.join("\n")).toMatch(/parts/);
  });

  it("one kind reader: the view's meta.source.kind, which the guard reads; every source a submission carries is listed", () => {
    expect(sourceKindOf({ meta: { source: { kind: "composition" } } })).toBe("composition");
    expect(sourceKindOf({ clossys: { source: { kind: "composition" } }, content: {} })).toBeUndefined();
    expect(viewSourceKind("x-v1.json", JSON.stringify({ meta: { source: { kind: "npm" } } }))).toBe("npm");
    expect(viewSourceKind("x-v1.md", "---\nsource: {\"kind\":\"authored\"}\n---\nHi.\n")).toBe("authored");
    expect(viewSourceKind("x-v1.json", "not json")).toBeUndefined();
    const mixed = { clossys: { source: { kind: "npm" } }, content: { meta: {} }, meta: { source: { kind: "composition" } } };
    expect(submissionSources(mixed)).toEqual([{ at: "clossys.source", kind: "npm" }, { at: "meta.source", kind: "composition" }]);
    expect(submissionSources({ meta: { source: { kind: "composition" } } })).toEqual([{ at: "meta.source", kind: "composition" }]);
    expect(submissionSources("text")).toEqual([]);
  });

  it("code chooses a run's recipe: the standard's one producing recipe; a run naming another, an unknown one or two is refused (mutation)", () => {
    const root = workspace();
    const recipes = loadRecipes(root);
    const own = recipes[0]!;
    expect(standardRecipe(recipes, "writer", "fixture-headline")).toEqual({ recipe: own });
    expect(standardRecipe(recipes, "writer", "nope")).toEqual({ issue: "no valid recipe under packages/writer/recipes/ produces for nope" });
    const twin = { ...own, id: "twin", doc: { ...own.doc!, id: "twin" } };
    expect(standardRecipe([own, twin], "writer", "fixture-headline")).toEqual({ issue: "recipes fixture-headline-craft, twin all produce for fixture-headline; a standard has exactly one producing recipe" });
    const other = { ...own, id: "other", doc: { ...own.doc!, id: "other", produces: ["other-standard"] } };
    const all = [own, other];
    const run = (brief?: string, diverge?: string) => [{ op: "craft:brief", ...(brief ? { recipe: brief } : {}) }, { op: "craft:diverge", ...(diverge ? { recipe: diverge } : {}) }];
    // The diverge names nothing, or the chosen recipe: no issue, and the chosen recipe whatever the events name.
    expect(craftRunRecipeIssues(run(), all, "writer", "fixture-headline")).toEqual([]);
    expect(craftRunRecipeIssues(run("fixture-headline-craft", "fixture-headline-craft"), all, "writer", "fixture-headline")).toEqual([]);
    expect(craftRunRecipe(run(undefined, "other"), all, "writer", "fixture-headline")).toBe(own);
    // A diverge naming a recipe of another standard (the create.element probe).
    expect(craftRunRecipeIssues(run(undefined, "other"), all, "writer", "fixture-headline")).toEqual(["craft:diverge names recipe other, which does not produce for fixture-headline"]);
    // A made-up id.
    expect(craftRunRecipeIssues(run(undefined, "create.nope"), all, "writer", "fixture-headline")).toEqual(["craft:diverge names recipe create.nope, which is not a valid recipe under packages/writer/recipes/"]);
    // A brief and a diverge of different recipes.
    expect(craftRunRecipeIssues(run("fixture-headline-craft", "other"), all, "writer", "fixture-headline")[0]).toBe("the run's craft events name recipes fixture-headline-craft (craft:brief), other (craft:diverge); one run is one recipe");
    // The brief's assembled recipe counts as a name too.
    expect(craftRunRecipeIssues([{ op: "craft:brief", assembled: { recipe: { id: "other" } } }], all, "writer", "fixture-headline")).toEqual(["craft:brief (assembled) names recipe other, which does not produce for fixture-headline"]);
    // A slot with no standard, and a standard with two producing recipes, leave the run's recipe unchosen.
    expect(craftRunRecipeIssues(run(), all, "writer", "")).toEqual(["writer slot names no standard, so no recipe is chosen for its craft run"]);
    expect(craftRunRecipe(run(undefined, "fixture-headline-craft"), all, "writer", "")).toBeUndefined();
    expect(craftRunRecipeIssues(run(), [own, twin], "writer", "fixture-headline")).toEqual(["recipes fixture-headline-craft, twin all produce for fixture-headline; a standard has exactly one producing recipe"]);
    expect(craftRunRecipeIssues([], all, "writer", "fixture-headline")).toEqual([]);
  });
});
