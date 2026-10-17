import { useId, type ReactNode } from "react";
import { cx } from "../../atoms/internal/cx.js";
import { SECTION_GROUND_CLASSES } from "../section-ground.js";
import { assertItems, collectionProfile, loneTabletThirds } from "./policies.js";
import { ItemRenderer, renderItemStatus } from "./render.js";
import { ItemPlate } from "./anatomy.js";
import { UI_BORDER_HAIRLINE, UI_LAYOUT_TAP_TARGET } from "../../atoms/internal/ui-vars.js";
import { assertNoNestedInteractive, cardLinkContainerClassName } from "../stretched-link.js";
import { renderConnectedTrack, renderOrdinal, renderTerminal, orderLayout, orderedItemStyle } from "./order.js";
import { hasContent } from "./policies.js";
import type { ItemData, ItemSpan, ItemsProps } from "./types.js";

const COLUMN_CLASSES: Record<2 | 3, string> = {
  2: "grid grid-cols-1 gap-x-2xl gap-y-3xl tablet:grid-cols-2",
  3: "grid grid-cols-1 gap-x-2xl gap-y-3xl tablet:grid-cols-2 tablet-lg:grid-cols-3",
};
const ROW_CLASSES: Record<1 | 2 | 3, string> = {
  1: "grid grid-cols-1 gap-y-lg", 2: "grid grid-cols-1 gap-y-lg tablet:grid-cols-2 tablet:gap-x-3xl",
  3: "grid grid-cols-1 gap-lg tablet:grid-cols-2 tablet-lg:grid-cols-3",
};
type DisclosureRenderer = (item: ItemData, props: ItemsProps) => ReactNode;
const TWO_THIRDS = "two-thirds" as const;
const BENTO_SPAN_CLASSES: Record<ItemSpan, string> = {
  third: "tablet:col-span-6 tablet-lg:col-span-4", half: "tablet:col-span-6", [TWO_THIRDS]: "tablet:col-span-12 tablet-lg:col-span-8", full: "tablet:col-span-12"
};
function renderItems(props: ItemsProps, columns: number | undefined, disclosure?: DisclosureRenderer, start = 1) {
  const { arrangement, treatment = "plain", size = "standard", ground = "base", scale = "item", headingLevel = 3 } = props;
  const spans = arrangement === "bento" ? props.items.map(item => item.span === undefined ? "half" : item.span) : [];
  const tabletLone = loneTabletThirds(spans);
  const connected = props.order === "connected";
  const ordered = props.order !== undefined && props.order !== "none";
  const profile = collectionProfile(props);
  // Lane bodies carry their own offset. A shared visual subgrid would cancel that stagger.
  const withVisuals = connected && arrangement === "columns" && props.lanes === undefined && props.items.some(item => hasContent(item.visual));
  return props.items.map((item, index) => {
    const span = spans[index];
    const lone = arrangement === "columns" && columns === 3 && props.items.length % 2 === 1 && index === props.items.length - 1;
    const spanClassName = span !== undefined ? (tabletLone[index] ? "tablet:col-span-12 tablet-lg:col-span-4" : BENTO_SPAN_CLASSES[span]) : lone ? "tablet:col-span-2 tablet-lg:col-span-1" : undefined;
    const sharedBody = withVisuals ? arrangement === "columns" ? "tablet:row-span-2 tablet:grid tablet:grid-rows-subgrid" : props.lanes ? props.items.length === 3 ? "tablet-lg:row-span-2 tablet-lg:grid tablet-lg:grid-rows-subgrid" : "desktop:row-span-2 desktop:grid desktop:grid-rows-subgrid" : undefined : undefined;
    const finalRow = (count: number) => index >= Math.floor((props.items.length - 1) / count) * count;
    const labelRows = sharedBody === undefined || !hasContent(props.endLabel) ? undefined : arrangement === "columns" ? cx(finalRow(2) ? "tablet:row-span-3" : undefined, columns === 3 ? finalRow(3) ? "tablet-lg:row-span-3" : "tablet-lg:row-span-2" : undefined) : props.items.length === 3 ? "tablet-lg:row-span-3" : "desktop:row-span-3";
    const sharedRows = cx(sharedBody, labelRows);
    const disclosureItem = props.reveal !== "disclose" || item.status === undefined ? item : { ...item, meta: <span className="flex w-full flex-wrap items-center gap-sm">{hasContent(item.meta) ? <span>{item.meta}</span> : null}{renderItemStatus(item, true, ground)}</span> };
    const body = props.reveal === "disclose" ? disclosure!(disclosureItem, props) : <ItemRenderer item={item} treatment={treatment} size={size} ground={ground} statement={scale === "statement"} profile={profile} row={arrangement === "rows"} headingLevel={headingLevel} span={span} sharedVisualRow={withVisuals} orderClassName={cx(sharedBody, connected ? "h-auto items-order-body" : ordered ? "min-w-0 flex-1" : undefined)} />;
    const disclosureBody = props.reveal === "disclose" && treatment === "plate" ? <ItemPlate ground={ground} className="w-full min-w-0">{body}</ItemPlate> : body;
    return <li key={item.id} data-lane={connected ? item.lane : undefined} className={cx("h-full min-w-0", spanClassName, connected ? "relative items-order-cell" : ordered ? "flex items-start gap-lg" : undefined, sharedRows)} style={connected ? orderedItemStyle(item, props) : undefined}>
      {ordered ? renderOrdinal({ ordinal: start + index, props, connected }) : null}
      {connected ? renderConnectedTrack({ item, index, props }) : null}
      {disclosureBody}
      {connected && index === props.items.length - 1 ? renderTerminal({ props }) : null}
    </li>;
  });
}
/** Group labels are caption paragraphs naming groups; item headings keep the explicit h3/h4 outline. */
function GroupedItems({ props, columns, disclosure }: { props: ItemsProps; columns: number; disclosure?: DisclosureRenderer }) {
  const prefix = useId();
  const groupGround = props.ground === undefined ? "base" : props.ground;
  const groupColors = SECTION_GROUND_CLASSES[groupGround];
  const items = new Map(props.items.map((item) => [item.id, item]));
  const List = props.order === "numbered" ? "ol" : "ul";
  let start = 1;
  return <div data-items="" data-arrangement="rows" data-columns={columns} className={cx(ROW_CLASSES[columns as 1 | 2], props.className)}>
    {props.groups!.map((group, index) => {
      const id = `${prefix}-items-group-${index}`;
      const groupProps = { ...props, groups: undefined, items: group.items.map((itemId) => items.get(itemId)!) };
      const groupStart = start;
      start += group.items.length;
      return <div key={group.id} role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-md">
        <p id={id} className={cx("m-0 text-caption font-mono uppercase tracking-label", groupColors.secondary)}>{group.label}</p>
        <List role="list" aria-labelledby={id} start={List === "ol" ? groupStart : undefined} className="m-0 flex list-none flex-col gap-lg p-0">{renderItems(groupProps, 1, disclosure, groupStart)}</List>
      </div>;
    })}
  </div>;
}
/** A bounded collection of items, with one canonical validation and rendering path. */
export function ItemsStatic(props: ItemsProps, disclosure?: DisclosureRenderer) {
  const columns = assertItems(props);
  if (props.reveal === "disclose" && !disclosure) throw new TypeError("Items: a disclosure renderer is required.");
  if (props.groups !== undefined) return <GroupedItems props={props} columns={columns!} disclosure={disclosure} />;
  const { arrangement, treatment = "plain", ground = "base" } = props;
  const layout = arrangement === "columns" ? COLUMN_CLASSES[columns as 2 | 3] : arrangement === "rows" ? ROW_CLASSES[columns as 1 | 2 | 3] : arrangement === "bento" ? "grid grid-cols-1 gap-xl tablet:grid-cols-12" : props.order === "connected" ? "flex flex-col gap-2xl" : "flex flex-col gap-3xl";
  const plateGap = arrangement === "columns" && treatment === "plate" ? "gap-y-2xl" : undefined;
  const List = props.order === "numbered" || props.order === "connected" ? "ol" : "ul";
  const order = props.order === "connected" ? orderLayout(props) : undefined;
  const list = <List role="list" aria-labelledby={props["aria-labelledby"]} data-items="" data-arrangement={arrangement} data-columns={columns} data-treatment={treatment} className={cx("m-0 list-none p-0", layout, plateGap, order?.className, props.className)} style={order?.style}>{renderItems(props, columns, disclosure)}</List>;
  return hasContent(props.caption) ? <div className="flex flex-col gap-lg">{list}<p data-item-caption="" className={cx("m-0 text-caption", SECTION_GROUND_CLASSES[ground].secondary)}>{props.caption}</p></div> : list;
}

/** Private NavGrid collection policy; public Items counts and validation remain separate. */
export function renderNavItems(items: readonly ItemData[]) {
  const linked = cardLinkContainerClassName("plate", "base");
  const frame = "border border-transparent rounded-panel p-lg tablet-lg:p-xl bg-surface-sunken hover:bg-surface-raised active:bg-surface-raised";
  return <ul data-link-grid="" data-count={items.length} data-surface="plate" className="m-0 list-none p-0 grid grid-cols-1 gap-lg tablet:grid-cols-6">
    {items.map((item, index) => {
      assertNoNestedInteractive("LinkGrid", item.id, [item.icon, item.heading, item.description]);
      return <li key={item.id} style={{ minBlockSize: UI_LAYOUT_TAP_TARGET, borderWidth: UI_BORDER_HAIRLINE }} className={cx("flex min-w-0 flex-col gap-sm", linked, items.length === 2 || items.length === 4 || (items.length === 5 && index >= 3) ? "tablet:col-span-3" : "tablet:col-span-2", frame)}>
        <ItemRenderer item={item} treatment="plate" size="standard" ground="base" navigation="plate" />
      </li>;
    })}
  </ul>;
}
