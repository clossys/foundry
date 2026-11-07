import type { ReactNode } from "react";
import { cx } from "../../components/internal/cx.js";
import { componentLeaf } from "../../runtime/component-leaf.js";
import { TREND_TEXT_CLASSES } from "../internal/trend.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";
import { assertItemAxes, assertItemData, hasContent } from "./policies.js";
import { renderItemStatus } from "./render.js";
import type { ItemData } from "./types.js";

type Stock = typeof import("../../components/item/item.js");
const ItemRoot = componentLeaf<Stock["Item"]>("components.item");
const ItemHeader = componentLeaf<Stock["ItemHeader"]>("components.item", "ItemHeader");
const ItemMedia = componentLeaf<Stock["ItemMedia"]>("components.item", "ItemMedia");
const ItemContent = componentLeaf<Stock["ItemContent"]>("components.item", "ItemContent");
const ItemTitle = componentLeaf<Stock["ItemTitle"]>("components.item", "ItemTitle");
const ItemDescription = componentLeaf<Stock["ItemDescription"]>("components.item", "ItemDescription");
const ItemFooter = componentLeaf<Stock["ItemFooter"]>("components.item", "ItemFooter");
const Badge = componentLeaf<typeof import("../../components/Badge.js").Badge>("components.badge");
const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

export interface StockItemProps extends ItemData {
  /** The section ground the item sits on. @default "base" */
  ground?: SectionGround;
  /** A semantic heading when supplied; omission keeps the stock title. */
  headingLevel?: 3 | 4;
}

/**
 * One item on the stock Item anatomy, server-safe through its component leaves.
 * The shared link-safety helper refuses unsanctioned destinations and nested
 * controls before a linked item renders as the stock Item's single link.
 */
export function StockItem({ ground = "base", headingLevel, ...item }: StockItemProps) {
  if (headingLevel !== undefined && headingLevel !== 3 && headingLevel !== 4) throw new RangeError("Item: heading level must be three or four.");
  assertItemAxes("plain", "standard", ground);
  assertItemData(item);
  const colors = SECTION_GROUND_CLASSES[ground];
  const badge = item.badge === undefined ? null : <Badge variant={item.badge.tone}>{item.badge.label}</Badge>;
  // Status tint/text pairs are checked on base, so they keep that opaque backing on every ground.
  const tinted = item.badge?.tone !== undefined && item.badge.tone !== "neutral";
  const meta = hasContent(item.eyebrow) || hasContent(item.meta) || item.badge !== undefined || item.status !== undefined
    ? <ItemHeader data-item-meta="" className="flex-wrap justify-start">
      {hasContent(item.eyebrow) ? <SemanticContent as="p" data-item-eyebrow="" className={cx("m-0 text-body-s font-medium uppercase tracking-label", colors.secondary)}>{item.eyebrow}</SemanticContent> : null}
      {tinted ? <SemanticContent as="span" className="inline-flex rounded-pill bg-surface-base">{badge}</SemanticContent> : badge}
      {hasContent(item.meta) ? <SemanticContent as="p" className={cx("m-0 text-caption font-body", colors.secondary)}>{item.meta}</SemanticContent> : null}
      {renderItemStatus(item, false, ground)}
    </ItemHeader> : null;
  const figure = item.figure === undefined ? null : <SemanticContent as="div" data-item-figure="" className="flex flex-col gap-xs">
    <SemanticContent as="span" className={cx("text-h2 font-display tabular-nums", colors.primary)}>{item.figure.value}</SemanticContent>
    {hasContent(item.figure.delta) ? <SemanticContent as="span" data-item-delta="" className={cx("self-start text-body-s font-body", TREND_TEXT_CLASSES[item.figure.trend ?? "neutral"], ground === "inverse" ? "bg-surface-raised" : undefined)}>{item.figure.delta}</SemanticContent> : null}
  </SemanticContent>;
  const title: ReactNode = headingLevel === 3 ? <SemanticContent as="h3" className="m-0">{item.heading}</SemanticContent>
    : headingLevel === 4 ? <SemanticContent as="h4" className="m-0">{item.heading}</SemanticContent> : item.heading;
  const content = <>
    {meta}
    {hasContent(item.icon) ? <ItemMedia variant="icon" aria-hidden="true" className={colors.secondary}>{item.icon}</ItemMedia> : null}
    <ItemContent>
      {figure}
      <ItemTitle data-item-heading="" className={colors.primary}>{title}</ItemTitle>
      {hasContent(item.description) ? <ItemDescription data-item-description="" className={colors.secondary}>{item.description}</ItemDescription> : null}
    </ItemContent>
    {hasContent(item.visual) ? <ItemFooter data-item-visual="">{item.visual}</ItemFooter> : null}
  </>;
  // The stock root renders its link only when an href key is present.
  return item.href === undefined ? <ItemRoot data-item="">{content}</ItemRoot> : <ItemRoot data-item="" href={item.href}>{content}</ItemRoot>;
}
