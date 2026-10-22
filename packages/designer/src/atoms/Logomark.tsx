import type { CSSProperties } from "react";
import { BADGE_INSET_SHARE, BADGE_RADIUS_SHARE } from "../internal/brandmark.js";
import { UI_BRANDMARK_HEIGHT_SM, UI_BRANDMARK_HEIGHT_MD, UI_BRANDMARK_HEIGHT_LG } from "../internal/brandmark.js";
import { cx } from "./internal/cx.js";

export type LogomarkSize = "sm" | "md" | "lg";
export type LogomarkTone = "auto" | "inverse";
export type LogomarkPlate = "shared" | "self";

// The normalizer's MarkBox contract, defined once here until that unit merges.
// Replace this declaration with its type-only import at that integration.
interface MarkBox { x: number; y: number; width: number; height: number }

export interface LogomarkProps {
  /** Caller-selected glyph image URL; rendered only as an image source. */
  src: string;
  /** The closed mark-height scale. */
  size: LogomarkSize;
  /** Shared plate ink; supply artwork that contrasts with the selected plate. */
  tone?: LogomarkTone;
  /** Whether the artwork supplies its own plate. @default "self" */
  plate?: LogomarkPlate;
  /** Optional native image title. The glyph remains decorative. */
  title?: string;
  /** Explicit chrome presentation; omission retains the legacy size step. */
  presentation?: "desktop" | "mobile" | "responsive";
  /** Producer-measured source coordinates; no consumer sizing override. */
  geometry?: { viewBox: MarkBox; paintedBounds: MarkBox };
}

const HEIGHTS = { sm: UI_BRANDMARK_HEIGHT_SM, md: UI_BRANDMARK_HEIGHT_MD, lg: UI_BRANDMARK_HEIGHT_LG };

/** One decorative mark: caller artwork, optionally inset in a shared plate. */
export function Logomark({ src, size, tone = "auto", plate = "self", title, presentation, geometry }: LogomarkProps) {
  const height = HEIGHTS[size];
  const inverse = tone === "inverse";
  if (presentation !== undefined && geometry !== undefined) {
    if (!geometry || !geometry.viewBox || !geometry.paintedBounds) {
      throw new Error("Logomark: geometry must describe finite painted bounds within its viewBox.");
    }
    const { viewBox, paintedBounds: bounds } = geometry;
    if (![viewBox.x, viewBox.y, viewBox.width, viewBox.height, bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
      || viewBox.width <= 0 || viewBox.height <= 0 || bounds.width <= 0 || bounds.height <= 0
      || bounds.x < viewBox.x || bounds.y < viewBox.y
      || bounds.x + bounds.width > viewBox.x + viewBox.width || bounds.y + bounds.height > viewBox.y + viewBox.height) {
      throw new Error("Logomark: geometry must describe finite painted bounds within its viewBox.");
    }
    const artworkFor = (mobile: boolean) => {
      const artHeight = mobile ? "var(--ui-layout-tap-target, 44px)" : UI_BRANDMARK_HEIGHT_LG;
      const artWidth = `calc(${artHeight} * ${bounds.width / bounds.height})`;
      const sourceWidth = `calc(${artHeight} * ${viewBox.width / bounds.height})`;
      const sourceHeight = `calc(${artHeight} * ${viewBox.height / bounds.height})`;
      const plateSide = `calc(max(${artHeight}, ${artWidth}) / ${1 - 2 * BADGE_INSET_SHARE})`;
      const sourceStyle: CSSProperties = {
        position: "absolute", maxWidth: "none", width: sourceWidth, height: sourceHeight,
        left: `calc(${artHeight} * ${(viewBox.x - bounds.x) / bounds.height})`,
        top: `calc(${artHeight} * ${(viewBox.y - bounds.y) / bounds.height})`,
      };
      const mask = `url("${src.replace(/["\\\n\r\f]/g, character => `\\${character.charCodeAt(0).toString(16)} `)}")`;
      const silhouette = mobile;
      const artwork = <span data-brand-mark="" aria-hidden={title ? true : undefined} title={title}
        className="relative inline-block shrink-0" style={{ width: artWidth, height: artHeight, overflow: "hidden" }}>
        {silhouette
          ? <span className="bg-accent" style={{ ...sourceStyle, maskImage: mask, WebkitMaskImage: mask,
              maskSize: "100% 100%", WebkitMaskSize: "100% 100%", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat" }} />
          : <img src={src} alt="" style={sourceStyle} />}
      </span>;
      if (plate !== "shared") return artwork;
      return <span aria-hidden className={cx("inline-flex shrink-0 items-center justify-center",
        inverse ? "bg-ink-on-inverse" : "bg-ink-primary")} style={{
        height: plateSide, width: plateSide,
        borderRadius: `calc(${plateSide} * ${BADGE_RADIUS_SHARE})`,
      }}>{artwork}</span>;
    };
    return presentation === "responsive"
      ? <span className="inline-flex"><span className="hidden desktop:block">{artworkFor(false)}</span><span className="inline-flex desktop:hidden">{artworkFor(true)}</span></span>
      : artworkFor(presentation === "mobile");
  }
  if (plate !== "shared") return <img src={src} alt="" aria-hidden={title ? true : undefined} style={{ height, width: "auto" }} title={title} />;
  const imageSide = `calc(${height} * ${1 - 2 * BADGE_INSET_SHARE})`;
  return (
    <span
      aria-hidden
      className={cx(inverse
        ? "inline-flex shrink-0 items-center justify-center bg-ink-on-inverse"
        : "inline-flex shrink-0 items-center justify-center bg-ink-primary")}
      style={{ height, width: height, borderRadius: `calc(${height} * ${BADGE_RADIUS_SHARE})` }}
    >
      <img src={src} alt="" style={{ height: imageSide, width: imageSide, objectFit: "contain" }} title={title} />
    </span>
  );
}
