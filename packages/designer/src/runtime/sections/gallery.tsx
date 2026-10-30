/** sections.gallery: Gallery images drawn by registered media components, with the lightbox member. */
import type { ReactNode } from "react";
import { Gallery } from "../../blocks/Gallery.js";
import { list, mediaNode, memberValue, object, optionalText, readSectionContent, required, text, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const galleryInputs: SectionRendererInputs = { slots: ["images", "controls"], members: ["lightbox.enabled", "lightbox.disabled"] };

export function renderGallerySection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.gallery", galleryInputs);
  const images = object(content, required(content, "images"), "images");
  const items = list(content, images.items, "images.items").map((row, index) => {
    const image = object(content, row, `images.items.${index}`);
    return {
      id: text(content, image.id, `images.items.${index}.id`),
      label: text(content, image.label, `images.items.${index}.label`),
      media: mediaNode(content, image.media, `images.items.${index}.media`),
      caption: optionalText(content, image.caption, `images.items.${index}.caption`),
    };
  });
  const lightbox = memberValue(content, "lightbox", ["enabled", "disabled"] as const);
  const controls = content.values.controls === undefined ? undefined : object(content, content.values.controls, "controls");
  const labels = controls === undefined ? undefined : { close: text(content, controls.close, "controls.close"), enlarge: text(content, controls.enlarge, "controls.enlarge") };
  return <Gallery images={items} label={text(content, images.label, "images.label")} lightbox={lightbox === undefined ? undefined : lightbox === "enabled"} labels={labels} />;
}
