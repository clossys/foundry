import { SemanticContent } from "../components/SemanticContent.js";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { SECTION_MEASURE_MAX } from "./internal/block-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { isImageResource, type ImageResource } from "../catalog-assets/media.js";
import { IMAGE_RATIOS } from "../importers/image-ratio.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { ChromeSpecimen, type MediaFigureChrome } from "./media/ChromeSpecimen.js";
import { ChromeCallouts, type ChromeCalloutsProps } from "./media/ChromeCallouts.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.media", "foundry/sections.media");

/** Only adjacent candidates with the same crop can share a source element. */
function pictureSources(sources: ImageResource["sources"]) {
  const groups: { media: string; srcSet: string; width: number; height: number }[] = [];
  for (const source of sources ?? []) {
    const previous = groups.at(-1);
    const candidate = `${source.src} ${source.width}w`;
    if (previous?.media === source.media && previous.width * source.height === source.width * previous.height) {
      previous.srcSet += `, ${candidate}`;
    } else {
      groups.push({ media: source.media, srcSet: candidate, width: source.width, height: source.height });
    }
  }
  return groups;
}

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
  /** Static token-drawn chrome around the media box. @default "bare" */
  chrome?: MediaFigureChrome;
  /** Optional browser title, already resolved from the caller's copy. */
  chromeLabel?: ReactNode;
  /** An optional named list of caller-resolved annotations below the figure. */
  callouts?: ChromeCalloutsProps;
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
  chrome = "bare",
  chromeLabel,
  callouts,
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
    <SemanticContent as="picture" style={{ display: "block", width: "100%", height: "100%" }}>
      {pictureSources(image.sources).map((source, index) => <SemanticContent as="source" key={index} srcSet={source.srcSet} width={source.width} height={source.height} media={source.media} sizes={image.sizes} />)}
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
      <ChromeSpecimen chrome={chrome} label={chromeLabel} ground={ground}>
        <SemanticContent as="div" data-screenshot-chrome={chrome === "bare" ? "bare" : undefined}
          className={framed ? cx("w-full overflow-hidden rounded-control border", colors.border) : image === undefined ? "w-full" : "w-full overflow-hidden"}
          style={{ aspectRatio: crop ? `${crop.width} / ${crop.height}` : undefined,
            backgroundColor: image?.placeholder?.kind === "color" ? image.placeholder.value : undefined,
            backgroundImage: image?.placeholder?.kind === "blur" ? `url(${JSON.stringify(image.placeholder.value)})` : undefined,
            backgroundSize: image?.placeholder?.kind === "blur" ? "cover" : undefined }}>
          {resource}
        </SemanticContent>
      </ChromeSpecimen>
      {callouts ? <ChromeCallouts {...callouts} ground={ground} /> : null}
      {caption ? <SemanticContent as="figcaption" className={cx("text-caption", colors.muted)}>{caption}</SemanticContent> : null}
    </SemanticContent>
  );
}
