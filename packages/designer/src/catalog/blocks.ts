import type { BlockEntry, BlockGroupMap, Catalog, CatalogTree } from "./types.js";

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

/** Block leaves. One example entry for now; the full set follows. */
export const BLOCK_ENTRIES: readonly BlockEntry[] = [
  {
    id: "say.page-header",
    label: "Page header",
    l1: "explain",
    l2: "headings",
    export: "PageHeader",
    built: "yes",
    lifecycle: "draft",
    stableCandidate: true,
    signedOff: false,
    ownerReview: "not-yet-reviewed",
    contract: {
      requiredFields: ["title"],
      axes: [],
      slots: ["description", "actions", "breadcrumb"],
      configs: [],
      surface: "both",
      specimen: null,
      alsoUsedFor: [],
    },
    notes: ["Stable candidate: promotion to stable needs owner sign-off against its exact specimen."],
  },
];

export const BLOCK_CATALOG: Catalog<"blocks", BlockGroupMap, BlockEntry> = {
  kind: "blocks",
  groups: BLOCK_GROUPS,
  entries: BLOCK_ENTRIES,
};
