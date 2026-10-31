import type { AssetContract, CatalogData, FillDoc, PlacementNode, Slot } from "../catalog-core/types.js";
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";
import { BACKDROP_GRAPHIC_PATTERNS, BACKDROP_GRAPHIC_RECIPES, BACKDROP_GRAPHIC_REFERENCE, BACKDROP_GRAPHIC_SLOT, BACKDROP_GRAPHIC_TOKEN_READS } from "./backdrop-graphic.js";

/** Single-writer integration: append this slot/fill and put its leaf in the existing imagery-patterns IA family. */
export const a276BackdropGraphicSlot: Slot<AssetContract> = {
  id: BACKDROP_GRAPHIC_SLOT, layer: "assets", status: "draft", requires: [],
  contract: { kind: "asset", valueKind: "rules", members: { mode: "closed", names: BACKDROP_GRAPHIC_PATTERNS }, modes: ["light"] },
};
const recipes = Object.fromEntries(BACKDROP_GRAPHIC_PATTERNS.map(pattern => [pattern, {
  $type: "rules" as const, $value: { ...BACKDROP_GRAPHIC_RECIPES[pattern] },
}]));
export const a276BackdropGraphicFill: FillDoc = {
  $extensions: { "com.clossys.fill": {
    id: `foundry/${BACKDROP_GRAPHIC_SLOT}`, slot: BACKDROP_GRAPHIC_SLOT, source: "foundry", mode: "implementation",
    sourceAddress: "catalog-assets/backdrop-graphic.ts", relation: "same-contract", builtOn: [], conforms: [], evidence: [],
    author: "foundry", trust: "foundry", license: "MIT", status: "draft",
    pin: { file: "src/catalog-assets/backdrop-graphic.ts", export: "BACKDROP_GRAPHIC_RECIPES", sha256: sha256(stableStringify(BACKDROP_GRAPHIC_RECIPES)) },
    reads: { themes: [...BACKDROP_GRAPHIC_TOKEN_READS], assets: [] },
  } }, assets: { "backdrop-graphic": recipes },
};
/** Explicit logical-reference mapping for Hero; this is not a new native alias or schema extension. */
export const a276BackdropGraphicReference = Object.freeze({ reference: BACKDROP_GRAPHIC_REFERENCE, slot: BACKDROP_GRAPHIC_SLOT, defaultMember: "mesh" as const });

/** Apply to loadCatalog() for integration and focused verification. Global loader wiring remains with its owner. */
export function withA276BackdropGraphic(catalog: CatalogData): CatalogData {
  if (catalog.slots.some(slot => slot.id === BACKDROP_GRAPHIC_SLOT)) throw new Error("Backdrop graphic slot already registered");
  let placed = false;
  const visit = (nodes: readonly PlacementNode[]): PlacementNode[] => nodes.map(node => {
    if ("children" in node) return { ...node, children: visit(node.children) };
    if (node.id !== "imagery-patterns") return node;
    placed = true;
    return { ...node, leaves: [...node.leaves, BACKDROP_GRAPHIC_SLOT] };
  });
  const placements = catalog.placements.map(row => row.layer === "assets" ? { ...row, nodes: visit(row.nodes) } : row);
  if (!placed) throw new Error("Native assets imagery-patterns placement missing");
  return { ...catalog, slots: [...catalog.slots, structuredClone(a276BackdropGraphicSlot)], fills: [...catalog.fills, structuredClone(a276BackdropGraphicFill)], placements };
}
