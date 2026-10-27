import type { Placement } from "../../../catalog-core/index.js";
import type { SystemMetrics } from "../layout.js";

/** Small whole-number metrics so test geometry reads at a glance. */
export const testMetrics: SystemMetrics = {
  cellWidth: 40, cellHeight: 30, cellGap: 10, lineGap: 10, lineLabelWidth: 20,
  boardPadding: 5, boardTitleHeight: 15, boardGap: 50, rowGap: 100,
};

/** Five layers in catalog (build) order, deliberately not in canvas order. Ragged on purpose. */
export const testPlacements: readonly Placement[] = [
  { layer: "tokens", nodes: [
    { id: "color", label: "Color", children: [
      { id: "color-engine", label: "Engine", leaves: ["tokens.color-ramp"] },
      { id: "color-palettes", label: "Palettes", leaves: ["tokens.accent-color", "tokens.status-color", "tokens.surface-color"] },
    ] },
    { id: "space", label: "Space", children: [{ id: "space-scale", label: "Scale", leaves: ["tokens.spacing", "tokens.radius"] }] },
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
