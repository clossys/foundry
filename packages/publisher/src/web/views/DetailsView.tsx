"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { Banner, Skeleton, Tabs } from "@clossys/designer/components";
import type { BannerProps } from "@clossys/designer/components";
import { mergeUiClasses } from "@clossys/designer/components/server";
import { DetailView, EmptyState, Panel, RecordLedger, SectionHeader, Stat, StatusList } from "@clossys/designer/blocks";
import type { DetailViewProps, EmptyStateProps, PanelProps, RecordLedgerProps, StatProps, StatusListProps } from "@clossys/designer/blocks";
import { assertViewContentRoot } from "../internal/viewContentRoot.js";

/** Closed Block entries retain each shipped Block's own props and behavior. */
export type DetailsViewBlock =
  | { kind: "detail"; props: DetailViewProps }
  | { kind: "panel"; props: PanelProps }
  | { kind: "stat"; props: StatProps }
  | { kind: "status-list"; props: StatusListProps }
  | { kind: "record-ledger"; props: RecordLedgerProps };

export type DetailsViewLayout = "main-aside" | "single";
export type DetailsViewRegion = "main" | "aside";
/** Localized section states replace only that section's Block content. */
export type DetailsViewSectionState =
  | { kind: "loading"; label: string }
  | { kind: "empty"; props: EmptyStateProps }
  | { kind: "error"; props: Omit<BannerProps, "variant"> };

export interface DetailsViewSection {
  id: string;
  title: string;
  block: DetailsViewBlock;
  /** @default "main" */
  region?: DetailsViewRegion;
  state?: DetailsViewSectionState;
}
export interface DetailsViewTab { id: string; label: string; sections: readonly DetailsViewSection[] }

interface DetailsViewCommonProps extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "children"> {
  /** Content enters through the declared Block sections. */
  children?: never;
  empty: EmptyStateProps;
  /** Main content and a narrow aside, or all sections in their original order. @default "main-aside" */
  layout?: DetailsViewLayout;
  /** A caller-owned content notice, normally a Designer Banner, before tabs and sections. */
  banner?: ReactNode;
}

export type DetailsViewProps = DetailsViewCommonProps & (
  | { sections: readonly DetailsViewSection[]; tabs?: never; tab?: never; onTabChange?: never; tabsLabel?: never }
  | { sections?: never; tabs: readonly DetailsViewTab[]; tab: string; onTabChange: (id: string) => void; tabsLabel: string }
);

const BLOCK_KINDS = new Set(["detail", "panel", "stat", "status-list", "record-ledger"]);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function assertSections(sections: readonly DetailsViewSection[]): void {
  if (!Array.isArray(sections)) throw new TypeError("DetailsView: sections must be an array of typed Block entries.");
  const ids = new Set<string>();
  for (const section of sections) {
    if (!section || !text(section.id) || !text(section.title) || ids.has(section.id)) throw new TypeError("DetailsView: each section requires a unique nonempty id and title.");
    ids.add(section.id);
    if (!section.block || typeof section.block !== "object" || !BLOCK_KINDS.has(section.block.kind) || !section.block.props || typeof section.block.props !== "object") throw new TypeError("DetailsView: every section requires a typed Block entry.");
    if (section.region !== undefined && section.region !== "main" && section.region !== "aside") throw new TypeError("DetailsView: section region must be main or aside.");
    const state = section.state;
    if (state !== undefined) {
      if (!state || typeof state !== "object" || !["loading", "empty", "error"].includes(state.kind)) throw new TypeError("DetailsView: section state must be loading, empty or error data.");
      if (state.kind === "loading") {
        if (!text(state.label)) throw new TypeError("DetailsView: loading state requires a nonempty label.");
      } else if (!state.props || typeof state.props !== "object" || (state.kind === "empty" ? state.props.title === undefined : state.props.children === undefined)) {
        throw new TypeError("DetailsView: section state requires its localized content props.");
      }
    }
  }
}

function sectionBlock(block: DetailsViewBlock) {
  switch (block.kind) {
    case "detail": return <DetailView {...block.props} />;
    case "panel": return <Panel {...block.props} />;
    case "stat": return <Stat {...block.props} />;
    case "status-list": return <StatusList {...block.props} />;
    case "record-ledger": return <RecordLedger {...block.props} />;
  }
}

