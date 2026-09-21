import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import {
  SECTION_FRAME_DATA_ATTR,
  SECTION_MEASURE_MAX,
  type SectionMeasure,
  UI_WIDTH_PAGE_PADDING_X,
} from "./internal/block-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

export type { SectionMeasure };

export interface SectionFrameProps extends HTMLAttributes<HTMLElement> {
  /** Semantic section ground; selects the complete matching surface and foreground policy. @default "base" */
  ground?: SectionGround;
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
  const colors = SECTION_GROUND_CLASSES[ground];

  return (
    <section
      {...rest}
      {...{ [SECTION_FRAME_DATA_ATTR]: "" }}
      className={cx(colors.surface, "py-lg", className)}
      style={style}
    >
      <div
        className="mx-auto flex w-full flex-col gap-lg"
        style={{
          maxWidth: SECTION_MEASURE_MAX[measure],
          paddingInline: UI_WIDTH_PAGE_PADDING_X,
        }}
      >
        {children}
      </div>
    </section>
  );
}
