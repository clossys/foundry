import { copyPortsFor } from "./specimen-section-hosts.js";
import { HERO_PREVIEW_MEMBERS } from "./hero-specimen.js";
/**
 * Preview-only renderers for planned Sections and Frames defaults (planSurfaceDefaults).
 *
 * A planned leaf is not adopted: it has no surface source bundle, no runtime
 * closure and no conformance evidence. This module renders the real Foundry
 * package export a plan row points at, filled with fixed sample content, so a
 * Studio board can show what the planned default looks like. It never adds a
 * leaf to the profile, the runtime manifest or the chosen count, and it records
 * every planned leaf it cannot render with the reason instead of inventing one.
 * An adopted package-pointer leaf owns no source to render, so the Studio
 * previews it through the same pointer-to-sample resolution. A leaf with a
 * package runtime renderer (runtime/index.ts) previews through that renderer
 * and the specimen dataset; the fixed samples below cover the rest.
 */
import type { ReactNode } from "react";
import type { SurfaceDefaultCandidateDocument, SurfaceDefaultsPlan } from "../catalog-core/surface-defaults.js";
import { stableStringify } from "../catalog-core/stable.js";
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { AccessMatrix } from "../blocks/AccessMatrix.js";
import { ActivityFeed } from "../blocks/ActivityFeed.js";
import { AuditLog } from "../blocks/AuditLog.js";
import { Timeline } from "../blocks/Timeline.js";
import { UsageSummary } from "../blocks/UsageSummary.js";
import { ArticleBody } from "../blocks/ArticleBody.js";
import { ColumnMapper } from "../blocks/ColumnMapper.js";
import { DetailView } from "../blocks/DetailView.js";
import { EmptyState } from "../blocks/EmptyState.js";
import { FilterBuilder } from "../blocks/FilterBuilder.js";
import { FormWizard } from "../blocks/FormWizard.js";
import { SettingsSection } from "../blocks/SettingsSection.js";
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
import { CallToAction } from "../blocks/CallToAction.js";
import { RecordCards } from "../blocks/RecordCards.js";
import { ConsentBanner } from "../blocks/ConsentBanner.js";
import { ErrorState } from "../blocks/ErrorState.js";
import { Gallery } from "../blocks/Gallery.js";
import { NoticeList } from "../blocks/NoticeList.js";
import { StatGroup } from "../blocks/StatGroup.js";
import { Button } from "../components/Button.js";
import { Link } from "../components/Link.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { SiteHeader } from "../shell/SiteHeader.js";
import { SiteFooter } from "../shell/SiteFooter.js";
import { RatioFixture } from "./ratio-fixture.js";
import { specimenDataset } from "./specimen-dataset.js";
import { APP_SIDEBAR_SAMPLES, STRUCTURED_BLOCK_SAMPLES, STRUCTURED_BLOCK_STATE_SAMPLES, STRUCTURED_FRAME_SAMPLES, type SurfaceStateSamples } from "./surface-preview-samples.js";
import { SURFACE_SAMPLE_STATES, type SurfaceSampleState } from "./surface-preview-sample-content.js";
import { surfaceRuntimeRenderers } from "../runtime/index.js";
import { surfaceRuntimePreview, type SurfacePreviewEntry } from "../runtime/preview.js";

export { SURFACE_SAMPLE_STATES, type SurfaceSampleState };

/** This designer build renders only its own package exports. Another package's export (for example a Publisher frame) is reported, not imitated. */
const DESIGNER_PACKAGE = "@clossys/designer/";
const BLOCKS = "@clossys/designer/blocks#", SHELL = "@clossys/designer/shell/server#", FRAMES = "@clossys/designer/frames#";

const noop = () => {};

const { sections: S, frames: F } = specimenDataset;
/** A media placeholder: the dataset's generated fixture image, labelled, cropped to the frame the block gives it. */
const media = (label: string): ReactNode => <SemanticContent as="span" role="img" aria-label={label} className="block aspect-video overflow-hidden"><RatioFixture /></SemanticContent>;

