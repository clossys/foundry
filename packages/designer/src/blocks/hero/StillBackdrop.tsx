import type { SemanticContent as SemanticContentComponent } from "../../components/SemanticContent.js";
import { componentLeaf } from "../../runtime/component-leaf.js";
import type { StillBackdropArt } from "../../backdrop/consumer-art.js";
import { stillBackdropPolicy, type HeroBackdropScrim } from "../../backdrop/still-backdrop-policy.js";

const SemanticContent = componentLeaf<typeof SemanticContentComponent>("components.semantic-content");

export { HERO_SCRIM_PASSES, stillBackdropPolicy, type HeroBackdropScrim } from "../../backdrop/still-backdrop-policy.js";

/**
 * The opaque surfaces a still backdrop may sit on, keyed by the `--color-<surface>` token the art
 * declares, each as a literal token utility so the stylesheet carries it: the ground is painted by a
 * class, never by an inline colour.
 */
const BACKDROP_GROUNDS: Readonly<Record<string, string>> = {
  "surface-base": "bg-surface-base",
  "surface-sunken": "bg-surface-sunken",
  "surface-raised": "bg-surface-raised",
  "surface-aside": "bg-surface-aside",
  "surface-inverse": "bg-surface-inverse",
  "surface-inverse-raised": "bg-surface-inverse-raised",
};

/** Inert, checked static artwork; no motion source or alternate network resource exists. */
export function StillBackdrop({ art, scrim = "light" }: { art: StillBackdropArt; scrim?: HeroBackdropScrim }) {
  const policy = stillBackdropPolicy(art, scrim);
  if (!policy.report.ok) throw new TypeError("Invalid hero still backdrop declaration");
  const surface = art.backgroundToken.replace(/^--color-/, "");
  const ground = surface !== art.backgroundToken && Object.hasOwn(BACKDROP_GROUNDS, surface) ? BACKDROP_GROUNDS[surface] : undefined;
  if (!ground) throw new TypeError("Hero still backdrop ground must be an opaque surface token");
  const pointerEvents = "none" as const;
  return (
    <SemanticContent as="div" data-hero-backdrop="" aria-hidden="true" className={`absolute inset-0 ${ground}`} style={{ pointerEvents }}>
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
