import type { SemanticContent as SemanticContentComponent } from "../../components/SemanticContent.js";
import { componentLeaf } from "../../runtime/component-leaf.js";
import { checkStillBackdrop, type StillBackdropArt, type ImageBackdropContract, type StillBackdropReport } from "../../backdrop/consumer-art.js";
import type { BackdropCheckOptions } from "../../backdrop/contract.js";
import { parseOklch } from "../../tokens/color.js";
import { TOKENS } from "../../tokens/tokens.js";

const SemanticContent = componentLeaf<typeof SemanticContentComponent>("components.semantic-content");

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

/** Inert, checked static artwork; no motion source or alternate network resource exists. */
export function StillBackdrop({ art, scrim = "light" }: { art: StillBackdropArt; scrim?: HeroBackdropScrim }) {
  const policy = stillBackdropPolicy(art, scrim);
  if (!policy.report.ok) throw new TypeError("Invalid hero still backdrop declaration");
  const pointerEvents = "none" as const;
  return (
    <SemanticContent as="div" data-hero-backdrop="" aria-hidden="true" className="absolute inset-0" style={{ pointerEvents, backgroundColor: `var(${art.backgroundToken})` }}>
      {art.source.format === "svg" ? (
        <svg viewBox={`0 0 ${art.width} ${art.height}`} width={art.width} height={art.height} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" className="h-full w-full" style={{ pointerEvents }}>
          {art.source.paths.map((path, index) => <path key={index} d={path.d} fill={`var(${path.fillToken})`} stroke={path.strokeToken ? `var(${path.strokeToken})` : "none"} strokeWidth={path.strokeWidth} style={{ pointerEvents }} />)}
        </svg>
      ) : (
        <img src={art.source.src} alt="" width={art.width} height={art.height} loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" style={{ pointerEvents }} />
      )}
      <SemanticContent as="div" data-hero-gradient="media-scrim" className="absolute inset-0" style={{ pointerEvents, backgroundImage: "var(--gradient-media-scrim)" }} />
      {Array.from({ length: policy.passes }, (_, index) => <SemanticContent as="div" key={index} data-hero-scrim={scrim} className="absolute inset-0" style={{ pointerEvents, backgroundColor: "var(--color-overlay-scrim)" }} />)}
    </SemanticContent>
  );
}
