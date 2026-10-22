import type {
  BlockContract,
  BlockEntry,
  BlockGroupMap,
  BlockId,
  BlockPlacement,
  Catalog,
  CatalogTree,
  WorkRef,
} from "./types.js";

/** Block display tree: 5 L1 functions, 33 L2 families. */
export const BLOCK_GROUPS: CatalogTree<BlockGroupMap> = [
  {
    id: "explain",
    label: "Explain",
    children: [
      { id: "headings", label: "Headings" },
      { id: "sections", label: "Sections" },
      { id: "capabilities", label: "Capabilities" },
      { id: "evidence", label: "Evidence" },
      { id: "media", label: "Media" },
      { id: "reading", label: "Reading" },
      { id: "sequence", label: "Sequence" },
      { id: "brand", label: "Brand" },
      { id: "specimens", label: "Specimens" },
    ],
  },
  {
    id: "organize",
    label: "Organize",
    children: [
      { id: "collection", label: "Collection" },
      { id: "comparison", label: "Comparison" },
      { id: "offers", label: "Offers" },
      { id: "metrics", label: "Metrics" },
      { id: "records", label: "Records" },
      { id: "activity", label: "Activity" },
      { id: "containers", label: "Containers" },
    ],
  },
  {
    id: "collect",
    label: "Collect",
    children: [
      { id: "forms", label: "Forms" },
      { id: "fields", label: "Fields" },
      { id: "import", label: "Import" },
      { id: "settings", label: "Settings" },
      { id: "access", label: "Access" },
      { id: "conversation", label: "Conversation" },
    ],
  },
  {
    id: "navigate",
    label: "Navigate",
    children: [
      { id: "destinations", label: "Destinations" },
      { id: "app-navigation", label: "App navigation" },
      { id: "hierarchy", label: "Hierarchy" },
      { id: "in-page", label: "In-page" },
      { id: "actions", label: "Actions" },
      { id: "paging", label: "Paging" },
      { id: "filtering", label: "Filtering" },
    ],
  },
  {
    id: "respond",
    label: "Respond",
    children: [
      { id: "states", label: "States" },
      { id: "decisions", label: "Decisions" },
      { id: "notices", label: "Notices" },
      { id: "notifications", label: "Notifications" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A placement; an L2 from another L1 is a type error. */
const at = <L1 extends keyof BlockGroupMap>(l1: L1, l2: BlockGroupMap[L1]): BlockPlacement =>
  ({ l1, l2 }) as BlockPlacement;

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
const built = (place: BlockPlacement, exportName: string, { stableCandidate = false, ...leaf }: Leaf): BlockEntry => ({
  ...leaf,
  ...place,
  ...draft,
  export: exportName,
  built: "yes",
  stableCandidate,
});

/** Exported on the default branch; the consumer's vendored copy has not caught up. */
const exported = (place: BlockPlacement, exportName: string, leaf: Leaf): BlockEntry => ({
  ...leaf,
  ...place,
  ...draft,
  export: exportName,
  built: "exported",
  stableCandidate: false,
  notes: [VENDOR_LAG, ...(leaf.notes ?? [])],
});

/** Built as a configuration of another leaf's export; no export of its own. */
const recipe = (place: BlockPlacement, of: BlockId, leaf: Leaf): BlockEntry => ({
  ...leaf,
  ...place,
  ...draft,
  export: null,
  built: "yes",
  recipeOf: of,
  stableCandidate: false,
});

/** Still exported so existing references resolve; new work uses the successor. */
const deprecated = (place: BlockPlacement, exportName: string, successor: BlockId, leaf: Leaf): BlockEntry => ({
  ...leaf,
  ...place,
  lifecycle: "deprecated",
  successor,
  signedOff: false,
  ownerReview: "not-yet-reviewed",
  export: exportName,
  built: "yes",
  stableCandidate: false,
});

/** A registered draft spec row: not built, zero configs. */
const spec = (place: BlockPlacement, leaf: Leaf): BlockEntry => ({
  ...leaf,
  ...place,
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
// Leaves: 85 (Explain 28, Organize 25, Collect 10, Navigate 15, Respond 7)
// ---------------------------------------------------------------------------

const HEADINGS = at("explain", "headings");
const SECTIONS = at("explain", "sections");
const CAPABILITIES = at("explain", "capabilities");
const EVIDENCE = at("explain", "evidence");
const MEDIA = at("explain", "media");
const READING = at("explain", "reading");
const SEQUENCE = at("explain", "sequence");
const BRAND = at("explain", "brand");
const SPECIMENS = at("explain", "specimens");
const COLLECTION = at("organize", "collection");
const COMPARISON = at("organize", "comparison");
const OFFERS = at("organize", "offers");
const METRICS = at("organize", "metrics");
const RECORDS = at("organize", "records");
const ACTIVITY = at("organize", "activity");
const CONTAINERS = at("organize", "containers");
const FORMS = at("collect", "forms");
const FIELDS = at("collect", "fields");
const IMPORT = at("collect", "import");
const SETTINGS = at("collect", "settings");
const ACCESS = at("collect", "access");
const CONVERSATION = at("collect", "conversation");
const DESTINATIONS = at("navigate", "destinations");
const APP_NAVIGATION = at("navigate", "app-navigation");
const HIERARCHY = at("navigate", "hierarchy");
const IN_PAGE = at("navigate", "in-page");
const ACTIONS = at("navigate", "actions");
const PAGING = at("navigate", "paging");
const FILTERING = at("navigate", "filtering");
const STATES = at("respond", "states");
const DECISIONS = at("respond", "decisions");
const NOTICES = at("respond", "notices");
const NOTIFICATIONS = at("respond", "notifications");

/** Block leaves, in display order. */
export const BLOCK_ENTRIES: readonly BlockEntry[] = [
  // Explain / Headings
  built(HEADINGS, "Hero", { id: "say.hero", label: "Hero" }),
  built(HEADINGS, "PageHeader", {
    id: "say.page-header",
    label: "Page header",
    stableCandidate: true,
    contract: PAGE_HEADER_CONTRACT,
    notes: [STABLE_CANDIDATE],
  }),
  built(HEADINGS, "SectionHeader", { id: "say.section-header", label: "Section header" }),
  built(HEADINGS, "SectionIntro", { id: "say.section-intro", label: "Section intro" }),

  // Explain / Sections
  built(SECTIONS, "ContentSection", { id: "say.takeaway", label: "Content section" }),
  deprecated(SECTIONS, "MarketingChapter", "say.takeaway", { id: "say.chapter", label: "Marketing chapter" }),

  // Explain / Capabilities
  recipe(CAPABILITIES, "items.raw", { id: "items.features", label: "Feature list" }),
  recipe(CAPABILITIES, "items.raw", { id: "items.statement", label: "Statement row" }),
  deprecated(CAPABILITIES, "FeatureGrid", "items.features", { id: "items.feature-grid", label: "Feature grid" }),

  // Explain / Evidence
  built(EVIDENCE, "Testimonial", { id: "say.testimonial", label: "Testimonial" }),
  spec(EVIDENCE, { id: "say.testimonial-set", label: "Testimonial set", inFlight: pr(2394, "draft") }),
  spec(EVIDENCE, { id: "items.logo-cloud", label: "Logo cloud", inFlight: pr(2394, "draft") }),
  spec(EVIDENCE, { id: "items.people-grid", label: "People grid", inFlight: pr(2394, "draft") }),

  // Explain / Media
  built(MEDIA, "MediaFigure", { id: "say.media-figure", label: "Media figure" }),
  spec(MEDIA, { id: "items.media-gallery", label: "Media gallery", inFlight: pr(2391, "draft") }),

  // Explain / Reading
  built(READING, "ArticleBody", {
    id: "prose.article",
    label: "Article body",
    stableCandidate: true,
    notes: [STABLE_CANDIDATE],
  }),
  recipe(READING, "items.raw", { id: "items.faq", label: "FAQ" }),
  deprecated(READING, "Faq", "items.faq", { id: "items.legacy-faq", label: "FAQ (legacy)" }),
  spec(READING, { id: "say.info-tip", label: "Info tip" }),

  // Explain / Sequence
  recipe(SEQUENCE, "items.raw", { id: "items.steps", label: "Steps" }),
  deprecated(SEQUENCE, "OrderedStepSequence", "items.steps", {
    id: "items.ordered-step-sequence",
    label: "Ordered steps (legacy)",
  }),
  spec(SEQUENCE, { id: "items.timeline", label: "Timeline", inFlight: pr(2391, "draft") }),

  // Explain / Brand
  exported(BRAND, "Lockup", { id: "say.lockup", label: "Lockup" }),

  // Explain / Specimens
  recipe(SPECIMENS, "items.raw", { id: "items.specimen-stack", label: "Specimen stack" }),
  built(SPECIMENS, "Specimen", { id: "say.specimen", label: "Specimen" }),
  built(SPECIMENS, "SpecimenPanel", { id: "matrix.specimen-panel", label: "Specimen panel" }),
  built(SPECIMENS, "AnatomyCallouts", { id: "say.anatomy-callouts", label: "Anatomy callouts" }),
  built(SPECIMENS, "Scene", { id: "matrix.scene", label: "Scene" }),

  // Organize / Collection
  built(COLLECTION, "Items", { id: "items.raw", label: "Items" }),
  built(COLLECTION, "Item", { id: "items.item", label: "Item" }),
  recipe(COLLECTION, "items.raw", { id: "items.cards", label: "Card grid" }),
  spec(COLLECTION, { id: "items.task-list", label: "Task list", inFlight: pr(2378, "draft") }),

  // Organize / Comparison
  built(COMPARISON, "Matrix", { id: "matrix.raw", label: "Matrix" }),
  recipe(COMPARISON, "matrix.raw", {
    id: "matrix.comparison",
    label: "Comparison table",
    inFlight: pr(2390, "draft"),
    notes: ["The open pull request adds plan and entitlement comparison configs."],
  }),

  // Organize / Offers
  built(OFFERS, "PricingTable", {
    id: "matrix.pricing",
    label: "Pricing table",
    inFlight: pr(2390, "draft"),
    notes: ["The open pull request adds an interval config."],
  }),

  // Organize / Metrics
  built(METRICS, "Stat", { id: "items.stat", label: "Stat" }),
  recipe(METRICS, "items.raw", { id: "items.stat-grid", label: "Stat grid" }),
  built(METRICS, "StatusList", { id: "items.status-list", label: "Status list" }),
  exported(METRICS, "UsageMeter", { id: "items.usage-meter", label: "Usage meter" }),

  // Organize / Records
  built(RECORDS, "DataTable", { id: "matrix.data-table", label: "Data table" }),
  built(RECORDS, "DetailView", { id: "matrix.detail", label: "Detail view" }),
  built(RECORDS, "RecordLedger", { id: "items.record-ledger", label: "Record ledger" }),
  exported(RECORDS, "GroupedTable", { id: "matrix.grouped-table", label: "Grouped table" }),
  exported(RECORDS, "ResourceList", {
    id: "items.resource-list",
    label: "Resource list",
    notes: ["Built on the grid list atom."],
  }),
  spec(RECORDS, { id: "matrix.data-grid", label: "Data grid" }),

  // Organize / Activity
  spec(ACTIVITY, { id: "items.event-item", label: "Event item", inFlight: pr(2378, "draft") }),
  spec(ACTIVITY, { id: "items.activity-feed", label: "Activity feed" }),
  spec(ACTIVITY, { id: "matrix.audit-log", label: "Audit log" }),

  // Organize / Containers
  built(CONTAINERS, "Panel", { id: "matrix.panel", label: "Panel" }),
  built(CONTAINERS, "Drawer", { id: "matrix.drawer", label: "Drawer" }),
  built(CONTAINERS, "ResizablePane", {
    id: "matrix.resizable-pane",
    label: "Resizable pane",
    notes: ["Depends on the owner decision for the resize handle atom: rebuilt with it, or parked with it."],
  }),
  exported(CONTAINERS, "CatalogWorkspace", { id: "matrix.catalog-workspace", label: "Catalog workspace" }),
  exported(CONTAINERS, "CanvasSurface", { id: "matrix.canvas-surface", label: "Canvas surface" }),

  // Collect / Forms
  built(FORMS, "Form", { id: "form.form", label: "Form", stableCandidate: true, notes: [STABLE_CANDIDATE] }),
  exported(FORMS, "NewsletterBand", { id: "form.newsletter-band", label: "Newsletter band" }),
  spec(FORMS, { id: "form.form-wizard", label: "Form wizard" }),

  // Collect / Fields
  built(FIELDS, "FieldGroup", { id: "form.field-group", label: "Field group" }),
  spec(FIELDS, {
    id: "form.file-field",
    label: "File field",
    inFlight: { kind: "issue", number: 2357 },
    notes: ["An open issue tracks it; no pull request yet."],
  }),

  // Collect / Import
  exported(IMPORT, "ColumnMapper", { id: "form.column-mapper", label: "Column mapper" }),

  // Collect / Settings
  spec(SETTINGS, {
    id: "form.settings-section",
    label: "Settings section",
    notes: ["Check the admin routes for a consumer before building."],
  }),
  spec(SETTINGS, {
    id: "form.save-bar",
    label: "Save bar",
    notes: ["Check the admin routes for a consumer before building."],
  }),

  // Collect / Access
  exported(ACCESS, "AccessMatrix", { id: "matrix.access-matrix", label: "Access matrix" }),

  // Collect / Conversation
  exported(CONVERSATION, "Chat", { id: "form.chat", label: "Chat" }),

  // Navigate / Destinations
  recipe(DESTINATIONS, "items.raw", { id: "items.link-index", label: "Link index" }),
  recipe(DESTINATIONS, "items.raw", { id: "items.topics", label: "Topic list" }),
  built(DESTINATIONS, "NavGrid", { id: "items.nav-grid", label: "Nav grid" }),

  // Navigate / App navigation
  built(APP_NAVIGATION, "AppNavigation", { id: "items.app-navigation", label: "App navigation" }),
  built(APP_NAVIGATION, "AccountMenu", { id: "form.account-menu", label: "Account menu" }),
  built(APP_NAVIGATION, "CommandMenu", { id: "form.command-menu", label: "Command menu" }),
  exported(APP_NAVIGATION, "PageBar", {
    id: "items.page-bar",
    label: "Page bar",
    notes: ["Extracted from the app frame by merged pull request 2398."],
  }),

  // Navigate / Hierarchy
  exported(HIERARCHY, "Tree", { id: "items.tree", label: "Tree" }),
  exported(HIERARCHY, "Explorer", { id: "items.explorer", label: "Explorer" }),

  // Navigate / In-page
  spec(IN_PAGE, { id: "prose.table-of-contents", label: "Table of contents", inFlight: pr(2400, "draft") }),

  // Navigate / Actions
  built(ACTIONS, "Toolbar", { id: "form.toolbar", label: "Toolbar" }),
  spec(ACTIONS, { id: "form.bulk-action-bar", label: "Bulk action bar" }),

  // Navigate / Paging
  built(PAGING, "Pagination", { id: "form.pagination", label: "Pagination" }),
  spec(PAGING, { id: "form.load-more", label: "Load more" }),

  // Navigate / Filtering
  spec(FILTERING, { id: "form.filter-builder", label: "Filter builder" }),

  // Respond / States
  built(STATES, "EmptyState", {
    id: "say.empty-state",
    label: "Empty state",
    stableCandidate: true,
    notes: [STABLE_CANDIDATE],
  }),
  spec(STATES, {
    id: "say.error-state",
    label: "Error state",
    notes: ["Check the admin routes for a consumer before building."],
  }),

  // Respond / Decisions
  built(DECISIONS, "ConfirmDialog", { id: "form.confirm-dialog", label: "Confirm dialog" }),
  built(DECISIONS, "ConsentBanner", { id: "form.consent-banner", label: "Consent banner" }),

  // Respond / Notices
  spec(NOTICES, { id: "say.notice-stack", label: "Notice stack" }),
  spec(NOTICES, { id: "form.refresh-status", label: "Refresh status" }),

  // Respond / Notifications
  spec(NOTIFICATIONS, { id: "items.notification-center", label: "Notification center" }),
];

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

export const BLOCK_CATALOG: Catalog<"blocks", BlockGroupMap, BlockEntry> = {
  kind: "blocks",
  groups: BLOCK_GROUPS,
  entries: BLOCK_ENTRIES,
};
