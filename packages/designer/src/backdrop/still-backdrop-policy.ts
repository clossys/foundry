/**
 * The hero still-backdrop contrast proof. It lives beside checkStillBackdrop because it is proof
 * input, not paint: the worst-case white backdrop and the composite scrim value are only fed to the
 * contrast check, and nothing renders them. StillBackdrop paints its scrim with token classes.
 */
import { checkStillBackdrop, type StillBackdropArt, type ImageBackdropContract, type StillBackdropReport } from "./consumer-art.js";
import type { BackdropCheckOptions } from "./contract.js";
import { parseOklch } from "../tokens/color.js";
import { TOKENS } from "../tokens/tokens.js";

/** Four existing scrim passes are the lighter treatment; five are stronger. */
export type HeroBackdropScrim = "light" | "strong";
export const HERO_SCRIM_PASSES: Record<HeroBackdropScrim, number> = { light: 4, strong: 5 };

/**
 * The gradient is below every scalar scrim pass. On any raster pixel or gradient
 * stop, white is the worst background for the light text. Repeated source-over
 * black scrims have alpha 1-(1-a)^n. The registry's light alpha is the lower
 * bound: the shipped dark scrim is stronger. Both checks therefore use the
 * conservative light bound, independent of the gradient's changing polarity.
 */
export function stillBackdropPolicy(art: StillBackdropArt, scrim: HeroBackdropScrim): {
  passes: number;
  contract: ImageBackdropContract;
  options: BackdropCheckOptions;
  report: StillBackdropReport;
} {
  const passes = HERO_SCRIM_PASSES[scrim];
  if (!passes) throw new TypeError("Unknown hero backdrop scrim");
  const source = TOKENS["--color-overlay-scrim"];
  if (!source) throw new TypeError("Hero backdrop scrim token is unavailable");
  const color = parseOklch(source.value);
  if (color.L !== 0 || color.C !== 0) throw new TypeError("Hero backdrop scrim proof requires the shipped black scalar");
  const alpha = color.A;
  const effectiveAlpha = 1 - (1 - alpha) ** passes;
  const tokens = { ...TOKENS, "--color-hero-composite-scrim": { ...source, property: "--color-hero-composite-scrim", value: `oklch(0 0 0 / ${effectiveAlpha})`, themeDependent: false } };
  const contract: ImageBackdropContract = {
    kind: "image", ariaHidden: true, pointerEvents: "none",
    scrim: { token: "--color-hero-composite-scrim", textToken: "--color-neutral-50", worstCaseBackdrop: "#ffffff" },
    loading: { strategy: "lazy", budgetBytes: art?.bytes },
  };
  return { passes, contract, options: { tokens }, report: checkStillBackdrop(art, contract, { tokens }) };
}
