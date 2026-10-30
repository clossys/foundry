import { BLOCK_DISPLAY_TREE, blockPlacement } from "./display.js";
import sectionHomes from "./maps/blocks-to-sections.json" with { type: "json" };
import legalProseFill from "./fills/foundry/sections.legal-prose.json" with { type: "json" };
import sectionSlots from "./slots/sections.json" with { type: "json" };
import type {
  BlockContract,
  BlockEntry,
  BlockId,
  Catalog,
  WorkRef,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const legalProse = legalProseFill.sections["legal-prose"];
const legalProseMetadata = legalProseFill.$extensions["com.clossys.fill"];
const legalProseSource = legalProse.consumption.sourceFiles.find(file =>
  file.path === `packages/designer/src/blocks/${legalProse.impl.export}.tsx`);
const legalProseSlot = sectionSlots.find(slot => slot.id === legalProseMetadata.slot);
if (legalProseMetadata.mode !== "implementation" || legalProseMetadata.slot !== legalProse.slot ||
    legalProseSlot?.contract.kind !== "section" || legalProse.impl.kind !== "package" ||
    legalProse.impl.module !== `${legalProseMetadata.pin.package}/blocks` ||
    legalProseMetadata.pin.export !== `./blocks#${legalProse.impl.export}` || !legalProseSource) {
  throw new Error("Legal prose requires its canonical section contract and own package implementation.");
}

/** Canonical sections exported by the blocks barrel without a legacy block address. */
export const CANONICAL_SECTION_BLOCK_REGISTRATIONS = [{
  id: legalProseMetadata.slot,
  export: legalProse.impl.export,
  source: legalProseSource.path.replace(/^packages\/designer\//, ""),
}] as const;

const pr = (number: number, state: "draft" | "ready"): WorkRef => ({ kind: "pull-request", number, state });

interface Leaf {
  readonly id: BlockId;
  readonly label: string;
  readonly notes?: readonly string[];
  readonly stableCandidate?: boolean;
  readonly contract?: BlockContract;
  readonly inFlight?: WorkRef;
}

const draft = { lifecycle: "draft", signedOff: false, ownerReview: "not-yet-reviewed" } as const;

const STABLE_CANDIDATE = "Stable candidate: promotion to stable needs owner sign-off against its exact specimen.";
const VENDOR_LAG = "Exported here; the consumer's vendored copy still lists it as a spec (unverified per block).";
const IN_FLIGHT = "Not built yet: its open pull request builds it.";
const WAITING =
  "Not built. Waits until a named consumer renders a placeholder or hand-rolls the pattern, or the owner names it.";

/** Exported on the default branch and vendored by the consumer. */
const built = (exportName: string, { stableCandidate = false, ...leaf }: Leaf): BlockEntry => ({
  ...leaf,
  ...blockPlacement(leaf.id),
  ...draft,
  export: exportName,
  built: "yes",
  stableCandidate,
});

/** Exported on the default branch; the consumer's vendored copy has not caught up. */
const exported = (exportName: string, leaf: Leaf): BlockEntry => ({
  ...leaf,
  ...blockPlacement(leaf.id),
  ...draft,
  export: exportName,
  built: "exported",
  stableCandidate: false,
  notes: [VENDOR_LAG, ...(leaf.notes ?? [])],
});

/** Built as a configuration of another leaf's export; no export of its own. */
const recipe = (of: BlockId, leaf: Leaf): BlockEntry => ({
  ...leaf,
  ...blockPlacement(leaf.id),
  ...draft,
  export: null,
  built: "yes",
  recipeOf: of,
  stableCandidate: false,
});

/** Still exported so existing references resolve; new work uses the successor. */
const deprecated = (exportName: string, successor: BlockId, leaf: Leaf): BlockEntry => ({
  ...leaf,
  ...blockPlacement(leaf.id),
  lifecycle: "deprecated",
  successor,
  signedOff: false,
  ownerReview: "not-yet-reviewed",
  export: exportName,
  built: "yes",
  stableCandidate: false,
});

/** A registered draft spec row: not built, zero configs. */
const spec = (leaf: Leaf): BlockEntry => ({
  ...leaf,
  ...blockPlacement(leaf.id),
  ...draft,
  export: null,
  built: "no",
  stableCandidate: false,
  notes: [leaf.inFlight?.kind === "pull-request" ? IN_FLIGHT : WAITING, ...(leaf.notes ?? [])],
});

const PAGE_HEADER_CONTRACT: BlockContract = {
  requiredFields: ["title"],
  axes: [],
  slots: ["description", "actions", "breadcrumb"],
  configs: [],
  surface: "both",
  specimen: null,
  alsoUsedFor: [],
};

// ---------------------------------------------------------------------------
// Leaves: shared inventory below; catalog.coverage.test.ts reports counts (repository test, not shipped).
// ---------------------------------------------------------------------------

// Explicit legacy addresses; membership is verified against the section registry and retired aliases.
const sectionLeafByBlock: Readonly<Partial<Record<BlockId, NonNullable<BlockEntry["sectionLeaf"]>>>> =
  sectionHomes as Readonly<Partial<Record<BlockId, NonNullable<BlockEntry["sectionLeaf"]>>>>;

/** Block leaves, in display order. */
export const BLOCK_ENTRIES: readonly BlockEntry[] = [
  // Explain / Headings
  built("Hero", { id: "say.hero", label: "Hero" }),
  built("LogoHero", { id: "say.logo-hero", label: "Logo hero", contract: { requiredFields: ["mark", "name"], axes: [], slots: [], configs: [], surface: "marketing", specimen: null, alsoUsedFor: [] } }),
  built("PageHeader", {
    id: "say.page-header",
    label: "Page header",
    stableCandidate: true,
    contract: PAGE_HEADER_CONTRACT,
    notes: [STABLE_CANDIDATE],
  }),
  built("SectionHeader", { id: "say.section-header", label: "Section header" }),
  built("SectionIntro", { id: "say.section-intro", label: "Section intro" }),

  // Explain / Sections
  built("ContentSection", { id: "say.takeaway", label: "Content section" }),
  deprecated("MarketingChapter", "say.takeaway", { id: "say.chapter", label: "Marketing chapter" }),
  built("CallToAction", { id: "say.call-to-action", label: "Call to action" }),

  // Explain / Capabilities
  recipe("items.raw", { id: "items.features", label: "Feature list" }),
  recipe("items.raw", { id: "items.statement", label: "Statement row" }),
  deprecated("FeatureGrid", "items.features", { id: "items.feature-grid", label: "Feature grid" }),

  // Explain / Evidence
  built("Testimonial", { id: "say.testimonial", label: "Testimonial" }),
  exported("TestimonialSet", { id: "say.testimonial-set", label: "Testimonial set" }),
  exported("LogoCloud", { id: "items.logo-cloud", label: "Logo cloud" }),
  exported("PeopleGrid", { id: "items.people-grid", label: "People grid" }),

  // Explain / Media
  built("MediaFigure", { id: "say.media-figure", label: "Media figure" }),
  built("Gallery", { id: "items.media-gallery", label: "Media gallery" }),

  // Explain / Reading
  built("ArticleBody", {
    id: "prose.article",
    label: "Article body",
    stableCandidate: true,
    notes: [STABLE_CANDIDATE],
  }),
  recipe("items.raw", { id: "items.faq", label: "FAQ" }),
  deprecated("Faq", "items.faq", { id: "items.legacy-faq", label: "FAQ (legacy)" }),
  spec({ id: "say.info-tip", label: "Info tip" }),

  // Explain / Sequence
  recipe("items.raw", { id: "items.steps", label: "Steps" }),
  deprecated("OrderedStepSequence", "items.steps", {
    id: "items.ordered-step-sequence",
    label: "Ordered steps (legacy)",
  }),
  exported("Timeline", { id: "items.timeline", label: "Timeline" }),

  // Explain / Brand
  exported("Lockup", { id: "say.lockup", label: "Lockup" }),

  // Explain / Specimens
  recipe("items.raw", { id: "items.specimen-stack", label: "Specimen stack" }),
  built("Specimen", { id: "say.specimen", label: "Specimen" }),
  built("SpecimenPanel", { id: "matrix.specimen-panel", label: "Specimen panel" }),
  built("AnatomyCallouts", { id: "say.anatomy-callouts", label: "Anatomy callouts" }),
  built("Scene", { id: "matrix.scene", label: "Scene" }),

  // Organize / Collection
  built("Items", { id: "items.raw", label: "Items" }),
  built("Item", { id: "items.item", label: "Item" }),
  built("RecordCards", { id: "items.cards", label: "Card grid" }),
  exported("TaskList", { id: "items.task-list", label: "Task list" }),

  // Organize / Comparison
  built("Matrix", { id: "matrix.raw", label: "Matrix" }),
  recipe("matrix.raw", {
    id: "matrix.comparison",
    label: "Comparison table",
    inFlight: pr(2390, "draft"),
    notes: ["The open pull request adds plan and entitlement comparison configs."],
  }),

  // Organize / Offers
  built("PricingTable", {
    id: "matrix.pricing",
    label: "Pricing table",
    inFlight: pr(2390, "draft"),
    notes: ["The open pull request adds an interval config."],
  }),

  // Organize / Metrics
  built("Stat", { id: "items.stat", label: "Stat" }),
  built("StatGroup", { id: "items.stat-grid", label: "Stat grid" }),
  built("StatusList", { id: "items.status-list", label: "Status list" }),
  exported("UsageMeter", { id: "items.usage-meter", label: "Usage meter" }),
  exported("UsageSummary", { id: "items.usage-summary", label: "Usage summary", notes: ["A list of usage meter records."] }),

  // Organize / Records
  built("DataTable", { id: "matrix.data-table", label: "Data table" }),
  built("DetailView", { id: "matrix.detail", label: "Detail view" }),
  built("RecordLedger", { id: "items.record-ledger", label: "Record ledger" }),
  exported("GroupedTable", { id: "matrix.grouped-table", label: "Grouped table" }),
  exported("ResourceList", {
    id: "items.resource-list",
    label: "Resource list",
    notes: ["Built on the grid list component."],
  }),
  spec({ id: "matrix.data-grid", label: "Data grid" }),

  // Organize / Activity
  exported("EventItem", { id: "items.event-item", label: "Event item" }),
  exported("ActivityFeed", { id: "items.activity-feed", label: "Activity feed", notes: ["Built on the event item block."] }),
  exported("AuditLog", { id: "matrix.audit-log", label: "Audit log", notes: ["Built on the data table block."] }),

  // Organize / Containers
  built("Panel", { id: "matrix.panel", label: "Panel" }),
  built("Drawer", { id: "matrix.drawer", label: "Drawer" }),
  built("ResizablePane", {
    id: "matrix.resizable-pane",
    label: "Resizable pane",
    notes: ["Depends on the owner decision for the resize handle component: rebuilt with it, or parked with it."],
  }),
  exported("CatalogWorkspace", { id: "matrix.catalog-workspace", label: "Catalog workspace" }),
  exported("FlowCanvas", { id: "matrix.flow-canvas", label: "Flow canvas" }),
  exported("CatalogBrowser", { id: "matrix.catalog-browser", label: "Catalog browser" }),
  exported("CanvasSurface", { id: "matrix.canvas-surface", label: "Canvas surface" }),

  // Collect / Forms
  built("Form", { id: "form.form", label: "Form", stableCandidate: true, notes: [STABLE_CANDIDATE] }),
  exported("NewsletterBand", { id: "form.newsletter-band", label: "Newsletter band" }),
  exported("FormWizard", { id: "form.form-wizard", label: "Form wizard" }),

  // Collect / Fields
  built("FieldGroup", { id: "form.field-group", label: "Field group" }),
  spec({
    id: "form.file-field",
    label: "File field",
    inFlight: { kind: "issue", number: 2357 },
    notes: ["An open issue tracks it; no pull request yet."],
  }),

  // Collect / Import
  exported("ColumnMapper", { id: "form.column-mapper", label: "Column mapper" }),

  // Collect / Settings
  exported("SettingsSection", {
    id: "form.settings-section",
    label: "Settings section",
    notes: ["Its saveBar region hosts the save bar; form.save-bar stays a separate spec."],
  }),
  spec({
    id: "form.save-bar",
    label: "Save bar",
    notes: ["Check the admin routes for a consumer before building."],
  }),

  // Collect / Access
  exported("AccessMatrix", { id: "matrix.access-matrix", label: "Access matrix" }),

  // Collect / Conversation
  exported("Chat", { id: "form.chat", label: "Chat" }),

  // Navigate / Destinations
  recipe("items.raw", { id: "items.link-index", label: "Link index" }),
  recipe("items.raw", { id: "items.topics", label: "Topic list" }),
  built("NavGrid", { id: "items.nav-grid", label: "Nav grid" }),

  // Navigate / App navigation
  built("AppNavigation", { id: "items.app-navigation", label: "App navigation" }),
  built("AccountMenu", { id: "form.account-menu", label: "Account menu" }),
  built("CommandMenu", { id: "form.command-menu", label: "Command menu" }),
  exported("PageBar", {
    id: "items.page-bar",
    label: "Page bar",
    notes: ["Extracted from the app frame by merged pull request 2398."],
  }),

  // Navigate / Hierarchy
  exported("Tree", { id: "items.tree", label: "Tree" }),
  exported("Explorer", { id: "items.explorer", label: "Explorer" }),
  exported("RelationGraph", { id: "items.relation-graph", label: "Relation graph" }),

  // Navigate / In-page
  exported("TableOfContents", { id: "prose.table-of-contents", label: "Table of contents" }),

  // Navigate / Actions
  built("Toolbar", { id: "form.toolbar", label: "Toolbar" }),
  spec({ id: "form.bulk-action-bar", label: "Bulk action bar" }),

  // Navigate / Paging
  built("Pagination", { id: "form.pagination", label: "Pagination" }),
  spec({ id: "form.load-more", label: "Load more" }),

  // Navigate / Filtering
  exported("FilterBuilder", { id: "form.filter-builder", label: "Filter builder" }),

  // Respond / States
  built("EmptyState", {
    id: "say.empty-state",
    label: "Empty state",
    stableCandidate: true,
    notes: [STABLE_CANDIDATE],
  }),
  built("ErrorState", { id: "say.error-state", label: "Error state" }),

  // Respond / Decisions
  built("ConfirmDialog", { id: "form.confirm-dialog", label: "Confirm dialog" }),
  built("ConsentBanner", { id: "form.consent-banner", label: "Consent banner" }),

  // Respond / Notices
  built("NoticeList", { id: "say.notice-stack", label: "Notice stack" }),
  spec({ id: "form.refresh-status", label: "Refresh status" }),

  // Respond / Notifications
  spec({ id: "items.notification-center", label: "Notification center" }),
].map((block): BlockEntry => {
  const sectionLeaf = sectionLeafByBlock[block.id];
  return sectionLeaf === undefined ? block : { ...block, sectionLeaf };
});

const MODEL_API = "Data-model API for a block; not a component.";
const HOOK = "Hook paired with a block; not a component.";

/**
 * Runtime exports of the blocks entry that are not leaves, each with the
 * reason. Every other export of the entry is exactly one leaf.
 */
export const BLOCK_EXPORT_EXCLUSIONS: Readonly<Record<string, string>> = {
  SectionFrame: "Section wrapper; its home is the shells, not a block leaf.",
  SECTION_GROUND_CLASSES: "Section ground class map; not a component.",
  APP_FRAME_MATERIALS: "App frame material constants; not a component.",
  useFormValidation: HOOK,
  useCommandMenuShortcut: HOOK,
  parseDataTableViewModel: MODEL_API,
  serializeDataTableViewModel: MODEL_API,
  DataTableViewModelError: MODEL_API,
  filterRows: MODEL_API,
  groupRows: MODEL_API,
  pivotRows: MODEL_API,
  aggregate: MODEL_API,
  parseTableModel: MODEL_API,
  serializeTableModel: MODEL_API,
  TableModelError: MODEL_API,
  tableFilterPredicate: MODEL_API,
  pruneFilterColumn: MODEL_API,
  TABLE_FILTER_CONFORMANCE: MODEL_API,
  validateAppNavigationTree: MODEL_API,
  getAppNavigationAncestry: MODEL_API,
  getAppNavigationBreadcrumbs: MODEL_API,
  indexTree: MODEL_API,
  getTreeAncestry: MODEL_API,
  getTreeBreadcrumbs: MODEL_API,
  layoutScene: MODEL_API,
  sceneRelationText: MODEL_API,
  GraphValidationError: MODEL_API,
  validateGraph: MODEL_API,
  neighbors: MODEL_API,
  subgraph: MODEL_API,
  degrees: MODEL_API,
  components: MODEL_API,
  shortestPath: MODEL_API,
  groupByKind: MODEL_API,
  radialLayout: MODEL_API,
  forceLayout: MODEL_API,
  edgeRoutingHints: MODEL_API,
  scheduleProject: MODEL_API,
  projectRollups: MODEL_API,
  boardColumns: MODEL_API,
  timelineLayout: MODEL_API,
  serializeProject: MODEL_API,
  parseProject: MODEL_API,
  ProjectModelError: MODEL_API,
  layoutFlowCanvas: MODEL_API,
  FLOW_CANVAS_ORIENTATIONS: MODEL_API,
  FLOW_CANVAS_NODE_LIMIT: MODEL_API,
  FLOW_CANVAS_EDGE_LIMIT: MODEL_API,
  panBy: MODEL_API,
  zoomAt: MODEL_API,
  fitTo: MODEL_API,
  clamp: MODEL_API,
  toWorld: MODEL_API,
  toScreen: MODEL_API,
  selectSingle: MODEL_API,
  toggleSelection: MODEL_API,
  selectRange: MODEL_API,
  selectMarquee: MODEL_API,
  clearSelection: MODEL_API,
  navigate: MODEL_API,
  minimapModel: MODEL_API,
};

export const BLOCK_CATALOG = {
  kind: "blocks",
  groups: BLOCK_DISPLAY_TREE,
  entries: BLOCK_ENTRIES,
} satisfies Catalog<"blocks", Record<string, string>, BlockEntry>;
