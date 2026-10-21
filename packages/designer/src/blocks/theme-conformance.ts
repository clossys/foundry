/**
 * Both themes are a requirement of every Block, never an optional capability.
 * Test tooling reads this data alongside the real barrel, runtime source graph,
 * token declarations and existing contrast policy. Nothing here adds a runtime
 * dependency or changes the public Block API.
 */
export interface BlockThemeRegistration {
  readonly exportName: string;
  readonly source: string;
  readonly contrastPairs: readonly string[];
  /** Only foreground-free compositions qualify; this list may only shrink. */
  readonly exemptionReason?: string;
}

const BASE_READING = ["ink-primary/surface-base", "ink-secondary/surface-base"];
const RAISED_READING = ["ink-primary/surface-raised", "ink-secondary/surface-raised"];
const GROUNDED_READING = [
  ...BASE_READING,
  "ink-primary/surface-sunken", "ink-secondary/surface-sunken",
  "ink-on-inverse/surface-inverse", "ink-on-inverse-muted/surface-inverse",
];

/** Exact exported component inventory; a new barrel export requires registration. */
export const BLOCK_THEME_CONFORMANCE: readonly BlockThemeRegistration[] = [
  { exportName: "Lockup", source: "src/blocks/Lockup.tsx", contrastPairs: ["ink-primary/surface-base", "ink-on-inverse/surface-inverse"] },
  { exportName: "PageHeader", source: "src/blocks/PageHeader.tsx", contrastPairs: BASE_READING },
  { exportName: "AccountMenu", source: "src/blocks/AccountMenu.tsx", contrastPairs: RAISED_READING },
  { exportName: "EmptyState", source: "src/blocks/EmptyState.tsx", contrastPairs: BASE_READING },
  { exportName: "DataTable", source: "src/blocks/DataTable.tsx", contrastPairs: BASE_READING },
  { exportName: "DetailView", source: "src/blocks/DetailView.tsx", contrastPairs: BASE_READING },
  { exportName: "Pagination", source: "src/blocks/Pagination.tsx", contrastPairs: ["ink-secondary/surface-base", "ink-muted/surface-base"] },
  { exportName: "Stat", source: "src/blocks/Stat.tsx", contrastPairs: BASE_READING },
  { exportName: "Form", source: "src/blocks/Form.tsx", contrastPairs: ["ink-primary/surface-base"] },
  { exportName: "FieldGroup", source: "src/blocks/FieldGroup.tsx", contrastPairs: ["ink-secondary/surface-base", "ink-muted/surface-base"] },
  { exportName: "ConfirmDialog", source: "src/blocks/ConfirmDialog.tsx", contrastPairs: RAISED_READING },
  {
    exportName: "Toolbar", source: "src/blocks/Toolbar.tsx", contrastPairs: [],
    exemptionReason: "Owns layout and roving focus around caller-supplied leading, search and trailing controls; paints no foreground or surface. Each supplied control owns its contrast obligations.",
  },
  { exportName: "NavGrid", source: "src/blocks/NavGrid.tsx", contrastPairs: BASE_READING },
  { exportName: "SectionHeader", source: "src/blocks/SectionHeader.tsx", contrastPairs: BASE_READING },
  { exportName: "Hero", source: "src/blocks/Hero.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "ContentSection", source: "src/blocks/ContentSection.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "SectionIntro", source: "src/blocks/SectionIntro.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "MediaFigure", source: "src/blocks/MediaFigure.tsx", contrastPairs: ["ink-muted/surface-base", "ink-muted/surface-sunken", "ink-on-inverse-muted/surface-inverse"] },
  { exportName: "MarketingChapter", source: "src/blocks/MarketingChapter.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "FeatureGrid", source: "src/blocks/FeatureGrid.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "Matrix", source: "src/blocks/Matrix.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "Specimen", source: "src/blocks/specimen/Specimen.tsx", contrastPairs: RAISED_READING },
  { exportName: "SpecimenPanel", source: "src/blocks/specimen/SpecimenPanel.tsx", contrastPairs: RAISED_READING },
  { exportName: "OrderedStepSequence", source: "src/blocks/OrderedStepSequence.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "StatusList", source: "src/blocks/StatusList.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "TaskList", source: "src/blocks/TaskList.tsx", contrastPairs: BASE_READING },
  { exportName: "EventItem", source: "src/blocks/EventItem.tsx", contrastPairs: BASE_READING },
  { exportName: "Faq", source: "src/blocks/Faq.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "PricingTable", source: "src/blocks/PricingTable.tsx", contrastPairs: RAISED_READING },
  { exportName: "Testimonial", source: "src/blocks/Testimonial.tsx", contrastPairs: BASE_READING },
  { exportName: "ArticleBody", source: "src/blocks/ArticleBody.tsx", contrastPairs: [...BASE_READING, "ink-primary/surface-sunken", "ink-link/surface-base"] },
  { exportName: "SectionFrame", source: "src/blocks/SectionFrame.tsx", contrastPairs: ["ink-primary/surface-base", "ink-primary/surface-sunken", "ink-on-inverse/surface-inverse"] },
  { exportName: "NewsletterBand", source: "src/blocks/NewsletterBand.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "ConsentBanner", source: "src/blocks/ConsentBanner.tsx", contrastPairs: RAISED_READING },
  {
    exportName: "Panel", source: "src/blocks/Panel.tsx", contrastPairs: [],
    exemptionReason: "Owns header, content and footer regions on Card's tokenized outline surface; supplies no foreground text or mark. Caller-supplied content owns its reading ink and contrast pairs; Card's surface and edge remain in the token checks.",
  },
  { exportName: "Drawer", source: "src/blocks/Drawer.tsx", contrastPairs: ["ink-primary/surface-raised"] },
  {
    exportName: "ResizablePane", source: "src/blocks/ResizablePane.tsx",
    contrastPairs: ["link-grid/accent/surface-raised", "link-grid/accent-on-inverse/surface-inverse-raised"],
  },
  { exportName: "CommandMenu", source: "src/blocks/CommandMenu.tsx", contrastPairs: RAISED_READING },
  { exportName: "AppNavigation", source: "src/blocks/AppNavigation.tsx", contrastPairs: BASE_READING },
  { exportName: "Explorer", source: "src/blocks/Explorer.tsx", contrastPairs: [...BASE_READING, ...RAISED_READING] },
  { exportName: "RecordLedger", source: "src/blocks/RecordLedger.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "AnatomyCallouts", source: "src/blocks/AnatomyCallouts.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "Scene", source: "src/blocks/scene/Scene.tsx", contrastPairs: BASE_READING },
  { exportName: "Item", source: "src/blocks/items/Item.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "Tree", source: "src/blocks/tree/Tree.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "Items", source: "src/blocks/items/Items.tsx", contrastPairs: GROUNDED_READING },
  { exportName: "GroupedTable", source: "src/blocks/GroupedTable.tsx", contrastPairs: [...RAISED_READING, "ink-primary/surface-sunken"] },
  { exportName: "CatalogWorkspace", source: "src/blocks/CatalogWorkspace.tsx", contrastPairs: [...BASE_READING, ...RAISED_READING] },
  { exportName: "Chat", source: "src/blocks/chat/Chat.tsx", contrastPairs: [...BASE_READING, ...RAISED_READING, "ink-primary/surface-sunken", "ink-secondary/surface-sunken", "ink-link/surface-base"] },
];

/** Explicitly classified value exports, never a casing-based escape for new Blocks. */
export const NON_BLOCK_THEME_EXPORTS: Readonly<Record<string, string>> = {
  SECTION_GROUND_CLASSES: "Shared token class policy, inspected through the Blocks that use it.",
  useFormValidation: "Validation hook with no rendered regions or owned paint.",
  APP_FRAME_MATERIALS: "Composition metadata for already registered Blocks.",
  useCommandMenuShortcut: "Keyboard shortcut hook with no rendered regions or owned paint.",
  validateAppNavigationTree: "Navigation data validation with no rendered regions or owned paint.",
  getAppNavigationAncestry: "Navigation data query with no rendered regions or owned paint.",
  getAppNavigationBreadcrumbs: "Navigation data query with no rendered regions or owned paint.",
  indexTree: "Validates and indexes supplied tree identities, parents and depth; returns Maps without rendering or paint.",
  getTreeAncestry: "Queries a supplied tree's exact identity or href ancestry; returns caller nodes without rendering or paint.",
  getTreeBreadcrumbs: "Projects tree ancestry into plain breadcrumb data; renders no regions or paint.",
  layoutScene: "Scene geometry calculation; the rendered Scene is registered separately.",
  sceneRelationText: "Scene relation text calculation; the rendered Scene is registered separately.",
  filterRows: "Saved-view row filtering and facet counts over supplied plain data; renders no UI or paint.",
  tableFilterPredicate: "Pure filter function with no rendered regions or owned paint.",
  pruneFilterColumn: "Pure filter function with no rendered regions or owned paint.",
  TABLE_FILTER_CONFORMANCE: "Conformance fixture data with no rendered regions or owned paint.",
  groupRows: "Nested group and aggregate calculation over supplied rows; renders no UI or paint.",
  pivotRows: "Pivot axes, cells and totals calculated from supplied rows; renders no UI or paint.",
  aggregate: "Saved-view measure calculation returning plain aggregate values; renders no UI or paint.",
  parseTableModel: "Saved-view validation and copying from a plain object; renders no UI or paint.",
  serializeTableModel: "Independent validated plain-object saved-view serialization; renders no UI or paint.",
  TableModelError: "Typed table-data refusal with an error code and message; renders no UI or paint.",
  parseDataTableViewModel: "Saved-view envelope validation and copying over plain data; renders no UI or paint.",
  serializeDataTableViewModel: "Validated saved-view envelope JSON serialization; renders no UI or paint.",
  DataTableViewModelError: "Typed saved-view envelope validation refusal; renders no UI or paint.",
  GraphValidationError: "Typed graph-data refusal with an error code and message; renders no UI or paint.",
  validateGraph: "Graph record validation and copying with explicit self-loop flags; renders no UI or paint.",
  neighbors: "Adjacent-node query with direction and edge-kind filters; returns plain node data with no UI or paint.",
  subgraph: "Bounded undirected traversal with node and edge filters; returns plain graph records with no UI or paint.",
  degrees: "Incoming, outgoing and total graph incidence counts; returns plain records with no UI or paint.",
  components: "Weak-component grouping of supplied graph nodes; returns plain arrays with no UI or paint.",
  shortestPath: "Unweighted undirected path query returning node records or null; renders no UI or paint.",
  groupByKind: "Graph node grouping by kind into plain arrays; renders no UI or paint.",
  radialLayout: "Computes radial graph coordinates; returns plain positions with no UI or paint.",
  forceLayout: "Seeded force simulation with fixed steps and node separation; returns plain positions with no UI or paint.",
  edgeRoutingHints: "Straight routing metadata with loop flags and parallel-edge counts; returns plain records with no UI or paint.",
};
