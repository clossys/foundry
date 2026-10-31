import type { Placement } from "../../../catalog-core/index.js";
import type { SystemMetrics } from "../layout.js";

/** Small whole-number metrics so test geometry reads at a glance. */
export const testMetrics: SystemMetrics = {
  cellWidth: 40, cellHeight: 30, cellGap: 10, lineGap: 10, lineLabelWidth: 20,
  boardPadding: 5, boardTitleHeight: 15, boardGap: 50, rowGap: 100,
};

/** Five layers in catalog (build) order, deliberately not in canvas order. Ragged on purpose. */
export const testPlacements: readonly Placement[] = [
  { layer: "themes", nodes: [
    { id: "color", label: "Color", children: [
      { id: "color-engine", label: "Engine", leaves: ["themes.chart-1"] },
      { id: "color-palettes", label: "Palettes", leaves: ["themes.primary", "themes.destructive", "themes.background"] },
    ] },
    { id: "space", label: "Space", children: [{ id: "space-scale", label: "Scale", leaves: ["themes.spacing", "themes.radius"] }] },
  ] },
  { layer: "assets", nodes: [{ id: "logo", label: "Logo", children: [{ id: "logo-artwork", label: "Artwork", leaves: ["assets.lockup", "assets.mark"] }] }] },
  { layer: "components", nodes: [
    { id: "actions", label: "Actions", children: [
      { id: "actions-buttons", label: "Buttons", leaves: ["components.button", "components.toggle-button"] },
      { id: "actions-menus", label: "Menus", leaves: ["components.menu"] },
    ] },
  ] },
  { layer: "sections", nodes: [{ id: "parts", label: "Parts", children: [{ id: "parts-structure", label: "Structure", leaves: ["sections.band", "sections.section-header"] }] }] },
  { layer: "frames", nodes: [{ id: "page-shells", label: "Page shells", children: [{ id: "page-shells-documents", label: "Documents", leaves: ["frames.site-shell"] }] }] },
];

/** Host words for SystemCanvas tests. */
export const testLabels = {
  label: "System canvas", hint: "Scroll or pinch to zoom; drag to pan.", breadcrumb: "Canvas position",
  layers: { tokens: "Tokens", assets: "Assets", components: "Components", sections: "Sections", frames: "Frames" },
} as const;
