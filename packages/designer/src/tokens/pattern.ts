/**
 * The `assets.pattern` recipes: repeatable decorative tiles built only from
 * token references. The Foundry pattern fill is generated from these records,
 * and every surface that paints a pattern (the canvas working grid, the Assets
 * board specimen) resolves its CSS through `patternBackground`, so no consumer
 * keeps its own gradient definition.
 */
export type PatternName = "dots" | "lines" | "grid";
export interface PatternRecipe {
  readonly shape: PatternName;
  /** Custom property holding the ink colour. */
  readonly ink: string;
  /** Custom property holding the mark weight (dot radius or line width). */
  readonly weight: string;
  /** Custom property holding the tile edge length. */
  readonly tile: string;
}
export const PATTERN_TOKEN_READS = Object.freeze(["tokens.border-color.strong", "tokens.border-width.hairline", "tokens.spacing.xl"] as const);
const SHARED = { ink: "--color-line-strong", weight: "--ui-border-hairline", tile: "--spacing-xl" } as const;
export const PATTERN_RECIPES: Readonly<Record<PatternName, PatternRecipe>> = Object.freeze({
  dots: Object.freeze({ shape: "dots", ...SHARED }),
  lines: Object.freeze({ shape: "lines", ...SHARED }),
  grid: Object.freeze({ shape: "grid", ...SHARED }),
});
const PROPERTY = /^--[a-z][a-z0-9-]*$/;
/** True when a stored value is a recipe for `name`, every paint input a custom-property reference. */
export function isPatternRecipe(value: unknown, name: string): value is PatternRecipe {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const recipe = value as Record<string, unknown>;
  return recipe.shape === name && (["dots", "lines", "grid"] as const).includes(name as PatternName)
    && [recipe.ink, recipe.weight, recipe.tile].every(ref => typeof ref === "string" && PROPERTY.test(ref));
}
/** Background layers for a recipe at a camera zoom; the tile and dot radius scale with zoom. */
export function patternBackground(recipe: PatternRecipe, zoom = 1): { backgroundImage: string; backgroundSize: string } {
  const ink = `var(${recipe.ink})`, weight = `var(${recipe.weight})`, size = `calc(var(${recipe.tile}) * ${zoom})`;
  const rule = (angle: string) => `linear-gradient(${angle}${ink} ${weight}, transparent ${weight})`;
  const backgroundImage = recipe.shape === "dots"
    ? `radial-gradient(circle, ${ink} calc(${weight} * ${zoom}), transparent calc(${weight} * ${zoom}))`
    : recipe.shape === "lines" ? rule("") : `${rule("")}, ${rule("90deg, ")}`;
  return { backgroundImage, backgroundSize: `${size} ${size}` };
}
