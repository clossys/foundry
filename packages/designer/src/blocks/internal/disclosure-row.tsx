import { Disclosure } from "../../selected-components/Disclosure.js";
import { cx } from "../../selected-components/internal/cx.js";
import type { DisclosureRowOptions } from "./disclosure-row-types.js";

/** Called directly so extracting a FAQ row preserves its component and id tree. */
export function disclosureRow({ id, question, questionClassName, answer, recipe, colors, answerStyle, headingLevel, rowStyle }: DisclosureRowOptions) {
  return <Disclosure.Row key={id} headingLevel={headingLevel} className={cx(recipe.item, colors.border)} style={rowStyle}
    triggerClassName={cx(recipe.trigger, colors.primary)} chevronClassName={recipe.chevron} chevronOpenClassName={recipe.chevronOpen} panelClassName={recipe.panel}
    title={<span className={questionClassName}>{question}</span>}>
    <div className={cx(recipe.answer, colors.secondary)} style={answerStyle}>{answer}</div>
  </Disclosure.Row>;
}
