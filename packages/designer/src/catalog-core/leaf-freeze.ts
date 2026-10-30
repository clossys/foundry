import tokens from "../catalog/ia/tokens.leaf-freeze.json" with { type: "json" };
import assets from "../catalog/ia/assets.leaf-freeze.json" with { type: "json" };
import components from "../catalog/ia/components.leaf-freeze.json" with { type: "json" };
import componentAmendments from "../catalog/ia/components.leaf-amendments.json" with { type: "json" };
import draftAssetAmendments from "../catalog/ia/assets.draft-leaf-amendments.json" with { type: "json" };
import assetAmendments from "../catalog/ia/assets.leaf-amendments.json" with { type: "json" };
import tokenAmendments from "../catalog/ia/tokens.leaf-amendments.json" with { type: "json" };
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
// The owner-signed Media amendment adds exactly its listed leaves on top of the signed asset baseline.
if (assetAmendments.schemaVersion !== 1 || assetAmendments.layer !== "assets" ||
    assetAmendments.baseSignedHead !== assets.signedHead ||
    assetAmendments.status !== "owner-signed" ||
    new Set(assetAmendments.addedLeafIds).size !== assetAmendments.addedLeafIds.length ||
    assetAmendments.addedLeafIds.some(id => !id.startsWith("assets.") || assets.leafIds.includes(id))) {
  throw new Error("LEAF_FREEZE: invalid explicit asset amendment");
}
// Draft icon additions do not inherit the separate Media signature.
if (draftAssetAmendments.schemaVersion !== 1 || draftAssetAmendments.layer !== "assets" ||
    draftAssetAmendments.baseSignedHead !== assets.signedHead || draftAssetAmendments.status !== "pending-owner-ratification" ||
    new Set(draftAssetAmendments.addedLeafIds).size !== draftAssetAmendments.addedLeafIds.length ||
    draftAssetAmendments.addedLeafIds.some(id => !id.startsWith("assets.") || assets.leafIds.includes(id) || assetAmendments.addedLeafIds.includes(id))) {
  throw new Error("LEAF_FREEZE: invalid draft asset amendment");
}
// The owner-signed token amendment: every row carries the owner signature; added leaves are new to the signed baseline.
const tokenSignature = "OWNER 2026-10-26T18:03Z ledger #44";
const tokenAddedIds: readonly string[] = Array.isArray(tokenAmendments.addedLeaves) ? tokenAmendments.addedLeaves.map(row => row?.id) : [];
const signedRow = (row: unknown): boolean => row !== null && typeof row === "object" && (row as { signed?: unknown }).signed === tokenSignature && typeof (row as { id?: unknown }).id === "string";
if (tokenAmendments.schemaVersion !== 1 || tokenAmendments.layer !== "tokens" ||
    tokenAmendments.baseSignedHead !== tokens.signedHead ||
    tokenAmendments.status !== "owner-signed" ||
    !Array.isArray(tokenAmendments.addedLeaves) || !tokenAmendments.addedLeaves.length || !Array.isArray(tokenAmendments.recorded) ||
    ![...tokenAmendments.addedLeaves, ...tokenAmendments.recorded].every(signedRow) ||
    new Set(tokenAddedIds).size !== tokenAddedIds.length ||
    tokenAddedIds.some(id => !id.startsWith("tokens.") || tokens.leafIds.includes(id)) ||
    tokenAmendments.recorded.some(row => !tokens.leafIds.includes(row.id))) {
  throw new Error("LEAF_FREEZE: invalid explicit token amendment");
}
// Copy signed IDs plus the explicit versioned additions once, never current slots or IA.
const pending = tokenAmendments.pending;
if (!pending || pending.status !== "pending-owner-ratification" || pending.source !== "workspace#45 A131/A132 AUTO-DECIDED 2026-10-28" ||
    !Array.isArray(pending.addedLeafIds) || pending.addedLeafIds.length !== 1 || pending.addedLeafIds[0] !== "tokens.gradient") {
  throw new Error("LEAF_FREEZE: invalid pending expressive token amendment");
}
const baseline: Readonly<Record<FrozenLeafLayer, ReadonlySet<string>>> = {
  tokens: new Set([...tokens.leafIds, ...tokenAddedIds, ...pending.addedLeafIds]),
  assets: new Set([...assets.leafIds, ...assetAmendments.addedLeafIds, ...draftAssetAmendments.addedLeafIds]),
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
  report?: (finding: LeafFreezeFinding) => void,
): void {
  const findings = checkFrozenLeafSets(placements, slots, layers);
  if (report) { findings.forEach(report); return; }
  if (findings.length) throw new Error(findings.map(finding => finding.message).join("; "));
}