function sectionContent(section: DetailsViewSection) {
  const state = section.state;
  return (
    <section key={section.id} data-details-section={section.id} className="flex min-w-0 flex-col gap-md">
      <SectionHeader title={section.title} />
      {state === undefined ? sectionBlock(section.block)
        : state.kind === "loading" ? <Skeleton role="status" aria-busy="true" aria-label={state.label} />
        : state.kind === "empty" ? <EmptyState {...state.props} />
        : <Banner {...state.props} variant="danger" />}
    </section>
  );
}

function sectionLayout(sections: readonly DetailsViewSection[], empty: EmptyStateProps, layout: DetailsViewLayout) {
  if (sections.length === 0) return <EmptyState {...empty} />;
  const main = layout === "single" ? sections : sections.filter(section => (section.region ?? "main") === "main");
  const aside = layout === "single" ? [] : sections.filter(section => section.region === "aside");
  return (
    <div className={aside.length === 0 ? "flex min-w-0 flex-col gap-xl" : "grid grid-cols-1 gap-xl tablet:grid-cols-3"}>
      <div className={aside.length === 0 ? "flex min-w-0 flex-col gap-xl" : "flex min-w-0 flex-col gap-xl tablet:col-span-2"}>{main.map(sectionContent)}</div>
      {aside.length === 0 ? null : <aside aria-label={aside.map(section => section.title).join(", ")} className="flex min-w-0 flex-col gap-xl">{aside.map(sectionContent)}</aside>}
    </div>
  );
}

/**
 * Standard entity details content inside an AppFrame content region. AppFrame
 * owns page information; Tabs owns tab interaction; named sections
 * arrange typed Designer Blocks through one main/aside or single layout. States
 * remain local to their section; tab selection and URL state belong to the host.
 * This interactive implementation also supports ordinary SSR; the
 * react-server entry exposes the established wrong-channel client-only stub.
 */
export function DetailsView({ empty, layout = "main-aside", banner, sections, tabs, tab, onTabChange, tabsLabel, className, ...rest }: DetailsViewProps) {
  for (const key of ["title", "subtitle", "actions", "index"]) {
    if (Object.hasOwn(rest, key)) throw new TypeError(`DetailsView: unknown prop "${key}"; page-level information belongs in AppFrame page.`);
  }
  assertViewContentRoot("DetailsView", rest);
  for (const key of ["brand", "header", "footer", "nav", "mainId", "children", "leftPanel", "rightPanel", "bottomPanel", "sideColumn", "selectedTab"]) {
    if (Object.hasOwn(rest, key)) throw new TypeError("DetailsView: chrome and arbitrary children belong to the frame, not this View.");
  }
  if (!empty || typeof empty !== "object" || empty.title === undefined) throw new TypeError("DetailsView: an explicit empty state is required.");
  if (layout !== "main-aside" && layout !== "single") throw new TypeError("DetailsView: layout must be main-aside or single.");
  if (tabs !== undefined) {
    if (!Array.isArray(tabs) || tabs.length === 0 || sections !== undefined) throw new TypeError("DetailsView: tabs require their own section lists.");
    if (typeof onTabChange !== "function") throw new TypeError("DetailsView: tabs require onTabChange.");
    if (!text(tabsLabel)) throw new TypeError("DetailsView: tabs require tabsLabel.");
    const ids = new Set<string>();
    for (const entry of tabs) {
      if (!entry || !text(entry.id) || !text(entry.label) || ids.has(entry.id)) throw new TypeError("DetailsView: tabs require unique nonempty ids and labels.");
      ids.add(entry.id); assertSections(entry.sections);
    }
    if (!text(tab) || !ids.has(tab)) throw new TypeError("DetailsView: tab must name one of the supplied tabs.");
  } else {
    if (tab !== undefined || onTabChange !== undefined || tabsLabel !== undefined) throw new TypeError("DetailsView: tab controls require tabs.");
    assertSections(sections!);
  }
  return (
    <div {...rest} className={mergeUiClasses("flex min-w-0 flex-col gap-xl", className)}>
      {banner}
      {tabs === undefined ? sectionLayout(sections!, empty, layout) : (
        <Tabs selectedKey={tab} onSelectionChange={key => onTabChange!(String(key))}>
          <Tabs.List aria-label={tabsLabel}>{tabs.map(entry => <Tabs.Tab key={entry.id} id={entry.id}>{entry.label}</Tabs.Tab>)}</Tabs.List>
          {tabs.map(entry => <Tabs.Panel key={entry.id} id={entry.id}>{sectionLayout(entry.sections, empty, layout)}</Tabs.Panel>)}
        </Tabs>
      )}
    </div>
  );
}
