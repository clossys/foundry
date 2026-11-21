import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { candidateSourceKind, generatorIssues, loadRecipes, plumbCraftIssues, produceIssues, readRecipe, recipeSourceIssue, recipesFor, submitGuardedChecks } from "./recipes.js";
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
    expect(plumbCraftIssues("### 1. build (deterministic)\n\n```sh\nclossys release <pub> --build\n```\n")).toEqual([]);
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
    expect(candidateSourceKind({ clossys: { source: { kind: "composition" } }, content: {} })).toBe("composition");
    expect(recipeSourceIssue(recipe, { meta: { source: { kind: "composition" } } })).toBeUndefined();
    expect(recipeSourceIssue(recipe, { meta: { source: { kind: "original" } } })).toBe("recipe fixture-headline-craft crafts composition candidates; this one's meta.source.kind is original");
  });
});
