import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { SemanticContent } from "../components/SemanticContent.js";
import { TOKENS } from "../tokens/tokens.js";
import { PATTERN_RECIPES, patternBackground } from "../tokens/pattern.js";
import { SectionRevealStyle } from "../styles/section-reveal.js";
import { cx } from "../components/internal/cx.js";
import {
  SECTION_FRAME_DATA_ATTR,
  SECTION_MEASURE_MAX,
  type SectionMeasure,
  UI_WIDTH_PAGE_PADDING_X,
} from "./internal/block-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.band", "foundry/sections.band");

export type { SectionMeasure };

/**
 * The band's own ground: every `SectionGround`, plus `transparent`, which only
 * the band takes. A transparent band paints no surface and sets no ink, so it
 * takes both from wherever it sits (a parent band, an image, the page) and
 * claims no ground pairing of its own. Blocks keep the closed `SectionGround`
 * set: widening the band's ground does not widen theirs.
 */
export type SectionFrameGround = SectionGround | "transparent" | "wash";

/** No surface and no ink class: nothing paints, the context shows through. */
const TRANSPARENT_GROUND = { surface: "", primary: "" } as const;

export type SectionTexture = "grain" | "noise" | "topo";
/** Shared treatment for band and CTA; pattern paint stays behind the content. */
export function sectionTreatment(ground: SectionFrameGround, texture?: SectionTexture): CSSProperties {
  if (texture && ground === "transparent") throw new TypeError("SectionFrame: texture requires a concrete ground");
  const pattern = texture ? patternBackground(PATTERN_RECIPES[texture]) : undefined;
  return {
    ...Object.fromEntries(["--text-display-xl", "--text-display-l", "--text-display-m", "--text-h0", "--text-h1", "--text-h2", "--text-h3"].map(property => { const min = Number.parseFloat(TOKENS[property]!.value); return [property, `clamp(${min}px, ${min / 10}vw, ${(min * 72 / 56).toFixed(3)}px)`]; })),
    ...(pattern ?? {}),
    ...(ground === "wash" ? { ...(pattern ? { backgroundSize: [...Array(texture === "grain" ? 3 : texture === "noise" ? 2 : 1).fill(pattern.backgroundSize), "100% 100%"].join(", ") } : {}), backgroundImage: pattern ? `${pattern.backgroundImage}, var(--gradient-wash, linear-gradient(var(--color-surface-base), var(--color-surface-raised)))` : "var(--gradient-wash, linear-gradient(var(--color-surface-base), var(--color-surface-raised)))" } : {}),
  };
}

export interface SectionFrameProps extends HTMLAttributes<HTMLElement> {
  /** Semantic section ground; selects the complete matching surface and foreground policy. `transparent` sets neither. @default "base" */
  ground?: SectionFrameGround;
  /**
   * How wide the framed column is — `content` (default app column),
   * `wide` (stat rows and multi-column bands), or `prose` (long-form
   * copy). Maps to this package's `--ui-width-*-max` tokens.
   * @default "content"
   */
  measure?: SectionMeasure;
  /** Decorative registered assets.pattern member. */
  texture?: SectionTexture;
  /** Opt in to the shared token-driven reveal; reduced motion stays static. */
  reveal?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * The shipped marketing section frame: full-bleed ground, vertical section
 * rhythm, horizontal page padding, and a measured inner column. Compose
 * `ArticleBody`, `Stat`, and other blocks that do not own their own band
 * inside this instead of inventing a local `<section className="px-…">`.
 *
 * Sets `data-designer-section-frame` on the outer `<section>` so
 * composition checks can prove long-form blocks sit inside a framed region.
 */
export function SectionFrame({
  ground = "base",
  measure = "content",
  children,
  texture,
  reveal = false,
  className,
  style,
  ...rest
}: SectionFrameProps) {
  const colors = ground === "transparent" ? TRANSPARENT_GROUND : SECTION_GROUND_CLASSES[ground === "wash" ? "base" : ground];

  return (
    <SemanticContent as="section"
      {...SECTION_STAMP} {...rest}
      {...{ [SECTION_FRAME_DATA_ATTR]: "" }}
      data-ground={ground}
      data-texture={texture}
      data-designer-texture={texture ? "assets.pattern" : undefined}
      data-designer-reveal={reveal ? "" : undefined}
      className={cx(colors.surface, colors.primary, "py-lg", className)}
      style={{ ...sectionTreatment(ground, texture), ...style }}
    >
      {reveal ? <SectionRevealStyle /> : null}
      <SemanticContent as="div"
        className="mx-auto flex w-full flex-col gap-lg"
        style={{
          maxWidth: SECTION_MEASURE_MAX[measure],
          paddingInline: UI_WIDTH_PAGE_PADDING_X,
          ...(texture ? { backgroundColor: ground === "inverse" ? "var(--color-surface-inverse)" : ground === "sunken" ? "var(--color-surface-sunken)" : "var(--color-surface-base)" } : {}),
        }}
      >
        {children}
      </SemanticContent>
    </SemanticContent>
  );
}
