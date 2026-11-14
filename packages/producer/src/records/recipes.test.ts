import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generatorIssues, loadRecipes, produceIssues, readRecipe, recipesFor } from "./recipes.js";
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
});