/** Sample content per package export pointer (module#export), all drawn from the shared dataset; absent pointers are unrenderable. */
const BLOCK_SAMPLES: Readonly<Record<string, () => ReactNode>> = {
  AccessMatrix: () => <AccessMatrix {...S.accessMatrix} />,
  ActivityFeed: () => <ActivityFeed {...S.activityFeed} />,
  AuditLog: () => <AuditLog {...S.auditLog} />,
  Timeline: () => <Timeline {...S.timeline} />,
  UsageSummary: () => <UsageSummary {...S.usageSummary} />,
  ArticleBody: () => <ArticleBody><SemanticContent as="h2">{S.articleBody.heading}</SemanticContent><SemanticContent as="p">{S.articleBody.body}</SemanticContent></ArticleBody>,
  ColumnMapper: () => <ColumnMapper {...S.columnMapper} />,
  DetailView: () => <DetailView {...S.detailView} />,
  EmptyState: () => <EmptyState {...S.emptyState} />,
  Faq: () => <Faq {...S.faq} />,
  FilterBuilder: () => <FilterBuilder {...S.filterBuilder} />,
  FormWizard: () => <FormWizard {...S.formWizard} />,
  SettingsSection: () => <SettingsSection {...S.settingsSection} />,
  FeatureGrid: () => <FeatureGrid {...S.featureGrid} />,
  LogoCloud: () => <LogoCloud items={S.logoCloud.names.map(name => ({ id: name.toLowerCase(), name, logo: <SemanticContent as="span">{name}</SemanticContent> }))} />,
  MediaFigure: () => <MediaFigure caption={S.mediaFigure.caption}>{media(S.mediaFigure.label)}</MediaFigure>,
  NavGrid: () => <NavGrid {...S.navGrid} />,
  OrderedStepSequence: () => <OrderedStepSequence {...S.orderedSteps} />,
  PageHeader: () => <PageHeader {...S.pageHeader} />,
  Pagination: () => <Pagination {...S.pagination} onPageChange={noop} />,
  PeopleGrid: () => <PeopleGrid {...S.peopleGrid} />,
  SectionFrame: () => <SectionFrame ground="sunken" measure="content"><SemanticContent as="p">{S.sectionFrame.body}</SemanticContent></SectionFrame>,
  SectionHeader: () => <SectionHeader {...S.sectionHeader} />,
  TableOfContents: () => <TableOfContents {...S.tableOfContents} presentation="inline" trackCurrent={false} />,
  TestimonialSet: () => <TestimonialSet {...S.testimonials} />,
  CallToAction: () => <CallToAction eyebrow={S.callToAction.eyebrow} title={S.callToAction.title} description={S.callToAction.description}
    primaryAction={<Link href={S.callToAction.primary.href} buttonVariant="primary">{S.callToAction.primary.label}</Link>}
    secondaryAction={<Link href={S.callToAction.secondary.href} buttonVariant="secondary">{S.callToAction.secondary.label}</Link>} />,
  RecordCards: () => <RecordCards {...S.recordCards} />,
  ConsentBanner: () => <ConsentBanner title={S.consentBanner.title} body={S.consentBanner.body} acceptLabel={S.consentBanner.acceptLabel} rejectLabel={S.consentBanner.rejectLabel} onAccept={noop} onReject={noop}
    privacyLink={<Link href={S.consentBanner.privacy.href}>{S.consentBanner.privacy.label}</Link>} />,
  ErrorState: () => <ErrorState kind="failure" code={S.errorState.code} title={S.errorState.title} description={S.errorState.description}
    retry={<Button variant="primary" size="md" onPress={noop}>{S.errorState.retryLabel}</Button>} report={<Link href={S.errorState.report.href}>{S.errorState.report.label}</Link>} />,
  Gallery: () => <Gallery label={S.gallery.label} images={S.gallery.images.map(image => ({ ...image, media: media(image.label) }))} />,
  NoticeList: () => <NoticeList label={S.noticeList.label} onDismiss={noop}
    notices={S.noticeList.notices.map(({ action, ...notice }) => ({ ...notice, action: action ? <Link href={action.href}>{action.label}</Link> : undefined }))} />,
  StatGroup: () => <StatGroup {...S.statGroup} />,
  PageBar: () => <PageBar position="static" {...S.pageBar} />,
  ...STRUCTURED_BLOCK_SAMPLES,
  ...APP_SIDEBAR_SAMPLES,
};
/** vf35: block exports' own non-default sample states, by export name (see surface-preview-samples.tsx). */
const BLOCK_STATE_SAMPLES: SurfaceStateSamples = {
  ActivityFeed: { empty: () => <ActivityFeed {...S.activityFeed} events={[]} groups={[]} /> },
  AuditLog: {
    empty: () => <AuditLog {...S.auditLog} entries={[]} />,
    loading: () => <AuditLog {...S.auditLog} isLoading />,
  },
  ...STRUCTURED_BLOCK_STATE_SAMPLES,
};
const SHELL_SAMPLES: Readonly<Record<string, () => ReactNode>> = {
  SiteHeader: () => <SiteHeader position="static" brand={<SemanticContent as="span">{F.siteHeader.brand}</SemanticContent>} nav={<Link href={F.siteHeader.nav.href}>{F.siteHeader.nav.label}</Link>} />,
  SiteFooter: () => <SiteFooter secondary={<SemanticContent as="p">{F.siteFooter.body}</SemanticContent>} />,
};
const FRAME_SAMPLES: Readonly<Record<string, () => ReactNode>> = {
  InspectorFrame: () => {
    const { body, ...inspector } = F.inspector;
    return <InspectorFrame {...inspector}><SemanticContent as="p">{body}</SemanticContent></InspectorFrame>;
  },
  ...STRUCTURED_FRAME_SAMPLES,
};
const SAMPLES: Readonly<Record<string, () => ReactNode>> = {
  ...Object.fromEntries(Object.entries(BLOCK_SAMPLES).map(([name, sample]) => [BLOCKS + name, sample])),
  ...Object.fromEntries(Object.entries(SHELL_SAMPLES).map(([name, sample]) => [SHELL + name, sample])),
  ...Object.fromEntries(Object.entries(FRAME_SAMPLES).map(([name, sample]) => [FRAMES + name, sample])),
};
const STATE_SAMPLES: SurfaceStateSamples = Object.fromEntries(Object.entries(BLOCK_STATE_SAMPLES).map(([name, states]) => [BLOCKS + name, states]));

