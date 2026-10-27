import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { SECTION_MEASURE_MAX } from "./internal/block-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.media", "foundry/sections.media");

/**
 * How wide the figure runs inside its section's column: the whole column, or
 * the content measure (`--ui-width-content-max`), wider than prose but
 * narrower than a wide column.
 */
export type MediaFigureMeasure = "column" | "content";

export interface MediaFigureProps extends HTMLAttributes<HTMLElement> {
  /** The media: an image, a video, an illustration, an embed. */
  children: ReactNode;
  /** A caption under the media, rendered as the `<figcaption>`. */
  caption?: ReactNode;
  /** @default "column" */
  measure?: MediaFigureMeasure;
  /**
   * Draw one hairline (the ground's line, rounded) around the media. Off by
   * default: the media sits straight on the section ground. Turn it on only
   * when the media has no edge of its own, such as a screenshot on the same
   * color as the ground. @default false
   */
  framed?: boolean;
  /** The ground the figure sits on; selects the frame line and caption ink. @default "base" */
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}

/**
 * Large media as a section module: the media on the section ground (no
 * panel, fill, padding or shadow; at most one hairline with `framed`), and
 * its caption underneath at a fixed `gap-sm`, in the section ground's muted
 * ink. The media fits the column: give it a fluid width rather than a fixed
 * one, so it never scrolls inside the figure.
 * Sits in a `ContentSection`'s module slot, so its spacing to the header
 * group and to other modules is the section's, not its own.
 */
export function MediaFigure({
  children,
  caption,
  measure = "column",
  framed = false,
  ground = "base",
  className,
  style,
  ...rest
}: MediaFigureProps) {
  const colors = SECTION_GROUND_CLASSES[ground];
  const contained = measure === "content";
  return (
    <figure
      {...SECTION_STAMP} {...rest}
      data-media-figure=""
      className={cx("m-0 flex w-full flex-col gap-sm", className)}
      style={contained ? { maxWidth: SECTION_MEASURE_MAX.content, ...style } : style}
    >
      <div className={framed ? cx("w-full overflow-hidden rounded-control border", colors.border) : "w-full"}>{children}</div>
      {caption ? <figcaption className={cx("text-caption", colors.muted)}>{caption}</figcaption> : null}
    </figure>
  );
}
