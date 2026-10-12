import { UI_BORDER_HAIRLINE } from "../../atoms/internal/ui-vars.js";
import { Badge } from "../../atoms/Badge.js";
import { cx } from "../../atoms/internal/cx.js";
import { FAQ_ANSWER_STYLE, FAQ_ROW_CLASSES } from "../Faq.server.js";
import type { DisclosureRowOptions } from "../internal/disclosure-row-types.js";
import { SECTION_GROUND_CLASSES } from "../section-ground.js";
import { hasContent } from "./policies.js";
import type { ItemData, ItemsProps } from "./types.js";

const DISCLOSURE_ITEM_CLASS = "group/faq block w-full min-w-0";
/** Phrasing-only trigger slots; the answer owns its authored flow and controls. */
export function itemDisclosureOptions(item: ItemData, props: ItemsProps): DisclosureRowOptions {
  const { ground = "base", treatment = "plain", size = "standard", headingLevel = 3 } = props;
  const colors = SECTION_GROUND_CLASSES[ground];
  const rule = treatment === "rule" ? "border-t" : undefined;
  const status = item.badge?.tone !== undefined && item.badge.tone !== "neutral";
  const badge = item.badge ? <Badge variant={item.badge.tone}>{item.badge.label}</Badge> : null;
  const question = <span className="flex min-w-0 flex-col items-start gap-sm">
    {hasContent(item.icon) ? <span aria-hidden="true" className={cx("inline-flex", colors.secondary)}>{item.icon}</span> : null}
    {hasContent(item.eyebrow) || hasContent(item.meta) || item.badge ? <span data-item-meta="" className="flex flex-wrap items-center gap-sm">
      {hasContent(item.eyebrow) ? <span data-item-eyebrow="" className={cx("text-body-s font-medium uppercase tracking-label", colors.secondary)}>{item.eyebrow}</span> : null}
      {status ? <span className="inline-flex rounded-pill bg-surface-base">{badge}</span> : badge}
      {hasContent(item.meta) ? <span className={cx("text-caption font-body", colors.secondary)}>{item.meta}</span> : null}
    </span> : null}
    <span data-item-heading="" className={size === "display" ? "text-h3 font-display leading-heading text-balance" : "text-body-l font-body font-semibold leading-heading"}>{item.heading}</span>
  </span>;
  return {
    id: item.id, question, answer: <div data-item-description="">{item.description}</div>, headingLevel, colors, rowStyle: treatment === "rule" ? { borderTopWidth: UI_BORDER_HAIRLINE } : undefined, answerStyle: FAQ_ANSWER_STYLE,
    recipe: { ...FAQ_ROW_CLASSES, item: cx(DISCLOSURE_ITEM_CLASS, rule), trigger: cx(FAQ_ROW_CLASSES.trigger, "font-body"), answer: cx(FAQ_ROW_CLASSES.answer, "text-body") },
  };
}
