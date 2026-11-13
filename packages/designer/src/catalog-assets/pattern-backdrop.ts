import type { Resolved } from "../catalog-core/types.js";
import { isPatternRecipe, patternBackground, PATTERN_RECIPES, type PatternName } from "../tokens/pattern.js";

/** Hero graphic backdrops paint the owner-signed `assets.pattern` slot (owner 2026-11-02). */
export const PATTERN_BACKDROP_SLOT = "assets.pattern";
/** A bare `assets.pattern` reference paints this member; `assets.pattern.<member>` names one explicitly. */
export const PATTERN_BACKDROP_DEFAULT_MEMBER: PatternName = "grid";
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
/** The pattern member an Assets reference names, or undefined when it does not name `assets.pattern`. */
export function patternBackdropMember(asset: string): PatternName | undefined {
  if (asset === PATTERN_BACKDROP_SLOT) return PATTERN_BACKDROP_DEFAULT_MEMBER;
  if (!asset.startsWith(`${PATTERN_BACKDROP_SLOT}.`)) return undefined;
  const member = asset.slice(PATTERN_BACKDROP_SLOT.length + 1);
  return Object.hasOwn(PATTERN_RECIPES, member) ? member as PatternName : undefined;
}
/** Paint the consumer's resolved pattern recipe. A missing or invalid consumer value yields undefined, never a default. */
export function patternBackdropFromResolved(asset: string, resolved?: Resolved): BackdropGraphicArtifact | undefined {
  const member = patternBackdropMember(asset);
  if (!member) return undefined;
  const recipe = resolved?.members[`${PATTERN_BACKDROP_SLOT}.${member}`]?.value.light;
  if (!isPatternRecipe(recipe, member)) return undefined;
  const { backgroundImage, backgroundSize } = patternBackground(recipe);
  const style = Object.freeze({ backgroundColor: "var(--color-surface-base)", backgroundImage, backgroundSize, backgroundRepeat: "repeat" as const });
  return Object.freeze({ format: "css", style, source: `background-color:${style.backgroundColor};background-image:${backgroundImage};background-size:${backgroundSize};background-repeat:repeat;` });
}
