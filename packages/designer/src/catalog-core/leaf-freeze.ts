import tokens from "../catalog/ia/tokens.leaf-freeze.json" with { type: "json" };
import assets from "../catalog/ia/assets.leaf-freeze.json" with { type: "json" };
import components from "../catalog/ia/components.leaf-freeze.json" with { type: "json" };
import componentAmendments from "../catalog/ia/components.leaf-amendments.json" with { type: "json" };
import type { Placement, PlacementNode } from "./types.js";

export type FrozenLeafLayer = "tokens" | "assets" | "components";

/** Leaf membership only: grouping, contracts, role metadata and readiness are separate. */
export interface LeafFreezeFinding {
  code: "LEAF_FREEZE";
  severity: "error";
  layer: FrozenLeafLayer;
  source: "slots" | "ia";
  missing: readonly string[];
  unexpected: readonly string[];
  message: string;
}

// Explicit local additions do not alter or ratify the original signed baseline.
if (componentAmendments.schemaVersion !== 1 || componentAmendments.layer !== "components" ||
    componentAmendments.baseSignedHead !== components.signedHead ||
    componentAmendments.status !== "pending-owner-ratification" ||
    new Set(componentAmendments.addedLeafIds).size !== componentAmendments.addedLeafIds.length ||
    componentAmendments.addedLeafIds.some(id => !id.startsWith("components.") || components.leafIds.includes(id))) {
  throw new Error("LEAF_FREEZE: invalid explicit component amendment");
}
// Copy signed IDs plus the explicit versioned additions once, never current slots or IA.
const baseline: Readonly<Record<FrozenLeafLayer, ReadonlySet<string>>> = {
  tokens: new Set(tokens.leafIds),
  assets: new Set(assets.leafIds),
  components: new Set([...components.leafIds, ...componentAmendments.addedLeafIds]),
};
const leaves = (nodes: readonly PlacementNode[]): string[] => nodes.flatMap(node => "leaves" in node ? node.leaves : leaves(node.children));

/** Compare both source sets with signed IDs and explicit local amendments, independently of placement or each other.
 * Callers must name the layers they offer, so an entirely missing layer still fails.
 * IA1/IA2 remain responsible for placement structure and uniqueness.
 */
export function checkFrozenLeafSets(
  placements: readonly Placement[],
  slots: readonly { id: string; layer: string }[],
  layers: readonly FrozenLeafLayer[],
): LeafFreezeFinding[] {
  const findings: LeafFreezeFinding[] = [];
  for (const layer of layers) {
    const expected = baseline[layer];
    const actual = {
      slots: new Set(slots.filter(slot => slot.layer === layer).map(slot => slot.id)),
      ia: new Set(placements.filter(placement => placement.layer === layer).flatMap(placement => leaves(placement.nodes))),
    };
    for (const source of ["slots", "ia"] as const) {
      const missing = [...expected].filter(id => !actual[source].has(id)).sort();
      const unexpected = [...actual[source]].filter(id => !expected.has(id)).sort();
      if (missing.length || unexpected.length) findings.push({
        code: "LEAF_FREEZE", severity: "error", layer, source, missing, unexpected,
        message: `LEAF_FREEZE: ${layer} ${source} differs from signed leaf IDs and explicit amendments (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`,
      });
    }
  }
  return findings;
}

/** Source-loader guard; deliberately separate from runtime fill findings. */
export function assertFrozenLeafSets(
  placements: readonly Placement[],
  slots: readonly { id: string; layer: string }[],
  layers: readonly FrozenLeafLayer[],
): void {
  const findings = checkFrozenLeafSets(placements, slots, layers);
  if (findings.length) throw new Error(findings.map(finding => finding.message).join("; "));
}
