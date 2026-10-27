/** sections.faq: Faq's disclosure list of question and answer records. Only the list layout is mapped. */
import type { ReactNode } from "react";
import { Faq } from "../../blocks/Faq.js";
import { list, memberValue, object, readSectionContent, required, text, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const faqInputs: SectionRendererInputs = { slots: ["items"], members: ["layout.list"] };

export function renderFaqSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.faq", faqInputs);
  memberValue(content, "layout", ["list"] as const);
  const items = list(content, required(content, "items"), "items").map((row, index) => {
    const item = object(content, row, `items.${index}`);
    return { id: text(content, item.id, `items.${index}.id`), question: text(content, item.question, `items.${index}.question`), answer: text(content, item.answer, `items.${index}.answer`) };
  });
  return <Faq items={items} />;
}
