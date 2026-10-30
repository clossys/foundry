import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import { cx } from "../components/internal/cx.js";
import {
  SECTION_FRAME_DATA_ATTR,
  SECTION_MEASURE_MAX,
  type SectionMeasure,
  UI_WIDTH_PAGE_PADDING_X,
} from "./internal/block-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

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
export type SectionFrameGround = SectionGround | "transparent";

/** No surface and no ink class: nothing paints, the context shows through. */
const TRANSPARENT_GROUND = { surface: "", primary: "" } as const;

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
  className,
  style,
  ...rest
}: SectionFrameProps) {
  const colors = ground === "transparent" ? TRANSPARENT_GROUND : SECTION_GROUND_CLASSES[ground];

  return (
    <SemanticContent as="section"
      {...SECTION_STAMP} {...rest}
      {...{ [SECTION_FRAME_DATA_ATTR]: "" }}
      className={cx(colors.surface, colors.primary, "py-lg", className)}
      style={style}
    >
      <SemanticContent as="div"
        className="mx-auto flex w-full flex-col gap-lg"
        style={{
          maxWidth: SECTION_MEASURE_MAX[measure],
          paddingInline: UI_WIDTH_PAGE_PADDING_X,
        }}
      >
        {children}
      </SemanticContent>
    </SemanticContent>
  );
}
