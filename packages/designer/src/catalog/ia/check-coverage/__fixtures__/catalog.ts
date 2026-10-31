import type { CoverageInput, Layer } from "../types.js";
export const layers: readonly Layer[] = ["themes", "assets", "components", "sections", "frames"];
export const hash = `sha256:${"0".repeat(64)}`;
/** Synthetic, completely connected five-layer catalog; no production approval evidence. */
export function fixture(): CoverageInput {
  return {
    placements: layers.map(layer => ({ layer, nodes: [{ id: `${layer}-group`, label: layer, children: [{ id: `${layer}-family`, label: "Family", leaves: [`${layer}.example`] }] }] })),
    slots: layers.map(layer => ({ id: `${layer}.example`, layer })),
    fills: layers.map(layer => ({ id: `fixture/${layer}.example`, leaf: `${layer}.example`, hash })),
    external: [{ id: "publisher:admin", package: "publisher", kind: "route" }],
    edges: [
      { from: "publisher:admin", to: "frames.example", evidence: "fixture" },
      { from: "frames.example", to: "sections.example", evidence: "fixture" },
      { from: "frames.example", to: "assets.example", evidence: "fixture" },
      { from: "sections.example", to: "components.example", evidence: "fixture" },
      { from: "components.example", to: "tokens.example", evidence: "fixture" },
    ],
    adminRoots: ["frames.example"], adminInputsComplete: true,
  };
}
