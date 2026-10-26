/**
 * Preview-only renderers for planned Sections and Frames defaults (planSurfaceDefaults).
 *
 * A planned leaf is not adopted: it has no surface source bundle, no runtime
 * closure and no conformance evidence. This module renders the real Foundry
 * package export a plan row points at, filled with fixed sample content, so a
 * Studio board can show what the planned default looks like. It never adds a
 * leaf to the profile, the runtime manifest or the chosen count, and it records
 * every planned leaf it cannot render with the reason instead of inventing one.
 */
import type { ReactNode } from "react";
import type { SurfaceDefaultCandidateDocument, SurfaceDefaultsPlan } from "../catalog-core/surface-defaults.js";
import { AccessMatrix } from "../blocks/AccessMatrix.js";
import { accessMatrixSample } from "../blocks/access-matrix/sample.js";
import { ArticleBody } from "../blocks/ArticleBody.js";
import { ColumnMapper } from "../blocks/ColumnMapper.js";
import { columnMapperSample } from "../blocks/column-mapper/sample.js";
import { DetailView } from "../blocks/DetailView.js";
import { EmptyState } from "../blocks/EmptyState.js";
import { FilterBuilder } from "../blocks/FilterBuilder.js";
import { filterBuilderSample } from "../blocks/filter-builder/sample.js";
import { FormWizard } from "../blocks/FormWizard.js";
import { formWizardSample } from "../blocks/form-wizard/sample.js";
import { SettingsSection } from "../blocks/SettingsSection.js";
import { settingsSectionSample } from "../blocks/settings-section/sample.js";
import { InspectorFrame } from "../frames/InspectorFrame.js";
import { Faq } from "../blocks/Faq.js";
import { FeatureGrid } from "../blocks/FeatureGrid.js";
import { LogoCloud } from "../blocks/LogoCloud.js";
import { MediaFigure } from "../blocks/MediaFigure.js";
import { NavGrid } from "../blocks/NavGrid.js";
import { OrderedStepSequence } from "../blocks/OrderedStepSequence.js";
import { PageHeader } from "../blocks/PageHeader.js";
import { Pagination } from "../blocks/Pagination.js";
import { PeopleGrid } from "../blocks/PeopleGrid.js";
import { SectionFrame } from "../blocks/SectionFrame.js";
import { SectionHeader } from "../blocks/SectionHeader.js";
import { TableOfContents } from "../blocks/TableOfContents.js";
import { TestimonialSet } from "../blocks/TestimonialSet.js";
import { PageBar } from "../blocks/PageBar.js";
import { SiteHeader } from "../shell/SiteHeader.js";
import { SiteFooter } from "../shell/SiteFooter.js";

/** This designer build renders only its own package exports. Another package's export (for example a Publisher frame) is reported, not imitated. */
const DESIGNER_PACKAGE = "@clossys/designer/";
const BLOCKS = "@clossys/designer/blocks#", SHELL = "@clossys/designer/shell/server#", FRAMES = "@clossys/designer/frames#";

const noop = () => {};

