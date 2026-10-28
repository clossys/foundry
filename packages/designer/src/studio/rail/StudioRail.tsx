"use client";
import { useSyncExternalStore, type ReactNode } from "react";
import { Button } from "../../components/Button.js";
import { Card } from "../../components/Card.js";
import { Disclosure } from "../../components/Disclosure.js";
import { Drawer } from "../../blocks/Drawer.js";
import { APP_FRAME_WIDE_QUERY } from "../../frames/app-frame-layout.js";
import type { StudioLabels } from "../types.js";
import { useRailView, type RailCardId } from "./rail-view-state.js";

export interface StudioRailProps {
  readonly labels: StudioLabels;
  /** The Explorer card: its layer select (header) and its body. */
  readonly explorer: ReactNode;
  readonly explorerHeader?: ReactNode;
  /** The read-only Inspector card body: the selected leaf, else the empty hint. */
  readonly inspector: ReactNode;
  readonly map: ReactNode;
  readonly zoom: ReactNode;
  readonly checks?: ReactNode;
}

const hasMedia = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function";
const subscribeWide = (change: () => void): (() => void) => {
  if (!hasMedia()) return () => {};
  const media = window.matchMedia(APP_FRAME_WIDE_QUERY);
  media.addEventListener?.("change", change);
  return () => media.removeEventListener?.("change", change);
};
const wideNow = (): boolean => !hasMedia() || window.matchMedia(APP_FRAME_WIDE_QUERY).matches;
const wideOnServer = (): boolean => true;
/**
 * Wide while the frame's wide query matches; a page without matchMedia (tests, SSR) is treated as wide. Read
 * synchronously, so a narrow page never mounts the full rail just to swap it for the drawer (hydration still
 * starts from the server's wide answer).
 */
const useWideRail = (): boolean => useSyncExternalStore(subscribeWide, wideNow, wideOnServer);

/** One rail card: a header (title and chevron, plus an optional control) over a collapsible body. */
function RailCard({ id, title, expanded, onExpandedChange, header, children }: { id: RailCardId; title: string; expanded: boolean; onExpandedChange(expanded: boolean): void; header?: ReactNode; children: ReactNode }) {
  return <Card variant="outline" data-studio-rail-card={id} className="flex min-w-0 flex-wrap items-center gap-xs p-sm">
    <Disclosure.Row title={<span className="min-w-0 truncate">{title}</span>} isExpanded={expanded} onExpandedChange={onExpandedChange} className="contents"
      triggerClassName="order-first flex min-w-0 flex-1 items-center justify-between gap-xs text-start text-body-s font-semibold text-ink-primary focus-ring"
      chevronClassName="shrink-0 text-ink-muted" chevronOpenClassName="rotate-180" panelClassName="order-last min-w-0 basis-full">
      {children}
    </Disclosure.Row>
    {header}
  </Card>;
}

/**
 * The Designer's right rail: a page Section (not frame chrome) holding five independent collapsible cards in
 * rail order, Explorer, Inspector, Canvas map, Zoom and Checks. The whole rail can be hidden; hidden and collapsed state
 * persist per user. On a narrow viewport the rail is an overlay drawer instead.
 */
export function StudioRail({ labels, explorer, explorerHeader, inspector, map, zoom, checks }: StudioRailProps) {
  const [view, update] = useRailView();
  const wide = useWideRail();
  const card = (id: RailCardId) => ({ id, expanded: !view.collapsed.includes(id),
    onExpandedChange: (expanded: boolean) => update(current => ({ ...current, collapsed: expanded ? current.collapsed.filter(other => other !== id) : [...current.collapsed, id] })) });
  const cards = <>
    <RailCard {...card("explorer")} title={labels.treeLabel} header={explorerHeader}>{explorer}</RailCard>
    <RailCard {...card("inspector")} title={labels.inspectorLabel}>{inspector}</RailCard>
    <RailCard {...card("map")} title={labels.canvas.minimap}>{map}</RailCard>
    <RailCard {...card("zoom")} title={labels.canvas.zoomLabel}>{zoom}</RailCard>
    <RailCard {...card("checks")} title={labels.scorecard.title}>{checks}</RailCard>
  </>;
  if (!wide) return <div data-studio-rail="overlay" className="absolute end-sm top-sm">
    <Drawer trigger={<Button variant="secondary" size="sm">{labels.rail.show}</Button>} heading={labels.rail.label} closeLabel={labels.rail.hide} placement="end" dismissAt={APP_FRAME_WIDE_QUERY}>
      <div className="flex min-w-0 flex-col gap-sm">{cards}</div>
    </Drawer>
  </div>;
  if (view.hidden) return <div data-studio-rail="hidden" className="absolute end-sm top-sm">
    <Button variant="secondary" size="sm" onPress={() => update(current => ({ ...current, hidden: false }))}>{labels.rail.show}</Button>
  </div>;
  return <aside data-studio-rail="" aria-label={labels.rail.label} className="designer-rail-width flex min-h-0 shrink-0 flex-col gap-sm overflow-y-auto border-s border-line-base bg-surface-base p-sm">
    <Button variant="ghost" size="sm" className="self-end" onPress={() => update(current => ({ ...current, hidden: true }))}>{labels.rail.hide}</Button>
    {cards}
  </aside>;
}
