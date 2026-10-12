import type { CSSProperties } from "react";
import { Icon } from "../../atoms/Icon.js";
import { cx } from "../../atoms/internal/cx.js";
import { UI_BORDER_HAIRLINE } from "../../atoms/internal/ui-vars.js";
import { ArrowRight } from "../../icons/ArrowRight.js";
import { SECTION_GROUND_CLASSES } from "../section-ground.js";
import { hasContent } from "./policies.js";
import { ORDER_LAYOUT_CLASSES } from "./order-classes.js";
import type { ItemData, ItemsProps } from "./types.js";
type OrderStyle = CSSProperties & { [key: `--items-${string}`]: string | number };
const M = "var(--spacing-2xl)";
const LINE = { base: "bg-line-strong", sunken: "bg-line-strong", inverse: "bg-line-on-inverse" } as const;
const DISC = { base: "bg-accent-tint text-accent-text", sunken: "bg-accent-tint text-accent-text", inverse: "border border-line-on-inverse text-ink-on-inverse" } as const;
export function orderLayout(props: ItemsProps): { className: string; style: OrderStyle } {
  const columns = props.arrangement === "columns";
  const wide = columns ? ORDER_LAYOUT_CLASSES.columns : props.lanes ? props.items.length === 3 ? ORDER_LAYOUT_CLASSES.lanes3 : ORDER_LAYOUT_CLASSES.lanes5 : undefined;
  return { className: cx(ORDER_LAYOUT_CLASSES.root, wide), style: { "--items-gap-inline": M, "--items-gap-block": columns && props.treatment !== "plate" ? "var(--spacing-3xl)" : M } };
}
export function orderedItemStyle(item: ItemData, props: ItemsProps): OrderStyle {
  const second = props.lanes !== undefined && item.lane === props.lanes[1]!.id;
  return { "--items-lane-narrow": second ? "var(--spacing-xl)" : "0px", "--items-lane-wide": second ? "var(--spacing-4xl)" : "0px", "--items-body-narrow": props.lanes ? "var(--spacing-lg)" : "0px" };
}
export function renderOrdinal({ ordinal, props, connected = false }: { ordinal: number; props: ItemsProps; connected?: boolean }) {
  const ground = props.ground ?? "base";
  const outline = ground === "inverse" ? ORDER_LAYOUT_CLASSES.inverseOutline : ORDER_LAYOUT_CLASSES.forcedLine;
  return <span data-item-ordinal="" aria-hidden="true" className={cx("flex shrink-0 items-center justify-center rounded-pill text-body-s font-mono", connected ? ORDER_LAYOUT_CLASSES.ordinal : undefined, DISC[ground], outline)} style={{ inlineSize: M, blockSize: M, borderWidth: UI_BORDER_HAIRLINE }}>{ordinal}</span>;
}
function segment(name: string, props: ItemsProps) {
  const ground = props.ground ?? "base";
  return <span data-item-segment={name} className={cx("absolute", LINE[ground], ORDER_LAYOUT_CLASSES.forcedLine)} style={{ borderWidth: UI_BORDER_HAIRLINE }} />;
}
function narrowTransition(item: ItemData, next: ItemData, props: ItemsProps) {
  const from = props.lanes && item.lane === props.lanes[1]!.id ? "var(--spacing-xl)" : "0px";
  const to = props.lanes && next.lane === props.lanes[1]!.id ? "var(--spacing-xl)" : "0px";
  const visibility = props.arrangement === "columns" ? ORDER_LAYOUT_CLASSES.narrowColumns : props.lanes ? props.items.length === 3 ? ORDER_LAYOUT_CLASSES.narrowLanes3 : ORDER_LAYOUT_CLASSES.narrowLanes5 : "contents";
  return <span data-item-route="stacked" className={cx(visibility, ORDER_LAYOUT_CLASSES.stackedTrack)} style={{ "--items-from": from, "--items-to": to } as OrderStyle}>
    {segment("outgoing", props)}{item.lane !== next.lane ? segment("handoff", props) : null}{segment("incoming", props)}
  </span>;
}
function wideTransition(item: ItemData, next: ItemData, index: number, columns: number, props: ItemsProps, className: string) {
  const from = props.lanes && item.lane === props.lanes[1]!.id ? "var(--spacing-4xl)" : "0px";
  const to = props.lanes && next.lane === props.lanes[1]!.id ? "var(--spacing-4xl)" : "0px";
  const rowEnd = (index + 1) % columns === 0;
  return <span data-item-route={`columns-${columns}`} data-item-handoff={rowEnd ? "" : undefined} className={cx(className, rowEnd ? "items-track-return" : "items-track-inline")} style={{ "--items-from": from, "--items-to": to, "--items-columns": columns } as OrderStyle}>
    {segment("outgoing", props)}
    {rowEnd ? <>{segment("turn-out", props)}{segment("return", props)}{segment("turn-in", props)}</> : from !== to ? segment("handoff", props) : null}
    {segment("incoming", props)}
  </span>;
}
export function renderConnectedTrack({ item, index, props }: { item: ItemData; index: number; props: ItemsProps }) {
  const next = props.items[index + 1], lane = props.lanes?.find(lane => lane.id === item.lane), ground = props.ground ?? "base";
  return <>
    {lane ? <span data-item-lane-label="" className={cx("relative block items-order-lane-label text-body-s font-medium uppercase tracking-label", props.items.length === 3 ? "tablet-lg:absolute" : "desktop:absolute", SECTION_GROUND_CLASSES[ground].secondary)}>{lane.label}</span> : null}
    {next ? <span data-item-connector="" data-item-transition={index} aria-hidden="true" className={ORDER_LAYOUT_CLASSES.transition}>
      {narrowTransition(item, next, props)}
      {props.arrangement === "columns" ? props.columns === 2 ? wideTransition(item, next, index, 2, props, ORDER_LAYOUT_CLASSES.wideColumns2) : <>{wideTransition(item, next, index, 2, props, ORDER_LAYOUT_CLASSES.wideTablet2)}{wideTransition(item, next, index, 3, props, ORDER_LAYOUT_CLASSES.wideColumns3)}</> : props.lanes ? wideTransition(item, next, index, props.items.length, props, props.items.length === 3 ? ORDER_LAYOUT_CLASSES.wideLanes3 : ORDER_LAYOUT_CLASSES.wideLanes5) : null}
    </span> : null}
  </>;
}
export function renderTerminal({ props }: { props: ItemsProps }) {
  const end = props.end ?? "ends", ground = props.ground ?? "base", colors = SECTION_GROUND_CLASSES[ground], ends = end === "ends";
  const arrow = props.arrangement === "columns" ? "rotate-90 tablet:rotate-0 tablet:rtl:rotate-180" : props.lanes ? props.items.length === 3 ? "rotate-90 tablet-lg:rotate-0 tablet-lg:rtl:rotate-180" : "rotate-90 desktop:rotate-0 desktop:rtl:rotate-180" : "rotate-90";
  const terminalClass = ends ? cx("rounded-pill", LINE[ground], ORDER_LAYOUT_CLASSES.forcedLine) : ground === "inverse" ? "text-line-on-inverse" : "text-line-strong";
  return <>
    <span data-item-connector="" aria-hidden="true" className={cx("pointer-events-none absolute items-order-terminal-track", LINE[ground], ORDER_LAYOUT_CLASSES.forcedLine)} style={{ borderWidth: UI_BORDER_HAIRLINE }} />
    <span data-item-end={end} aria-hidden="true" className={cx("pointer-events-none absolute items-order-end border-none", terminalClass)} style={{ borderWidth: UI_BORDER_HAIRLINE, inlineSize: "var(--ui-icon-sm)", blockSize: "var(--ui-icon-sm)", marginInlineStart: "calc(var(--ui-icon-sm) / -2)", transform: "translateY(-50%)" }}>{ends ? null : <Icon glyph={ArrowRight} decorative size="sm" className={arrow} />}</span>
    {hasContent(props.endLabel) ? <span data-item-end-label="" className={cx("block mt-xl text-body-s", colors.secondary)}>{props.endLabel}</span> : null}
  </>;
}
