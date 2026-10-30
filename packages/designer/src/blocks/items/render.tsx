import type { ReactNode } from "react";
import { Badge } from "../../components/Badge.js";
import { StatusMark } from "../../components/StatusMark.js";
import { cx } from "../../components/internal/cx.js";
import { UI_BORDER_HAIRLINE, UI_LAYOUT_TAP_TARGET } from "../../components/internal/ui-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";
import { cardLinkContainerClassName } from "../stretched-link.js";
import { TREND_TEXT_CLASSES } from "../internal/trend.js";
import { ItemDescription, ItemHeading, ItemIcon, ItemPlate } from "./anatomy.js";
import { hasContent } from "./policies.js";
import type { ItemData, ItemSize, ItemTreatment } from "./types.js";

const RULE_CLASSES: Record<SectionGround, string> = {
  base: "border-line-strong", sunken: "border-line-strong", inverse: "border-line-on-inverse"
};
type ItemScale = ItemSize | "statement";
const SCALE_CLASSES: Record<ItemScale, string> = {
  standard: "text-body-l font-body font-semibold leading-heading",
  display: "text-h3 font-display leading-heading text-balance",
  statement: "text-h2 font-display leading-heading text-balance",
};
const EXPLAIN_SCALE_CLASSES: Record<ItemScale, string> = {
  standard: "text-h2 font-display leading-heading text-balance",
  display: "text-h1 font-display leading-heading text-balance",
  statement: "text-h0 font-display leading-heading text-balance",
};
const FIGURE_VALUE_CLASSES: Record<ItemSize, string> = { standard: "text-h2", display: "text-h1" };
const STATUS_BACKING_CLASSES: Record<SectionGround, string> = { base: "", sunken: "", inverse: "bg-surface-raised" };
/** The same shaped, visibly labelled state in static and disclosure meta rows. */
export function renderItemStatus(item: ItemData, row = false, ground: SectionGround = "base") {
  return item.status === undefined ? null : <StatusMark data-item-status="" tone={item.status.tone} className={cx(row ? "tablet:ms-auto" : undefined, STATUS_BACKING_CLASSES[ground])}>{item.status.label}</StatusMark>;
}
/** One canonical item renderer, used by standalone Item and every Items arrangement. */
export function ItemRenderer({ item, treatment, size, ground, headingLevel, statement = false, className: spanClassName, span, sharedVisualRow = false, orderClassName, navigation, profile, row = false }: {
  item: ItemData; treatment: ItemTreatment; size: ItemSize; ground: SectionGround; headingLevel?: 3 | 4;
  statement?: boolean; className?: string; span?: string;
  sharedVisualRow?: boolean; orderClassName?: string;
  navigation?: "plate" | "control" | "action";
  profile?: "sequence" | "index" | "explain";
  row?: boolean;
}) {
  const colors = SECTION_GROUND_CLASSES[ground];
  const plate = treatment === "plate";
  const frame = plate ? "plate" : treatment;
  const linkedPlate = plate && item.href !== undefined;
  const rule = treatment === "rule";
  const display = profile !== "index" && (size === "display" || statement);
  const explain = profile === "explain", index = profile === "index";
  const scaleClasses = explain ? EXPLAIN_SCALE_CLASSES : SCALE_CLASSES;
  const scaleClassName = index ? "text-body font-body font-medium leading-heading" : statement ? scaleClasses.statement : scaleClasses[size];
  const figureTrend = item.figure?.trend ?? "neutral";
  const badge = item.badge !== undefined ? <Badge variant={item.badge.tone}>{item.badge.label}</Badge> : null;
  // Status tint/text pairs are checked on base, so give them that opaque backing on every ground.
  const statusBadge = item.badge?.tone !== undefined && item.badge.tone !== "neutral";
  const legacy = navigation !== undefined;
  const control = navigation === "control" || navigation === "action";
  const icon = (legacy ? Boolean(item.icon) : hasContent(item.icon)) ? <ItemIcon className={legacy ? control ? "text-ink-muted" : cx("inline-flex link-grid-icon", colors.secondary) : cx("inline-flex", index ? "shrink-0" : undefined, colors.secondary)}>{item.icon}</ItemIcon> : null;
  const eyebrow = hasContent(item.eyebrow) ? <p data-item-eyebrow="" className={cx("text-body-s font-medium uppercase tracking-label", colors.secondary)}>{item.eyebrow}</p> : null;
  const backedBadge = statusBadge ? <span className="inline-flex rounded-pill bg-surface-base">{badge}</span> : badge;
  const metadata = hasContent(item.meta) ? <p className={cx("text-caption font-body", colors.secondary)}>{item.meta}</p> : null;
  const meta = !legacy && (hasContent(item.eyebrow) || hasContent(item.meta) || item.badge !== undefined || item.status !== undefined) ? item.status === undefined
    ? <div data-item-meta="" className="flex flex-wrap items-center gap-sm">{eyebrow}{backedBadge}{metadata}</div>
    : <div data-item-meta="" className={cx("flex flex-wrap items-center gap-sm", row ? "w-full" : undefined)}>{eyebrow}{backedBadge}{metadata}{renderItemStatus(item, row, ground)}</div> : null;
  const heading = <ItemHeading data-item-heading={legacy ? undefined : ""} as={legacy ? control ? "span" : "p" : headingLevel === 4 ? "h4" : headingLevel === 3 ? "h3" : "p"} heading={item.heading} href={item.href} variant={legacy ? control ? "control" : "plate" : frame} ground={ground} className={legacy ? cx("text-body font-body font-medium", control ? undefined : "m-0 leading-heading", colors.primary) : cx("m-0", scaleClassName, colors.primary, (display || explain) && item.href !== undefined ? "transform-none" : undefined)} anchorClassName={navigation === "plate" ? "active:decoration-current link-grid-active" : undefined} iconSize={display && !legacy ? "md" : "sm"} />;
  const description = (legacy ? Boolean(item.description) : hasContent(item.description)) ? <ItemDescription as={control ? "span" : "p"} data-item-description={legacy ? undefined : ""} data-link-grid-description={legacy && navigation !== "action" ? "" : undefined} className={legacy ? cx("text-body-s", control ? undefined : "m-0", colors.secondary) : cx("m-0 text-pretty", index ? "text-body-s" : "text-body", colors.secondary)}>{item.description}</ItemDescription> : null;
  const figure = !legacy && item.figure !== undefined ? <div data-item-figure="" className="flex flex-col gap-xs">
      <span className={cx(FIGURE_VALUE_CLASSES[size], "font-display tabular-nums", colors.primary)}>{item.figure.value}</span>
      {hasContent(item.figure.delta) ? <span data-item-delta="" className={cx("self-start text-body-s font-body", TREND_TEXT_CLASSES[figureTrend], STATUS_BACKING_CLASSES[ground])}>{item.figure.delta}</span> : null}
    </div> : null;
  // Keep the original child slots when the new fields are absent: authored nodes may use useId.
  const copy: ReactNode = figure === null
    ? <>{index ? null : icon}{meta}{heading}{description}</>
    : <>{index ? null : icon}{meta}{figure}{heading}{description}</>;
  if (legacy) return copy;
  const body = sharedVisualRow ? <>
    <div className={cx("flex min-w-0 flex-col items-start", explain ? "gap-md" : "gap-sm")}>{copy}</div>
    <div data-item-visual={hasContent(item.visual) ? "" : undefined} aria-hidden={hasContent(item.visual) ? undefined : true} className="w-full min-w-0 pt-md">{item.visual}</div>
  </> : <>{copy}{hasContent(item.visual) ? <div data-item-visual="" className="mt-auto w-full min-w-0 pt-md">{item.visual}</div> : null}</>;
  const edgeClassName = treatment === "rule" ? RULE_CLASSES[ground] : undefined;
  const className = cx("flex h-full min-w-0", index ? "flex-row items-start gap-lg" : cx("flex-col", explain && statement ? "items-center text-center" : "items-start", explain ? "gap-md" : "gap-sm"), linkedPlate ? "border border-transparent" : undefined, rule ? cx("border-t", explain ? "pt-xl" : "pt-lg") : undefined, edgeClassName, item.href === undefined ? undefined : cardLinkContainerClassName(frame, ground), spanClassName, orderClassName);
  const attrs = { "data-item": "", "data-treatment": treatment, "data-span": span, className, style: { ...(rule ? { borderBlockStartWidth: UI_BORDER_HAIRLINE } : {}), ...(linkedPlate ? { borderWidth: UI_BORDER_HAIRLINE } : {}), ...(item.href !== undefined ? { minBlockSize: UI_LAYOUT_TAP_TARGET } : {}) } };
  const content = index ? <>{icon}<div data-item-copy="" className="flex min-w-0 flex-1 flex-col gap-sm">{body}</div></> : body;
  return plate ? <ItemPlate ground={ground} {...attrs}>{content}</ItemPlate> : <article {...attrs}>{content}</article>;
}