export interface PlannedSurfacePreview {
  slot: string;
  source: string;
  fill: string;
  /** The package export the planned fill points at, e.g. "@clossys/designer/blocks#Faq". */
  pointer: string;
  /** Renders the real export with fixed sample content. Preview only: not adoption, not conformance evidence. */
  render(): ReactNode;
  /** The sample state `render` draws: the requested one when the export supports it, otherwise `default` (also when absent). */
  state?: SurfaceSampleState;
}
export interface PlannedSurfacePreviewGap { slot: string; reason: string }
export interface PlannedSurfacePreviews {
  /** Planned leaves (chosen or default plan rows) that have a preview, by leaf id. */
  previews: Readonly<Record<string, PlannedSurfacePreview>>;
  /** Planned leaves without a preview, with the reason. */
  unrenderable: readonly PlannedSurfacePreviewGap[];
  /** The sample state the host asked for; adopted package previews on the board use the same one. Absent means `default`. */
  sampleState?: SurfaceSampleState;
}
/** Sample renderers keyed by package export pointer (`module#export`). */
export type SurfacePreviewSamples = Readonly<Record<string, () => ReactNode>>;
export interface PlannedSurfacePreviewsInput {
  plan: Pick<SurfaceDefaultsPlan, "rows">;
  /** The candidate documents the plan was made from (importFoundrySections().fills, importFoundryFrames().fills). */
  fills: readonly SurfaceDefaultCandidateDocument[];
  /**
   * Host-owned samples for exports this designer build cannot render, by exact pointer (for example the
   * Publisher site frame). The host renders its own real export; the designer never imitates one.
   */
  samples?: SurfacePreviewSamples;
  /**
   * The sample state to draw every preview in (vf35), for a capture harness or a host's own state review.
   * An export without that state, and every host-owned sample, keeps its default sample.
   * @default "default"
   */
  sampleState?: SurfaceSampleState;
}

type PackageImpl = { kind?: unknown; module?: unknown; export?: unknown };
type SurfacePointerDocument = Pick<SurfaceDefaultCandidateDocument, "sections" | "frames">;
const runtimeMapping = (entry: unknown): string => {
  const row = entry as Record<string, unknown>;
  return stableStringify(Object.fromEntries(["impl", "slotMap", "slots", "propMap", "members", "configs", "statePorts"].map(key => [key, row[key]])));
};
// The existing package importers remain the mapping authority. This index contains no separate choices or registry.
const packageRuntimeMappings = new Map([...importFoundrySections().fills, ...importFoundryFrames().fills].map(doc => {
  const entry = Object.values({ ...("sections" in doc ? doc.sections : {}), ...("frames" in doc ? doc.frames : {}) })[0]!;
  return [entry.slot, runtimeMapping(entry)] as const;
}));

