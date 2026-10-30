import { cx } from "../../components/internal/cx.js";
import type { DisclosureRowOptions } from "./disclosure-row-types.js";
import { componentLeaf } from "../../runtime/component-leaf.js";

const AccordionItem = componentLeaf<typeof import("../../components/preview-runtime/components/disclosure/accordion.js").AccordionItem>("components.disclosure", "AccordionItem");
const AccordionTrigger = componentLeaf<typeof import("../../components/preview-runtime/components/disclosure/accordion.js").AccordionTrigger>("components.disclosure", "AccordionTrigger");
const AccordionContent = componentLeaf<typeof import("../../components/preview-runtime/components/disclosure/accordion.js").AccordionContent>("components.disclosure", "AccordionContent");
const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Called directly so extracting a FAQ row preserves its component and id tree. */
export function disclosureRow({ id, question, questionClassName, answer, recipe, colors, answerStyle, rowStyle }: DisclosureRowOptions) {
  return <AccordionItem key={id} id={id} className={cx(recipe.item, colors.border)} style={rowStyle}>
    <AccordionTrigger className={cx(recipe.trigger, colors.primary)}>
      <SemanticContent as="span" className={questionClassName}>{question}</SemanticContent>
    </AccordionTrigger>
    <AccordionContent className={recipe.panel}>
      <SemanticContent as="div" className={cx(recipe.answer, colors.secondary)} style={answerStyle}>{answer}</SemanticContent>
    </AccordionContent>
  </AccordionItem>;
}
