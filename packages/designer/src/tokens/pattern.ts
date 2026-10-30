/** Decorative pattern recipes share token-bound paint inputs and one renderer. */
export type PatternName = "dots" | "lines" | "grid" | "grain" | "noise" | "topo";
export interface PatternRecipe {
  readonly shape: PatternName;
  readonly ink: string;
  readonly weight: string;
  readonly tile: string;
}
export const PATTERN_TOKEN_READS = Object.freeze(["tokens.border-color.strong", "tokens.border-width.hairline", "tokens.spacing.xl"] as const);
const SHARED = { ink: "--color-line-strong", weight: "--ui-border-hairline", tile: "--spacing-xl" } as const;
export const PATTERN_RECIPES: Readonly<Record<PatternName, PatternRecipe>> = Object.freeze({
  dots: Object.freeze({ shape: "dots", ...SHARED }),
  lines: Object.freeze({ shape: "lines", ...SHARED }),
  grid: Object.freeze({ shape: "grid", ...SHARED }),
  grain: Object.freeze({ shape: "grain", ...SHARED }),
  noise: Object.freeze({ shape: "noise", ...SHARED }),
  topo: Object.freeze({ shape: "topo", ...SHARED }),
});
const PROPERTY = /^--[a-z][a-z0-9-]*$/;
/** Every paint input remains a custom-property reference, including authored recipes. */
export function isPatternRecipe(value: unknown, name: string): value is PatternRecipe {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const recipe = value as Record<string, unknown>;
  return recipe.shape === name && Object.hasOwn(PATTERN_RECIPES, name)
    && [recipe.ink, recipe.weight, recipe.tile].every(ref => typeof ref === "string" && PROPERTY.test(ref));
}
/** The tile and mark weight scale with the camera zoom. */
export function patternBackground(recipe: PatternRecipe, zoom = 1): { backgroundImage: string; backgroundSize: string } {
  const ink = `var(${recipe.ink})`, weight = `var(${recipe.weight})`, mark = `calc(${weight} * ${zoom})`, size = `calc(var(${recipe.tile}) * ${zoom})`;
  const rule = (angle: string) => `linear-gradient(${angle}${ink} ${weight}, transparent ${weight})`;
  const backgroundImage = recipe.shape === "dots"
    ? `radial-gradient(circle, ${ink} ${mark}, transparent ${mark})`
    : recipe.shape === "lines" ? rule("")
    : recipe.shape === "grid" ? `${rule("")}, ${rule("90deg, ")}`
    : recipe.shape === "grain" ? `radial-gradient(ellipse at 20% 30%, ${ink} calc(${mark} * .5), transparent ${mark}), radial-gradient(ellipse at 65% 70%, ${ink} calc(${mark} * .5), transparent ${mark}), radial-gradient(ellipse at 80% 20%, ${ink} calc(${mark} * .5), transparent ${mark})`
    : recipe.shape === "noise" ? `radial-gradient(circle at 20% 30%, ${ink} ${mark}, transparent ${mark}), radial-gradient(circle at 70% 80%, ${ink} ${mark}, transparent ${mark})`
    : `repeating-radial-gradient(ellipse at 30% 40%, transparent 0, transparent calc(${mark} * 3), ${ink} calc(${mark} * 3), ${ink} calc(${mark} * 4))`;
  return { backgroundImage, backgroundSize: `${size} ${size}` };
}
