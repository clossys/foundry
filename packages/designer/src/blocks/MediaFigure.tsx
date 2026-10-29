import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { SECTION_MEASURE_MAX } from "./internal/block-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { isImageResource, type ImageResource } from "../catalog-assets/media.js";
import { IMAGE_RATIOS } from "../importers/image-ratio.js";
import { SemanticContent } from "../components/SemanticContent.js";
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
  children?: ReactNode;
  /** A validated asset resource, rendered with its responsive sources and crop policy. */
  image?: ImageResource;
  /** A canonical image-ratio member. Omit to keep the image's intrinsic ratio. */
  ratio?: keyof typeof IMAGE_RATIOS;
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
  image,
  ratio,
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
  if (image !== undefined && !isImageResource(image)) throw new TypeError("Invalid image resource");
  if (image !== undefined && children != null) throw new TypeError("MediaFigure accepts image or children");
  if (ratio !== undefined && !Object.hasOwn(IMAGE_RATIOS, ratio)) throw new TypeError("Invalid image ratio");
  const crop = ratio === undefined ? image : IMAGE_RATIOS[ratio];
  const imageStyle: CSSProperties = {
    display: "block", width: "100%", height: crop ? "100%" : "auto",
    objectFit: crop ? "cover" : undefined,
    objectPosition: image?.focal ? `${image.focal.x * 100}% ${image.focal.y * 100}%` : undefined,
  };
  const resource = image === undefined ? children : (
    <SemanticContent as="picture">
      {image.sources?.map((source, index) => <SemanticContent as="source" key={index} srcSet={`${source.src} ${source.width}w`} width={source.width} height={source.height} media={source.media} sizes={image.sizes} />)}
      <SemanticContent as="img" src={image.src} width={image.width} height={image.height} alt={image.decorative ? "" : image.alt} sizes={image.sizes} style={imageStyle} />
    </SemanticContent>
  );
  return (
    <SemanticContent as="figure"
      {...SECTION_STAMP} {...rest}
      data-media-figure=""
      className={cx("m-0 flex w-full flex-col gap-sm", className)}
      style={contained ? { maxWidth: SECTION_MEASURE_MAX.content, ...style } : style}
    >
      <SemanticContent as="div" className={framed ? cx("w-full overflow-hidden rounded-control border", colors.border) : "w-full overflow-hidden"}
        style={{ aspectRatio: crop ? `${crop.width} / ${crop.height}` : undefined,
          backgroundColor: image?.placeholder?.kind === "color" ? image.placeholder.value : undefined,
          backgroundImage: image?.placeholder?.kind === "blur" ? `url(${JSON.stringify(image.placeholder.value)})` : undefined,
          backgroundSize: image?.placeholder?.kind === "blur" ? "cover" : undefined }}>
        {resource}
      </SemanticContent>
      {caption ? <SemanticContent as="figcaption" className={cx("text-caption", colors.muted)}>{caption}</SemanticContent> : null}
    </SemanticContent>
  );
}
