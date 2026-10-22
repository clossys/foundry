import { ChevronRight } from "../icons/ChevronRight.js";
import type { Catalog, CatalogTree, IconEntry, IconGroupMap } from "./types.js";

/** Icon display tree: 2 L1 groups (interface and subject glyphs), 11 L2 purpose groups. */
export const ICON_GROUPS: CatalogTree<IconGroupMap> = [
  {
    id: "interface",
    label: "Interface",
    children: [
      { id: "direction", label: "Direction" },
      { id: "controls", label: "Controls" },
      { id: "status", label: "Status" },
      { id: "theme", label: "Theme" },
    ],
  },
  {
    id: "subject",
    label: "Subject",
    children: [
      { id: "people", label: "People" },
      { id: "places", label: "Places" },
      { id: "documents", label: "Documents" },
      { id: "time", label: "Time" },
      { id: "commerce", label: "Commerce" },
      { id: "trust", label: "Trust" },
      { id: "structure", label: "Structure" },
    ],
  },
];

/** Glyph leaves. One example entry for now; the full set follows. */
export const ICON_ENTRIES: readonly IconEntry[] = [
  {
    id: "ChevronRight",
    label: "Chevron right",
    l1: "interface",
    l2: "direction",
    source: { library: "lucide", name: "chevron-right", version: "1.23.0" },
    nodes: ChevronRight,
    sizes: ["sm", "md", "lg"],
    stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative",
    mirrorInRtl: true,
    lifecycle: "draft",
    ownerReview: "not-yet-reviewed",
    notes: ["The default trailing icon of the quiet Button."],
  },
];

export const ICON_CATALOG: Catalog<"icons", IconGroupMap, IconEntry> = {
  kind: "icons",
  groups: ICON_GROUPS,
  entries: ICON_ENTRIES,
};
