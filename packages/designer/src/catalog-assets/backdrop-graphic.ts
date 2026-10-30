import type { Mode, Resolved } from "../catalog-core/types.js";

/** Product reference and native catalog slot are distinct because native slots have one leaf segment. */
export const BACKDROP_GRAPHIC_REFERENCE = "asset.backdrop.graphic";
export const BACKDROP_GRAPHIC_SLOT = "assets.backdrop-graphic";
export const BACKDROP_GRAPHIC_PATTERNS = ["mesh", "grid", "dot", "noise"] as const;
export type BackdropGraphicPattern = typeof BACKDROP_GRAPHIC_PATTERNS[number];
export interface BackdropGraphicTokens { readonly accent: string; readonly surface: string }
export interface BackdropGraphicRecipe {
  readonly pattern: BackdropGraphicPattern;
  readonly accent: "--color-accent";
  readonly surface: "--color-surface-base";
}
export const BACKDROP_GRAPHIC_RECIPES: Readonly<Record<BackdropGraphicPattern, BackdropGraphicRecipe>> = Object.freeze({
  mesh: Object.freeze({ pattern: "mesh", accent: "--color-accent", surface: "--color-surface-base" }),
  grid: Object.freeze({ pattern: "grid", accent: "--color-accent", surface: "--color-surface-base" }),
  dot: Object.freeze({ pattern: "dot", accent: "--color-accent", surface: "--color-surface-base" }),
  noise: Object.freeze({ pattern: "noise", accent: "--color-accent", surface: "--color-surface-base" }),
});
export interface BackdropGraphicArtifact {
  readonly format: "css";
  readonly source: string;
  readonly style: {
    readonly backgroundColor: string;
    readonly backgroundImage: string;
    readonly backgroundSize: string;
    readonly backgroundRepeat: "repeat" | "no-repeat";
  };
}
export const BACKDROP_GRAPHIC_TOKEN_READS = ["tokens.accent-color.default", "tokens.surface-color.base"] as const;
/** CSS custom properties inherit theme and consumer overrides on the painted element. */
export const BACKDROP_GRAPHIC_CSS_TOKENS: BackdropGraphicTokens = Object.freeze({ accent: "var(--color-accent)", surface: "var(--color-surface-base)" });
export function isBackdropGraphicRecipe(value: unknown): value is BackdropGraphicRecipe {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const recipe = value as Record<string, unknown>;
  return BACKDROP_GRAPHIC_PATTERNS.includes(recipe.pattern as BackdropGraphicPattern)
    && recipe.accent === "--color-accent" && recipe.surface === "--color-surface-base";
}
/** Deterministic decorative geometry. Only the caller's two colors supply paint. No motion or images. */
export function backdropGraphic(pattern: BackdropGraphicPattern, tokens: BackdropGraphicTokens = BACKDROP_GRAPHIC_CSS_TOKENS): BackdropGraphicArtifact {
  if (!BACKDROP_GRAPHIC_PATTERNS.includes(pattern)) throw new Error("Unknown backdrop graphic pattern");
  for (const value of [tokens.accent, tokens.surface]) {
    if (!value.trim() || /[;{}<>]/.test(value)) throw new Error("Backdrop graphic needs CSS color values or custom property references");
  }
  const ink = (share: number) => `color-mix(in srgb, ${tokens.accent} ${share}%, ${tokens.surface})`;
  const fade = (share: number) => `color-mix(in srgb, ${tokens.accent} ${share}%, transparent)`;
  let backgroundImage: string;
  let backgroundSize: string;
  let backgroundRepeat: "repeat" | "no-repeat" = "repeat";
  if (pattern === "mesh") {
    backgroundImage = `radial-gradient(ellipse at 15% 20%, ${fade(70)} 0%, transparent 62%), radial-gradient(ellipse at 85% 30%, ${fade(45)} 0%, transparent 58%), radial-gradient(ellipse at 50% 95%, ${fade(55)} 0%, transparent 68%)`;
    backgroundSize = "100% 100%";
    backgroundRepeat = "no-repeat";
  } else if (pattern === "grid") {
    backgroundImage = `linear-gradient(${ink(18)} 1px, transparent 1px), linear-gradient(90deg, ${ink(18)} 1px, transparent 1px)`;
    backgroundSize = "48px 48px";
  } else if (pattern === "dot") {
    backgroundImage = `radial-gradient(circle, ${ink(30)} 1px, transparent 1.5px)`;
    backgroundSize = "24px 24px";
  } else {
    // A fixed integer sequence gives a repeatable scatter without filters or random state.
    let seed = 173;
    const next = () => { seed = (seed * 16807) % 2147483647; return seed % 100; };
    backgroundImage = Array.from({ length: 24 }, () => `radial-gradient(circle at ${next()}% ${next()}%, ${ink(15 + next() % 25)} .6px, transparent 1px)`).join(", ");
    backgroundSize = "96px 96px";
  }
  const style = Object.freeze({ backgroundColor: tokens.surface, backgroundImage, backgroundSize, backgroundRepeat });
  return Object.freeze({ format: "css", style, source: `background-color:${style.backgroundColor};background-image:${backgroundImage};background-size:${backgroundSize};background-repeat:${backgroundRepeat};` });
}
/** Exportable CSS with resolved light/dark paint. Missing consumer colors fail rather than inventing a palette. */
export function backdropGraphicFromResolved(pattern: BackdropGraphicPattern, resolved: Resolved, mode: Mode): BackdropGraphicArtifact {
  const read = (id: string) => {
    const member = resolved.members[id];
    const value = member?.css[mode] ?? member?.css.light;
    if (!value || member?.$type !== "color") throw new Error(`Backdrop graphic needs resolved ${id}`);
    return value;
  };
  return backdropGraphic(pattern, { accent: read(BACKDROP_GRAPHIC_TOKEN_READS[0]), surface: read(BACKDROP_GRAPHIC_TOKEN_READS[1]) });
}
