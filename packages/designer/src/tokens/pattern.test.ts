// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PATTERN_RECIPES, isPatternRecipe, patternBackground } from "./pattern.js";
describe("assets.pattern recipes", () => {
  it("reproduce the canvas working grid exactly from token references", () => {
    expect(patternBackground(PATTERN_RECIPES.dots, 1.5)).toEqual({
      backgroundImage: "radial-gradient(circle, var(--color-line-base) calc(var(--ui-border-hairline) * 1.5), transparent calc(var(--ui-border-hairline) * 1.5))",
      backgroundSize: "calc(var(--spacing-xl) * 1.5) calc(var(--spacing-xl) * 1.5)",
    });
    expect(patternBackground(PATTERN_RECIPES.grid).backgroundImage).toBe("linear-gradient(var(--color-line-base) var(--ui-border-hairline), transparent var(--ui-border-hairline)), linear-gradient(90deg, var(--color-line-base) var(--ui-border-hairline), transparent var(--ui-border-hairline))");
    expect(patternBackground(PATTERN_RECIPES.lines).backgroundImage).toBe("linear-gradient(var(--color-line-base) var(--ui-border-hairline), transparent var(--ui-border-hairline))");
  });
  it("accepts a recipe only for its own member with custom-property paint inputs", () => {
    expect(Object.entries(PATTERN_RECIPES).every(([name, recipe]) => isPatternRecipe(recipe, name))).toBe(true);
    for (const bad of [{ ...PATTERN_RECIPES.dots, shape: "lines" }, { ...PATTERN_RECIPES.dots, ink: "#cccccc" }, { ...PATTERN_RECIPES.dots, weight: "1px" }, { ...PATTERN_RECIPES.dots, tile: undefined }, null, []]) expect(isPatternRecipe(bad, "dots")).toBe(false);
    expect(isPatternRecipe({ ...PATTERN_RECIPES.dots, shape: "hatch" }, "hatch")).toBe(false);
  });
});
