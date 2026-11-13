import type { Placement } from "../../catalog-core/index.js";

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
