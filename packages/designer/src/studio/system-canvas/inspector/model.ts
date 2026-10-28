import type { Placement, PlacementNode } from "../../../catalog-core/index.js";
import type { InspectorFill, InspectorIdentity } from "./types.js";
/** Look up today's IA labels; the permanent leaf id is never a cached group path. */
export function identityFor(placements: readonly Placement[], leaf: string, fill: InspectorFill = {}): InspectorIdentity {
  const visit = (node: PlacementNode, path: readonly string[]): readonly string[] | undefined => {
    const next = [...path, node.label];
    return "leaves" in node ? node.leaves.includes(leaf) ? next : undefined : node.children.map(child => visit(child, next)).find(Boolean);
  };
  for (const placement of placements) for (const node of placement.nodes) {
    const path = visit(node, []);
    if (path) return { id: leaf, layer: placement.layer, path, status: fill.status ?? "draft", fill };
  }
  return { id: leaf, layer: "", path: [], status: fill.status ?? "draft", fill };
}
