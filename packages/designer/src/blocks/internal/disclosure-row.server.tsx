import { Icon } from "../../components/Icon.js";
import { cx } from "../../components/internal/cx.js";
import { ChevronDown } from "../../icons/ChevronDown.js";
import type { DisclosureRowOptions } from "./disclosure-row-types.js";

export function nativeDisclosureRow({ id, question, questionClassName, answer, recipe, colors, answerStyle, headingLevel, rowStyle }: DisclosureRowOptions) {
  const Heading = headingLevel === 4 ? "h4" : "h3";
  const label = <><span className={questionClassName}>{question}</span><Icon glyph={ChevronDown} decorative size="md" className={cx(recipe.chevron, recipe.chevronNative)} /></>;
  return <details key={id} className={cx(recipe.item, recipe.details, colors.border)} style={rowStyle}>
    <summary className={cx(recipe.trigger, colors.primary)}>
      {headingLevel === undefined ? label : <Heading className="m-0 flex w-full items-center justify-between gap-lg font-medium">{label}</Heading>}
    </summary>
    <div className={cx(recipe.answer, colors.secondary)} style={answerStyle}>{answer}</div>
  </details>;
}
