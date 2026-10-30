/** sections.features: host-authored copy and registered media in the selected feature member. */
import type { ReactNode } from "react";
import type { Card } from "../../components/preview-runtime/components/card/card.js";
import { componentLeaf } from "../component-leaf.js";
import { FeatureGrid } from "../../blocks/FeatureGrid.js";
import { FeatureLayouts } from "../../blocks/features/FeatureLayouts.js";
import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
import { MediaFigure } from "../../blocks/MediaFigure.js";
import type { ItemSpan } from "../../blocks/items/types.js";
import { isImageResource } from "../../catalog-assets/media.js";
import { list, memberValue, object, optionalText, readSectionContent, required, SectionContentError, text, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const featuresInputs: SectionRendererInputs = { slots: ["items", "header"], members: ["layout.grid", "layout.list", "layout.split", "layout.bento", "layout.tabs", "layout.alternating", "layout.scroll"] };
const FeatureCard = componentLeaf<typeof Card>("components.card");
const CardContent = componentLeaf<typeof import("../../components/preview-runtime/components/card/card.js").CardContent>("components.card", "CardContent");

export function renderFeaturesSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.features", featuresInputs);
  const layout = memberValue(content, "layout", ["grid", "list", "split", "bento", "tabs", "alternating", "scroll"] as const);
  const header = content.values.header === undefined ? undefined : object(content, content.values.header, "header");
  const items = list(content, required(content, "items"), "items").map((row, index) => {
    const path = `items.${index}`;
    const item = object(content, row, path);
    const span = optionalText(content, item.span, `${path}.span`);
    if (span !== undefined && !["third", "half", "two-thirds", "full"].includes(span)) throw new SectionContentError(content.leaf, `${path}.span is not a canonical bento span`);
    if (span !== undefined && layout !== "bento") throw new SectionContentError(content.leaf, `${path}.span requires layout.bento`);
    let visual: ReactNode;
    if (item.figure !== undefined) {
      const figure = object(content, item.figure, `${path}.figure`);
      if (figure.kind !== "image" || !isImageResource(figure.resource)) throw new SectionContentError(content.leaf, `${path}.figure requires a registered image resource`);
      visual = <MediaFigure image={figure.resource} />;
    }
    return { id: text(content, item.id, `${path}.id`), heading: text(content, item.heading, `${path}.heading`), description: optionalText(content, item.description, `${path}.description`), span: span as ItemSpan | undefined, visual };
  });
  const props = { items, eyebrow: header ? optionalText(content, header.eyebrow, "header.eyebrow") : undefined, heading: header ? optionalText(content, header.heading, "header.heading") : undefined, description: header ? optionalText(content, header.description, "header.description") : undefined };
  if (layout === "bento" || layout === "tabs" || layout === "alternating" || layout === "scroll") {
    return <FeatureCard data-features-component="components.card"><CardContent><FeatureLayouts {...dsAttrs("sections", "sections.features", "foundry/sections.features")} {...props} layout={layout} ground="base" /></CardContent></FeatureCard>;
  }
  return <FeatureCard data-features-component="components.card"><CardContent><FeatureGrid {...props} {...(layout ? { layout } : {})} /></CardContent></FeatureCard>;
}
