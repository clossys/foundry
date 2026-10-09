import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { SECTION_MEASURE_MAX } from "./internal/block-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

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
  /** Draw the media in a rounded frame with the ground's line. @default true */
  framed?: boolean;
  /** The ground the figure sits on; selects the frame line and caption ink. @default "base" */
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}

/**
 * Large media as a section module: the media, optionally framed, and its
 * caption underneath at a fixed `gap-sm`, in the section ground's muted ink.
 * Sits in a `ContentSection`'s module slot, so its spacing to the header
 * group and to other modules is the section's, not its own.
 */
export function MediaFigure({
  children,
  caption,
  measure = "column",
  framed = true,
  ground = "base",
  className,
  style,
  ...rest
}: MediaFigureProps) {
  const colors = SECTION_GROUND_CLASSES[ground];
  const contained = measure === "content";
  return (
    <figure
      {...rest}
      data-media-figure=""
      className={cx("m-0 flex w-full flex-col gap-sm", className)}
      style={contained ? { maxWidth: SECTION_MEASURE_MAX.content, ...style } : style}
    >
      <div className={framed ? cx("w-full overflow-hidden rounded-control border", colors.border) : "w-full"}>{children}</div>
      {caption ? <figcaption className={cx("text-caption", colors.muted)}>{caption}</figcaption> : null}
    </figure>
  );
}
