import type { HTMLAttributes, ReactNode } from "react";
import { SemanticContent } from "../components/SemanticContent.js";
import { cx } from "../components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { GalleryTile, GalleryLightbox, type GalleryLabels } from "./Gallery/parts.js";
const SECTION_STAMP = dsAttrs("sections", "sections.gallery", "foundry/sections.gallery");

export interface GalleryImage {
  id: string;
  /** Host image node with its own alternative text. */
  media: ReactNode;
  /** Names the image's enlarge control and dialog. */
  label: string;
  caption?: ReactNode;
}
export interface GalleryProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  images: readonly GalleryImage[];
  label: string;
  lightbox?: boolean;
  /** Host-authored chrome, required whenever the lightbox is enabled. */
  labels?: GalleryLabels;
}

/** Shared image tiles; modal behavior belongs to components.dialog. */
export function Gallery({ images, label, lightbox = true, labels, className, ...rest }: GalleryProps) {
  if (lightbox && (!labels?.close?.trim() || (typeof labels.enlarge !== "function" && typeof labels.enlarge !== "string") || (typeof labels.enlarge === "string" && !labels.enlarge.trim()))) throw new TypeError("Gallery: lightbox requires authored labels.");
  return <SemanticContent as="section" {...SECTION_STAMP} {...rest} aria-label={label} data-lightbox={lightbox ? "enabled" : "disabled"} className={cx("flex flex-col", className)}>
    <SemanticContent as="ul" role="list" className="grid grid-cols-1 gap-md tablet:grid-cols-2 desktop:grid-cols-3">
      {images.map(image => <SemanticContent as="li" key={image.id} className="min-w-0">
        <GalleryTile caption={image.caption}>
          {lightbox ? <GalleryLightbox image={image} labels={labels!} /> : image.media}
        </GalleryTile>
      </SemanticContent>)}
    </SemanticContent>
  </SemanticContent>;
}
