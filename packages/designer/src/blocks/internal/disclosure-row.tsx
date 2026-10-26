import { Button as AriaButton, Disclosure as AriaDisclosure, DisclosurePanel as AriaDisclosurePanel } from "react-aria-components";
import { Icon } from "../../components/Icon.js";
import { cx } from "../../components/internal/cx.js";
import { ChevronDown } from "../../icons/ChevronDown.js";
import type { DisclosureRowOptions } from "./disclosure-row-types.js";

/** Called directly so extracting a FAQ row preserves its component and id tree. */
export function disclosureRow({ id, question, questionClassName, answer, recipe, colors, answerStyle, headingLevel, rowStyle }: DisclosureRowOptions) {
  const Heading = headingLevel === 4 ? "h4" : "h3";
  return <AriaDisclosure key={id} className={cx(recipe.item, colors.border)} style={rowStyle}>
    {({ isExpanded }) => {
      const trigger = <AriaButton slot="trigger" className={cx(recipe.trigger, colors.primary)}>
        <span className={questionClassName}>{question}</span>
        <Icon glyph={ChevronDown} decorative size="md" className={cx(recipe.chevron, isExpanded ? recipe.chevronOpen : undefined)} />
      </AriaButton>;
      return <>
        {headingLevel === undefined ? trigger : <Heading className="m-0">{trigger}</Heading>}
        <AriaDisclosurePanel className={recipe.panel}>
          <div className={cx(recipe.answer, colors.secondary)} style={answerStyle}>{answer}</div>
        </AriaDisclosurePanel>
      </>;
    }}
  </AriaDisclosure>;
}
