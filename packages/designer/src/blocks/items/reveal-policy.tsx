import { UI_BORDER_HAIRLINE } from "../../selected-components/internal/ui-vars.js";
import { Badge } from "../../selected-components/Badge.js";
import { cx } from "../../selected-components/internal/cx.js";
import { FAQ_ANSWER_STYLE, FAQ_ROW_CLASSES } from "../Faq.server.js";
import type { DisclosureRowOptions } from "../internal/disclosure-row-types.js";
import { SECTION_GROUND_CLASSES } from "../section-ground.js";
import { collectionProfile, hasContent } from "./policies.js";
import type { ItemData, ItemsProps } from "./types.js";

const DISCLOSURE_ITEM_CLASS = "group/faq block w-full min-w-0";
/** Phrasing-only trigger slots; the answer owns its authored flow and controls. */
export function itemDisclosureOptions(item: ItemData, props: ItemsProps): DisclosureRowOptions {
  const { ground = "base", treatment = "plain", size = "standard", headingLevel = 3 } = props;
  const colors = SECTION_GROUND_CLASSES[ground];
  const index = collectionProfile(props) === "index";
  const withStatus = item.status !== undefined;
  const rule = treatment === "rule" ? "border-t" : undefined;
  const status = item.badge?.tone !== undefined && item.badge.tone !== "neutral";
  const badge = item.badge ? <Badge variant={item.badge.tone}>{item.badge.label}</Badge> : null;
  const icon = hasContent(item.icon) ? <span aria-hidden="true" className={cx("inline-flex", index ? "shrink-0" : undefined, colors.secondary)}>{item.icon}</span> : null;
  const copy = <>
    {hasContent(item.eyebrow) || hasContent(item.meta) || item.badge ? <span data-item-meta="" className={cx("flex flex-wrap items-center gap-sm", withStatus ? "tablet:w-full" : undefined)}>
      {hasContent(item.eyebrow) ? <span data-item-eyebrow="" className={cx("text-body-s font-medium uppercase tracking-label", colors.secondary)}>{item.eyebrow}</span> : null}
      {status ? <span className="inline-flex rounded-pill bg-surface-base">{badge}</span> : badge}
      {hasContent(item.meta) ? <span className={cx("text-caption font-body", colors.secondary, withStatus ? "tablet:min-w-0 tablet:flex-1" : undefined)}>{item.meta}</span> : null}
    </span> : null}
    <span data-item-heading="" className={index ? "text-body font-body font-medium leading-heading" : size === "display" ? "text-h3 font-display leading-heading text-balance" : "text-body-l font-body font-semibold leading-heading"}>{item.heading}</span>
  </>;
  const question = index ? <span className="flex min-w-0 flex-row items-start gap-lg">{icon}<span className={cx("flex min-w-0 flex-col items-start gap-sm", withStatus ? "tablet:flex-1" : undefined)}>{copy}</span></span> : <span className="flex min-w-0 flex-col items-start gap-sm">{icon}{copy}</span>;
  return {
    id: item.id, question, questionClassName: withStatus ? "tablet:min-w-0 tablet:flex-1" : undefined, answer: <div data-item-description="">{item.description}</div>, headingLevel, colors, rowStyle: treatment === "rule" ? { borderTopWidth: UI_BORDER_HAIRLINE } : undefined, answerStyle: FAQ_ANSWER_STYLE,
    recipe: { ...FAQ_ROW_CLASSES, item: cx(DISCLOSURE_ITEM_CLASS, rule), trigger: cx(FAQ_ROW_CLASSES.trigger, "font-body"), answer: cx(FAQ_ROW_CLASSES.answer, index ? "text-body-s" : "text-body") },
  };
}
