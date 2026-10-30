// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PATTERN_RECIPES, isPatternRecipe, patternBackground } from "./pattern.js";
describe("assets.pattern recipes", () => {
  it("reproduce the canvas working grid exactly from token references", () => {
    expect(patternBackground(PATTERN_RECIPES.dots, 1.5)).toEqual({
      backgroundImage: "radial-gradient(circle, var(--color-line-strong) calc(var(--ui-border-hairline) * 1.5), transparent calc(var(--ui-border-hairline) * 1.5))",
      backgroundSize: "calc(var(--spacing-xl) * 1.5) calc(var(--spacing-xl) * 1.5)",
    });
    expect(patternBackground(PATTERN_RECIPES.grid).backgroundImage).toBe("linear-gradient(var(--color-line-strong) var(--ui-border-hairline), transparent var(--ui-border-hairline)), linear-gradient(90deg, var(--color-line-strong) var(--ui-border-hairline), transparent var(--ui-border-hairline))");
    expect(patternBackground(PATTERN_RECIPES.lines).backgroundImage).toBe("linear-gradient(var(--color-line-strong) var(--ui-border-hairline), transparent var(--ui-border-hairline))");
  });
  it("accepts a recipe only for its own member with custom-property paint inputs", () => {
    expect(Object.entries(PATTERN_RECIPES).every(([name, recipe]) => isPatternRecipe(recipe, name))).toBe(true);
    for (const bad of [{ ...PATTERN_RECIPES.dots, shape: "lines" }, { ...PATTERN_RECIPES.dots, ink: "#cccccc" }, { ...PATTERN_RECIPES.dots, weight: "1px" }, { ...PATTERN_RECIPES.dots, tile: undefined }, null, []]) expect(isPatternRecipe(bad, "dots")).toBe(false);
    expect(isPatternRecipe({ ...PATTERN_RECIPES.dots, shape: "hatch" }, "hatch")).toBe(false);
  });
  it("renders distinct granular, noise and contour patterns from the same token inputs", () => {
    const images = new Set(Object.values(PATTERN_RECIPES).map(recipe => patternBackground(recipe, 1.5).backgroundImage));
    expect(images.size).toBe(6);
    for (const name of ["grain", "noise", "topo"] as const) {
      const recipe = PATTERN_RECIPES[name], background = patternBackground(recipe, 1.5);
      expect(isPatternRecipe(recipe, name)).toBe(true);
      expect(background.backgroundImage).toContain(`var(${recipe.ink})`);
      expect(background.backgroundImage).toContain(`var(${recipe.weight})`);
      expect(background.backgroundSize).toBe(`calc(var(${recipe.tile}) * 1.5) calc(var(${recipe.tile}) * 1.5)`);
    }
    expect(patternBackground(PATTERN_RECIPES.grain).backgroundImage).toContain("radial-gradient(ellipse");
    expect(patternBackground(PATTERN_RECIPES.noise).backgroundImage).toContain("radial-gradient(circle");
    expect(patternBackground(PATTERN_RECIPES.topo).backgroundImage).toContain("repeating-radial-gradient");
  });
});
