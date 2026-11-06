import type { SemanticContent as SemanticContentComponent } from "../../components/SemanticContent.js";
import { componentLeaf } from "../../runtime/component-leaf.js";
import type { StillBackdropArt } from "../../backdrop/consumer-art.js";
import { stillBackdropPolicy, type HeroBackdropScrim } from "../../backdrop/still-backdrop-policy.js";

const SemanticContent = componentLeaf<typeof SemanticContentComponent>("components.semantic-content");

export { HERO_SCRIM_PASSES, stillBackdropPolicy, type HeroBackdropScrim } from "../../backdrop/still-backdrop-policy.js";

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
      <SemanticContent as="div" data-hero-gradient="media-scrim" className="absolute inset-0" style={{ pointerEvents, backgroundImage: "linear-gradient(transparent, var(--color-overlay-scrim))" }} />
      {Array.from({ length: policy.passes }, (_, index) => <SemanticContent as="div" key={index} data-hero-scrim={scrim} className="absolute inset-0 bg-overlay-scrim" style={{ pointerEvents }} />)}
    </SemanticContent>
  );
}
