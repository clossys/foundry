/** Compiled public contract assertions; this file is not a runtime test. */
import { DetailsView, type DetailsViewBlock, type DetailsViewLayout, type DetailsViewProps, type DetailsViewSection, type DetailsViewSectionState } from "./DetailsView.js";

const section: DetailsViewSection = { id: "identity", title: "Identity", block: { kind: "detail", props: { fields: [{ label: "Identifier", value: "one" }] } } };
const common = { title: "Record one", subtitle: "Record details.", index: { href: "/records", label: "Records" }, empty: { title: "No sections" } };
export const plain = <DetailsView {...common} sections={[section]} />;
export const withBanner = <DetailsView {...common} sections={[section]} layout="main-aside" banner={null} actions={null} />;
export const tabbed = <DetailsView {...common} tabsLabel="Record sections" tabs={[{ id: "overview", label: "Overview", sections: [section] }]} tab="overview" onTabChange={id => { void id; }} />;
export const panel: DetailsViewBlock = { kind: "panel", props: { children: "Summary" } };
export const narrow: DetailsViewSection = { ...section, region: "aside", state: { kind: "loading", label: "Loading identity" } };
export const single: DetailsViewLayout = "single";
export const emptyState: DetailsViewSectionState = { kind: "empty", props: { title: "No details" } };
export const errorState: DetailsViewSectionState = { kind: "error", props: { children: "Details could not load." } };
// @ts-expect-error raw markup is not a typed Block entry
export const rawBlock: DetailsViewBlock = <div />;
// @ts-expect-error arbitrary block identifiers are outside the catalog
export const unknownBlock: DetailsViewBlock = { kind: "raw", props: { children: "Summary" } };
// @ts-expect-error PageHeader is page-owned and cannot be another section
export const secondPageHeader: DetailsViewBlock = { kind: "page-header", props: { title: "Other page" } };
// @ts-expect-error tab selection is controlled and must include a selection
export const uncontrolled = <DetailsView {...common} tabsLabel="Record sections" tabs={[]} onTabChange={() => {}} />;
// @ts-expect-error tab selection must report changes
export const silentTabs = <DetailsView {...common} tabsLabel="Record sections" tabs={[]} tab="overview" />;
// @ts-expect-error sections belong either to tabs or to the untabbed View
export const outsideTabs = <DetailsView {...common} sections={[section]} tabsLabel="Record sections" tabs={[]} tab="overview" onTabChange={() => {}} />;
// @ts-expect-error DetailsView requires its breadcrumb back to the Index
export const noIndex = <DetailsView title="Record one" empty={{ title: "No sections" }} sections={[]} />;
// @ts-expect-error DetailsView cannot own frame chrome
export const ownChrome = <DetailsView {...common} sections={[]} nav={<nav />} />;
// @ts-expect-error arbitrary page children bypass the Block composition
export const rawChildren = <DetailsView {...common} sections={[]}><div /></DetailsView>;
// @ts-expect-error one normalized layout has no left-panel layout
export const leftLayout: DetailsViewLayout = "left";
// @ts-expect-error a section cannot own a bottom work panel
export const bottomRegion: DetailsViewSection = { ...section, region: "bottom" };
// @ts-expect-error loading needs a localized accessible label
export const unnamedLoading: DetailsViewSectionState = { kind: "loading" };
// @ts-expect-error each empty section requires its own EmptyState copy
export const unnamedEmpty: DetailsViewSectionState = { kind: "empty", props: {} };
// @ts-expect-error each error section requires its own Banner message
export const unnamedError: DetailsViewSectionState = { kind: "error", props: {} };
// @ts-expect-error error severity is fixed by DetailsView
export const infoError: DetailsViewSectionState = { kind: "error", props: { variant: "info", children: "Error" } };
// @ts-expect-error frame panels are outside the View contract
export const leftPanel = <DetailsView {...common} sections={[]} leftPanel={<div />} />;
// @ts-expect-error frame panels are outside the View contract
export const bottomPanel = <DetailsView {...common} sections={[]} bottomPanel={<div />} />;
// @ts-expect-error regions belong to sections, not an independent side-column API
export const separateSideColumn = <DetailsView {...common} sections={[]} sideColumn={{ label: "Summary", sections: [] }} />;
// @ts-expect-error the URL-driven selected tab is named tab
export const oldTab = <DetailsView {...common} tabs={[]} tabsLabel="Record sections" selectedTab="overview" onTabChange={() => {}} />;

export type DetailsEntryParity = [
  import("./index.js").DetailsViewProps,
  import("../index.js").DetailsViewProps,
  import("../client.js").DetailsViewProps,
  import("../server.js").DetailsViewProps,
];
export const props: DetailsViewProps = { ...common, sections: [section] };
