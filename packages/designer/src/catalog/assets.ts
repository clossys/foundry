import type { AssetGroupMap, AssetSlotEntry, Catalog, CatalogTree } from "./types.js";

/** Asset display tree: 3 L1 groups, 7 L2 groups. */
export const ASSET_GROUPS: CatalogTree<AssetGroupMap> = [
  {
    id: "logo",
    label: "Logo",
    children: [
      { id: "lockup", label: "Lockup" },
      { id: "mark", label: "Mark" },
      { id: "display", label: "Display" },
    ],
  },
  {
    id: "app-identity",
    label: "App identity",
    children: [
      { id: "favicon", label: "Favicon" },
      { id: "app-icon", label: "App icon" },
      { id: "manifest", label: "Manifest" },
    ],
  },
  {
    id: "imagery",
    label: "Imagery",
    children: [{ id: "rules", label: "Rules" }],
  },
];

/** Asset slots. One example entry for now; the full set follows. */
export const ASSET_ENTRIES: readonly AssetSlotEntry[] = [
  {
    id: "favicon.svg",
    label: "Favicon (SVG)",
    l1: "app-identity",
    l2: "favicon",
    kind: "file",
    role: "favicon",
    requirement: "required",
    sources: ["derived", "supplied"],
    production: { step: "derive", exists: true },
    files: [{ name: "favicon.svg", format: "svg" }],
    grounds: ["light", "dark"],
    clearSpace: null,
    minSizePx: 16,
    checks: [
      { id: "contrast", exists: true },
      { id: "minimum-size", exists: true, note: "Judged at 16 px." },
    ],
    owner: "brand",
    lifecycle: "draft",
    ownerReview: "not-yet-reviewed",
    notes: ["Derived from the mark."],
  },
];

export const ASSET_CATALOG: Catalog<"assets", AssetGroupMap, AssetSlotEntry> = {
  kind: "assets",
  groups: ASSET_GROUPS,
  entries: ASSET_ENTRIES,
};
