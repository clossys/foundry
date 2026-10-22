import type { Catalog, CatalogTree, TokenEntry, TokenGroupMap } from "./types.js";

/** Token display tree: 6 L1 groups (the Tailwind namespaces), 31 L2 groups. */
export const TOKEN_GROUPS: CatalogTree<TokenGroupMap> = [
  {
    id: "color",
    label: "Color",
    children: [
      { id: "surface", label: "Surface" },
      { id: "ink", label: "Ink" },
      { id: "line", label: "Line" },
      { id: "primary", label: "Primary" },
      { id: "control", label: "Control" },
      { id: "status", label: "Status" },
      { id: "overlay", label: "Overlay" },
      { id: "focus", label: "Focus" },
      { id: "palette", label: "Palette" },
      { id: "data", label: "Data" },
    ],
  },
  {
    id: "type",
    label: "Type",
    children: [
      { id: "font", label: "Font" },
      { id: "display", label: "Display" },
      { id: "weight", label: "Weight" },
      { id: "text", label: "Text" },
      { id: "tracking", label: "Tracking" },
      { id: "leading", label: "Leading" },
    ],
  },
  {
    id: "layout",
    label: "Layout",
    children: [
      { id: "spacing", label: "Spacing" },
      { id: "breakpoint", label: "Breakpoint" },
      { id: "container", label: "Container" },
      { id: "region", label: "Region" },
    ],
  },
  {
    id: "shape",
    label: "Shape",
    children: [
      { id: "radius", label: "Radius" },
      { id: "border", label: "Border" },
      { id: "focus", label: "Focus" },
      { id: "icon", label: "Icon" },
    ],
  },
  {
    id: "depth",
    label: "Depth",
    children: [
      { id: "shadow", label: "Shadow" },
      { id: "blur", label: "Blur" },
      { id: "z", label: "Z" },
    ],
  },
  {
    id: "motion",
    label: "Motion",
    children: [
      { id: "ease", label: "Ease" },
      { id: "duration", label: "Duration" },
      { id: "transition", label: "Transition" },
      { id: "animate", label: "Animate" },
    ],
  },
];

/** Token leaves. One example entry for now; the full set follows. */
export const TOKEN_ENTRIES: readonly TokenEntry[] = [
  {
    id: "--color-ink-muted",
    label: "Ink muted",
    l1: "color",
    l2: "ink",
    tier: "brand-required",
    lever: false,
    modes: "per-mode",
    reference: { light: { literal: "oklch(0.54 0 0)" }, dark: { literal: "oklch(0.66 0 0)" } },
    inTheme: true,
    utilities: ["text-ink-muted"],
    pairs: [{ fg: "--color-ink-muted", bg: "--color-surface-base", min: 4.5 }],
    sourceRows: [12],
    previousIds: [],
    lifecycle: "draft",
    ownerReview: "not-yet-reviewed",
    notes: ["Must reach WCAG AA on the page ground in both modes."],
  },
];

export const TOKEN_CATALOG: Catalog<"tokens", TokenGroupMap, TokenEntry> = {
  kind: "tokens",
  groups: TOKEN_GROUPS,
  entries: TOKEN_ENTRIES,
};
