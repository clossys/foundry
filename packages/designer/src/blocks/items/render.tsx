import type { ReactNode } from "react";
import { Badge } from "../../atoms/Badge.js";
import { cx } from "../../atoms/internal/cx.js";
import { UI_BORDER_HAIRLINE, UI_LAYOUT_TAP_TARGET } from "../../atoms/internal/ui-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";
import { cardLinkContainerClassName } from "../stretched-link.js";
import { ItemDescription, ItemHeading, ItemIcon, ItemPlate } from "./anatomy.js";
import { hasContent } from "./policies.js";
import type { ItemData, ItemSize, ItemTreatment } from "./types.js";

const RULE_CLASSES: Record<SectionGround, string> = {
  base: "border-line-strong", sunken: "border-line-strong", inverse: "border-line-on-inverse"
};
const FEATURED_CLASSES: Record<SectionGround, string> = {
  base: "border-t-accent", sunken: "border-t-accent", inverse: "border-t-accent-on-inverse"
};
type ItemScale = ItemSize | "statement";
const SCALE_CLASSES: Record<ItemScale, string> = {
  standard: "text-body-l font-body font-semibold leading-heading",
  display: "text-h3 font-display leading-heading text-balance",
  statement: "text-h2 font-display leading-heading text-balance",
};
/** One canonical item renderer, used by standalone Item and every Items arrangement. */
export function ItemRenderer({ item, treatment, size, ground, headingLevel, statement = false, className: spanClassName, span, sharedVisualRow = false, orderClassName }: {
  item: ItemData; treatment: ItemTreatment; size: ItemSize; ground: SectionGround; headingLevel?: 3 | 4;
  statement?: boolean; className?: string; span?: string;
  sharedVisualRow?: boolean; orderClassName?: string;
}) {
  const colors = SECTION_GROUND_CLASSES[ground];
  const plate = treatment === "plate" || item.featured === true;
  const frame = plate ? "plate" : treatment;
  const linkedPlate = plate && item.href !== undefined;
  const rule = treatment === "rule" || item.featured === true;
  const display = size === "display" || statement;
  const scaleClassName = statement ? SCALE_CLASSES.statement : SCALE_CLASSES[size];
  const badge = item.badge !== undefined ? <Badge variant={item.badge.tone}>{item.badge.label}</Badge> : null;
  // Status tint/text pairs are checked on base, so give them that opaque backing on every ground.
  const statusBadge = item.badge?.tone !== undefined && item.badge.tone !== "neutral";
  const copy: ReactNode = <>
    {hasContent(item.icon) ? <ItemIcon className={cx("inline-flex", colors.secondary)}>{item.icon}</ItemIcon> : null}
    {hasContent(item.eyebrow) || hasContent(item.meta) || item.badge !== undefined ? <div data-item-meta="" className="flex flex-wrap items-center gap-sm">
      {hasContent(item.eyebrow) ? <p data-item-eyebrow="" className={cx("text-body-s font-medium uppercase tracking-label", colors.secondary)}>{item.eyebrow}</p> : null}
      {statusBadge ? <span className="inline-flex rounded-pill bg-surface-base">{badge}</span> : badge}
      {hasContent(item.meta) ? <p className={cx("text-caption font-body", colors.secondary)}>{item.meta}</p> : null}
    </div> : null}
    <ItemHeading data-item-heading="" as={headingLevel === 4 ? "h4" : headingLevel === 3 ? "h3" : "p"} heading={item.heading} href={item.href} variant={frame} ground={ground} className={cx("m-0", scaleClassName, colors.primary, display && item.href !== undefined ? "transform-none" : undefined)} iconSize={display ? "md" : "sm"} />
    {hasContent(item.description) ? <ItemDescription data-item-description="" className={cx("m-0 text-body text-pretty", colors.secondary)}>{item.description}</ItemDescription> : null}
  </>;
  const body = sharedVisualRow ? <>
    <div className="flex min-w-0 flex-col items-start gap-sm">{copy}</div>
    <div data-item-visual={hasContent(item.visual) ? "" : undefined} aria-hidden={hasContent(item.visual) ? undefined : true} className="w-full min-w-0 pt-md">{item.visual}</div>
  </> : <>{copy}{hasContent(item.visual) ? <div data-item-visual="" className="mt-auto w-full min-w-0 pt-md">{item.visual}</div> : null}</>;
  const edgeClassName = item.featured === true ? FEATURED_CLASSES[ground] : treatment === "rule" ? RULE_CLASSES[ground] : undefined;
  const className = cx("flex h-full min-w-0 flex-col items-start gap-sm", linkedPlate ? "border border-transparent" : undefined, rule ? "border-t pt-lg" : undefined, edgeClassName, item.href === undefined ? undefined : cardLinkContainerClassName(frame, ground), spanClassName, orderClassName);
  const attrs = { "data-item": "", "data-treatment": treatment, "data-featured": item.featured === true ? "true" : undefined, "data-span": span, className, style: { ...(rule ? { borderBlockStartWidth: UI_BORDER_HAIRLINE } : {}), ...(linkedPlate ? { borderWidth: UI_BORDER_HAIRLINE } : {}), ...(item.href !== undefined ? { minBlockSize: UI_LAYOUT_TAP_TARGET } : {}) } };
  return plate ? <ItemPlate ground={ground} {...attrs}>{body}</ItemPlate> : <article {...attrs}>{body}</article>;
}
