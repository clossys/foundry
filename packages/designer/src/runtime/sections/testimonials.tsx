/** sections.testimonials: TestimonialSet quotes. The layout member must agree with the quote count. */
import type { ReactNode } from "react";
import { TestimonialSet } from "../../blocks/TestimonialSet.js";
import { list, memberValue, object, optionalText, readSectionContent, required, SectionContentError, text, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const testimonialsInputs: SectionRendererInputs = { slots: ["quotes", "controls"], members: ["layout.single", "layout.grid", "layout.wall", "layout.carousel"] };

export function renderTestimonialsSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.testimonials", testimonialsInputs);
  const items = list(content, required(content, "quotes"), "quotes").map((row, index) => {
    const quote = object(content, row, `quotes.${index}`);
    return {
      id: text(content, quote.id, `quotes.${index}.id`),
      quote: text(content, quote.quote, `quotes.${index}.quote`),
      attributorName: text(content, quote.attributorName, `quotes.${index}.attributorName`),
      attributorRole: optionalText(content, quote.attributorRole, `quotes.${index}.attributorRole`),
    };
  });
  const layout = memberValue(content, "layout", ["single", "grid", "wall", "carousel"] as const);
  if ((layout === "single" || layout === "grid") && (layout === "single") !== (items.length === 1)) throw new SectionContentError(content.leaf, `layout.${layout} does not fit ${items.length} quotes`);
  const controls = content.values.controls === undefined ? undefined : object(content, content.values.controls, "controls");
  const carouselLabels = controls === undefined ? undefined : { previous: text(content, controls.previous, "controls.previous"), next: text(content, controls.next, "controls.next") };
  return <TestimonialSet items={items} layout={layout} carouselLabels={carouselLabels} />;
}