/**
 * The preview for one package-pointer surface document, planned or adopted: the real export its single entry
 * points at, rendered with sample content, or the reason there is none. Host samples cover non-designer exports.
 */
export function packageSurfacePreview(doc: SurfacePointerDocument, samples: SurfacePreviewSamples = {}, state: SurfaceSampleState = "default"): { pointer: string; render(): ReactNode; state: SurfaceSampleState } | { reason: string } {
  const entries = Object.values({ ...doc.sections, ...doc.frames });
  const impl = (entries.length === 1 ? (entries[0] as { impl?: PackageImpl }).impl : undefined) ?? {};
  if (impl.kind !== "package" || typeof impl.module !== "string" || typeof impl.export !== "string") return { reason: "planned fill has no package export pointer" };
  const pointer = `${impl.module}#${impl.export}`;
  const hosted = Object.hasOwn(samples, pointer) ? samples[pointer] : undefined;
  if (hosted) return { pointer, render: hosted, state: "default" };
  if (!impl.module.startsWith(DESIGNER_PACKAGE)) return { reason: `${pointer} is not a designer export; the designer does not render it` };
  const leaf = (entries[0] as SurfacePreviewEntry).slot;
  const canonical = typeof leaf === "string" ? packageRuntimeMappings.get(leaf) : undefined;
  // Dispatch by leaf is valid only for the precise package pointer and mapping the renderer implements.
  // Consumer provenance stamps do not affect the rendered implementation; altered targets do.
  try {
    if (canonical === undefined || runtimeMapping(entries[0]) !== canonical) return { reason: `${pointer} mapping does not match the package runtime for ${typeof leaf === "string" ? leaf : "this fill"}` };
  } catch { return { reason: `${pointer} has an unsupported runtime mapping` }; }
  const stated = state === "default" || !Object.hasOwn(STATE_SAMPLES, pointer) ? undefined : STATE_SAMPLES[pointer]![state];
  // A leaf with a package runtime renderer previews through it, from the specimen dataset: the same renderer
  // the consumer runtime draws. Only an export's own non-default state samples still render beside it.
  if (!stated && typeof leaf === "string" && Object.hasOwn(surfaceRuntimeRenderers, leaf)) {
    const runtime = surfaceRuntimePreview(entries[0] as SurfacePreviewEntry, { sectionHost: copyPortsFor(leaf), ...(leaf === "sections.hero" ? { members: HERO_PREVIEW_MEMBERS } : leaf === "sections.features" ? { members: ["layout.bento"] } : {}) });
    return "reason" in runtime ? runtime : { pointer, render: runtime.render, state: "default" };
  }
  const sample = Object.hasOwn(SAMPLES, pointer) ? SAMPLES[pointer] : undefined;
  if (!sample) return { reason: `no preview sample content for ${pointer}` };
  return stated ? { pointer, render: stated, state } : { pointer, render: sample, state: "default" };
}

/** Preview producers for every planned row; not-chosen rows are ignored. */
export function planSurfacePreviews(input: PlannedSurfacePreviewsInput): PlannedSurfacePreviews {
  const previews: Record<string, PlannedSurfacePreview> = {};
  const unrenderable: PlannedSurfacePreviewGap[] = [];
  for (const row of input.plan.rows) {
    if (row.status === "not-chosen" || !row.fill || !row.source) continue;
    const doc = input.fills.find(candidate => candidate.$extensions["com.clossys.fill"].id === row.fill && candidate.$extensions["com.clossys.fill"].slot === row.slot);
    if (!doc) { unrenderable.push({ slot: row.slot, reason: `planned fill ${row.fill} is not among the candidate documents` }); continue; }
    const preview = packageSurfacePreview(doc, input.samples, input.sampleState);
    if ("reason" in preview) { unrenderable.push({ slot: row.slot, reason: preview.reason }); continue; }
    previews[row.slot] = { slot: row.slot, source: row.source, fill: row.fill, pointer: preview.pointer, render: preview.render, state: preview.state };
  }
  return { previews, unrenderable, sampleState: input.sampleState ?? "default" };
}