/** Fixed sample content per package export pointer (module#export); absent pointers are unrenderable. */
const BLOCK_SAMPLES: Readonly<Record<string, () => ReactNode>> = {
  AccessMatrix: () => <AccessMatrix {...accessMatrixSample} />,
  ArticleBody: () => <ArticleBody><h2>Getting started</h2><p>Set up a workspace, invite your team and publish the first page.</p></ArticleBody>,
  ColumnMapper: () => <ColumnMapper {...columnMapperSample} />,
  DetailView: () => <DetailView title="Order 1042" fields={[{ label: "Customer", value: "Northwind" }, { label: "Status", value: "Shipped" }, { label: "Total", value: "$1,280.00" }, { label: "Placed", value: "12 March 2026" }]} />,
  EmptyState: () => <EmptyState title="No projects yet" description="Create a project to start collecting work in one place." />,
  Faq: () => <Faq heading="Questions" items={[{ id: "billing", question: "How does billing work?", answer: "You are billed monthly for the seats in use." }, { id: "cancel", question: "Can I cancel at any time?", answer: "Yes. Your workspace stays readable after cancelling." }]} />,
  FilterBuilder: () => <FilterBuilder {...filterBuilderSample} />,
  FormWizard: () => <FormWizard {...formWizardSample} />,
  SettingsSection: () => <SettingsSection {...settingsSectionSample} />,
  FeatureGrid: () => <FeatureGrid heading="Why teams switch" items={[{ id: "fast", heading: "Fast setup", description: "Start from a working default in minutes." }, { id: "safe", heading: "Safe changes", description: "Every change is checked before it ships." }, { id: "shared", heading: "Shared library", description: "One source of truth for every product." }]} />,
  LogoCloud: () => <LogoCloud items={["Northwind", "Contoso", "Fabrikam"].map(name => ({ id: name.toLowerCase(), name, logo: <span>{name}</span> }))} />,
  MediaFigure: () => <MediaFigure caption="The workspace overview"><svg role="img" aria-label="Workspace overview" viewBox="0 0 16 9" width="100%"><rect width="16" height="9" fill="currentColor" opacity="0.12" /></svg></MediaFigure>,
  NavGrid: () => <NavGrid heading="Explore" items={[{ id: "guides", title: "Guides", description: "Step-by-step walkthroughs.", href: "#guides" }, { id: "reference", title: "Reference", description: "Every option, in one place.", href: "#reference" }]} />,
  OrderedStepSequence: () => <OrderedStepSequence heading="How it works" items={[{ id: "connect", ordinal: 1, heading: "Connect", description: "Link your data source." }, { id: "review", ordinal: 2, heading: "Review", description: "Check what will change." }, { id: "publish", ordinal: 3, heading: "Publish", description: "Ship it to your audience." }]} />,
  PageHeader: () => <PageHeader title="Projects" description="Everything your team is working on." />,
  Pagination: () => <Pagination page={2} pageCount={8} onPageChange={noop} />,
  PeopleGrid: () => <PeopleGrid people={[{ id: "ada", name: "Ada Park", role: "Design lead", initials: "AP" }, { id: "sam", name: "Sam Ortiz", role: "Engineering", initials: "SO" }, { id: "lee", name: "Lee Chen", role: "Operations", initials: "LC" }]} columns={3} />,
  SectionFrame: () => <SectionFrame ground="sunken" measure="content"><p>A full-width band that holds one section.</p></SectionFrame>,
  SectionHeader: () => <SectionHeader eyebrow="Overview" title="Plan your launch" description="The pieces you need, in the order you need them." />,
  TableOfContents: () => <TableOfContents label="On this page" presentation="inline" trackCurrent={false} items={[{ id: "intro", label: "Introduction" }, { id: "setup", label: "Setup" }, { id: "options", label: "Options", level: 3 }]} />,
  TestimonialSet: () => <TestimonialSet items={[{ id: "one", quote: "We shipped our redesign in a week.", attributorName: "Ada Park", attributorRole: "Design lead" }, { id: "two", quote: "Reviews take minutes, not days.", attributorName: "Sam Ortiz", attributorRole: "Engineering" }]} />,
  PageBar: () => <PageBar position="static" root={{ label: "Workspace" }} labels={{ breadcrumb: "Breadcrumb", collapsedBreadcrumb: "More pages", pageInfo: "Page details", pageActions: "Page actions" }} />,
};
const SHELL_SAMPLES: Readonly<Record<string, () => ReactNode>> = {
  SiteHeader: () => <SiteHeader position="static" brand={<span>Northwind</span>} nav={<a href="#product">Product</a>} />,
  SiteFooter: () => <SiteFooter secondary={<p>Northwind, sample footer</p>} />,
};
const FRAME_SAMPLES: Readonly<Record<string, () => ReactNode>> = {
  InspectorFrame: () => <InspectorFrame label="Details" handleLabel="Resize details" closeLabel="Close details" openLabel="Show details" min={220} max={420} defaultValue={280}><p>Selected: Hero heading</p></InspectorFrame>,
};
const SAMPLES: Readonly<Record<string, () => ReactNode>> = {
  ...Object.fromEntries(Object.entries(BLOCK_SAMPLES).map(([name, sample]) => [BLOCKS + name, sample])),
  ...Object.fromEntries(Object.entries(SHELL_SAMPLES).map(([name, sample]) => [SHELL + name, sample])),
  ...Object.fromEntries(Object.entries(FRAME_SAMPLES).map(([name, sample]) => [FRAMES + name, sample])),
};

export interface PlannedSurfacePreview {
  slot: string;
  source: string;
  fill: string;
  /** The package export the planned fill points at, e.g. "@clossys/designer/blocks#Faq". */
  pointer: string;
  /** Renders the real export with fixed sample content. Preview only: not adoption, not conformance evidence. */
  render(): ReactNode;
}
export interface PlannedSurfacePreviewGap { slot: string; reason: string }
export interface PlannedSurfacePreviews {
  /** Planned leaves (chosen or default plan rows) that have a preview, by leaf id. */
  previews: Readonly<Record<string, PlannedSurfacePreview>>;
  /** Planned leaves without a preview, with the reason. */
  unrenderable: readonly PlannedSurfacePreviewGap[];
}
export interface PlannedSurfacePreviewsInput {
  plan: Pick<SurfaceDefaultsPlan, "rows">;
  /** The candidate documents the plan was made from (importFoundrySections().fills, importFoundryFrames().fills). */
  fills: readonly SurfaceDefaultCandidateDocument[];
}

type PackageImpl = { kind?: unknown; module?: unknown; export?: unknown };

/** Preview producers for every planned row; not-chosen rows are ignored. */
export function planSurfacePreviews(input: PlannedSurfacePreviewsInput): PlannedSurfacePreviews {
  const previews: Record<string, PlannedSurfacePreview> = {};
  const unrenderable: PlannedSurfacePreviewGap[] = [];
  for (const row of input.plan.rows) {
    if (row.status === "not-chosen" || !row.fill || !row.source) continue;
    const doc = input.fills.find(candidate => candidate.$extensions["com.clossys.fill"].id === row.fill && candidate.$extensions["com.clossys.fill"].slot === row.slot);
    if (!doc) { unrenderable.push({ slot: row.slot, reason: `planned fill ${row.fill} is not among the candidate documents` }); continue; }
    const entries = Object.values({ ...doc.sections, ...doc.frames });
    const impl = (entries.length === 1 ? (entries[0] as { impl?: PackageImpl }).impl : undefined) ?? {};
    if (impl.kind !== "package" || typeof impl.module !== "string" || typeof impl.export !== "string") { unrenderable.push({ slot: row.slot, reason: "planned fill has no package export pointer" }); continue; }
    const pointer = `${impl.module}#${impl.export}`;
    if (!impl.module.startsWith(DESIGNER_PACKAGE)) { unrenderable.push({ slot: row.slot, reason: `${pointer} is not a designer export; the designer does not render it` }); continue; }
    const sample = SAMPLES[pointer];
    if (!sample) { unrenderable.push({ slot: row.slot, reason: `no preview sample content for ${pointer}` }); continue; }
    previews[row.slot] = { slot: row.slot, source: row.source, fill: row.fill, pointer, render: sample };
  }
  return { previews, unrenderable };
}
