/** sections.features: FeatureGrid items. Only the grid layout is mapped. */
import type { ReactNode } from "react";
import { FeatureGrid } from "../../blocks/FeatureGrid.js";
import { list, memberValue, object, optionalText, readSectionContent, required, text, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const featuresInputs: SectionRendererInputs = { slots: ["items"], members: ["layout.grid"] };

export function renderFeaturesSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.features", featuresInputs);
  memberValue(content, "layout", ["grid"] as const);
  const items = list(content, required(content, "items"), "items").map((row, index) => {
    const item = object(content, row, `items.${index}`);
    return { id: text(content, item.id, `items.${index}.id`), heading: text(content, item.heading, `items.${index}.heading`), description: optionalText(content, item.description, `items.${index}.description`) };
  });
  return <FeatureGrid items={items} />;
}
