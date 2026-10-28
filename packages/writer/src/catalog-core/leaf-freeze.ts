import { readFileSync } from "node:fs";
import { isValidWriterLeafId, isWriterLayer, type WriterLayer } from "./ids.js";

/** Only these layers currently have proposed leaf membership snapshots. */
export const WRITER_LEAF_FREEZE_LAYERS = ["lexicon", "strings", "patterns"] as const;
export type WriterLeafFreezeLayer = typeof WRITER_LEAF_FREEZE_LAYERS[number];

export interface WriterLeafFreezeSnapshot {
  schemaVersion: 1;
  layer: WriterLeafFreezeLayer;
  scope: "leaf-membership-only";
  signedHead: string | null;
  ownerSignoffComment: string | null;
  policy: string;
  leafIds: readonly string[];
}

/** An addition authorizes only its explicit IDs against an already signed baseline. */
export interface WriterLeafAmendment {
  schemaVersion: 1;
  layer: WriterLeafFreezeLayer;
  baseSignedHead: string;
  status: "owner-signed";
  ownerSignoffComment: string;
  addedLeafIds: readonly string[];
}

export type WriterLeafPlacementNode =
  | { id: string; label: string; children: readonly WriterLeafPlacementNode[] }
  | { id: string; label: string; leaves: readonly string[] };

export interface WriterLeafPlacement {
  layer: string;
  nodes: readonly WriterLeafPlacementNode[];
}

export interface WriterLeafFreezeFinding {
  code: "LEAF_FREEZE";
  severity: "error";
  layer: WriterLeafFreezeLayer;
  source: "slots" | "ia";
  missing: readonly string[];
  unexpected: readonly string[];
  message: string;
}

/** Explicit injection supports independently supplied proposals and signed amendments. */
export interface WriterLeafFreezeOptions {
  snapshots?: readonly unknown[];
  amendments?: readonly unknown[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isFreezeLayer = (value: unknown): value is WriterLeafFreezeLayer => WRITER_LEAF_FREEZE_LAYERS.some(layer => layer === value);
const validHead = (value: unknown): value is string => typeof value === "string" && value.length === 40 && /^[a-f0-9]{40}$/i.test(value);
const leafIdsFor = (value: unknown, layer: WriterLeafFreezeLayer): value is string[] => Array.isArray(value) && value.length > 0 &&
  value.every(id => isValidWriterLeafId(id) && id.startsWith(`${layer}.`)) && new Set(value).size === value.length;

function snapshotFrom(value: unknown): WriterLeafFreezeSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isFreezeLayer(value.layer) ||
      value.scope !== "leaf-membership-only" || !nonempty(value.policy) || !leafIdsFor(value.leafIds, value.layer) ||
      !((value.signedHead === null && value.ownerSignoffComment === null) ||
        (validHead(value.signedHead) && nonempty(value.ownerSignoffComment)))) {
    throw new Error("LEAF_FREEZE: invalid Writer membership snapshot; candidate proposals must remain unsigned until a valid signed head and owner signoff are supplied together");
  }
  return value as unknown as WriterLeafFreezeSnapshot;
}

/** Read versioned proposals, never derive the baseline from current slots or IA.
 * The package ships src/, so this URL works from src/catalog-core and dist/catalog-core.
 * Null signatures describe candidate membership only, without owner approval.
 */
export function loadWriterLeafFreezeSnapshots(): readonly WriterLeafFreezeSnapshot[] {
  return WRITER_LEAF_FREEZE_LAYERS.map(layer => {
    const value: unknown = JSON.parse(readFileSync(new URL(`../../src/catalog/ia/${layer}.leaf-freeze.json`, import.meta.url), "utf8"));
    const snapshot = snapshotFrom(value);
    if (snapshot.layer !== layer) throw new Error(`LEAF_FREEZE: Writer ${layer} candidate file names a different layer`);
    return snapshot;
  });
}

function baselines(options: WriterLeafFreezeOptions): Map<WriterLeafFreezeLayer, { snapshot: WriterLeafFreezeSnapshot; ids: Set<string> }> {
  const result = new Map<WriterLeafFreezeLayer, { snapshot: WriterLeafFreezeSnapshot; ids: Set<string> }>();
  for (const value of options.snapshots ?? loadWriterLeafFreezeSnapshots()) {
    const snapshot = snapshotFrom(value);
    if (result.has(snapshot.layer)) throw new Error(`LEAF_FREEZE: duplicate Writer ${snapshot.layer} membership snapshot`);
    result.set(snapshot.layer, { snapshot, ids: new Set(snapshot.leafIds) });
  }
  for (const value of options.amendments ?? []) {
    if (!isRecord(value) || value.schemaVersion !== 1 || !isFreezeLayer(value.layer) ||
        value.status !== "owner-signed" || !nonempty(value.ownerSignoffComment) ||
        !validHead(value.baseSignedHead) || !leafIdsFor(value.addedLeafIds, value.layer)) {
      throw new Error("LEAF_FREEZE: invalid explicit Writer amendment; signed additions require owner signoff and valid unique leaf IDs");
    }
    const baseline = result.get(value.layer);
    if (!baseline || baseline.snapshot.signedHead === null || value.baseSignedHead !== baseline.snapshot.signedHead ||
        value.addedLeafIds.some(id => baseline.ids.has(id))) {
      throw new Error(`LEAF_FREEZE: invalid explicit Writer ${value.layer} amendment; require a matching signed baseline and new IDs`);
    }
    for (const id of value.addedLeafIds) baseline.ids.add(id);
  }
  return result;
}

const leaves = (nodes: readonly WriterLeafPlacementNode[]): string[] => nodes.flatMap(node => "leaves" in node ? [...node.leaves] : leaves(node.children));

/** Compare both independent source sets to versioned candidate or signed membership.
 * Callers explicitly name offered layers so an entirely missing source still fails.
 * Labels, grouping, order, metadata and structural uniqueness are separate checks.
 * Passages and narratives remain unfrozen and receive no inferred baseline.
 */
export function checkWriterLeafSets(
  placements: readonly WriterLeafPlacement[],
  slots: readonly { id: string; layer: string }[],
  layers: readonly WriterLayer[],
  options: WriterLeafFreezeOptions = {},
): WriterLeafFreezeFinding[] {
  const expected = baselines(options);
  const findings: WriterLeafFreezeFinding[] = [];
  for (const layer of new Set(layers)) {
    if (!isWriterLayer(layer)) throw new Error("LEAF_FREEZE: invalid offered Writer layer");
    if (!isFreezeLayer(layer)) continue;
    const baseline = expected.get(layer);
    if (!baseline) throw new Error(`LEAF_FREEZE: missing Writer ${layer} candidate or signed membership snapshot`);
    const actual = {
      slots: new Set(slots.filter(slot => slot.layer === layer).map(slot => slot.id)),
      ia: new Set(placements.filter(placement => placement.layer === layer).flatMap(placement => leaves(placement.nodes))),
    };
    const status = baseline.snapshot.signedHead === null ? "unsigned candidate leaf IDs (owner approval pending)" : "signed leaf IDs and explicit owner-signed amendments";
    for (const source of ["slots", "ia"] as const) {
      const missing = [...baseline.ids].filter(id => !actual[source].has(id)).sort();
      const unexpected = [...actual[source]].filter(id => !baseline.ids.has(id)).sort();
      if (missing.length || unexpected.length) findings.push({
        code: "LEAF_FREEZE", severity: "error", layer, source, missing, unexpected,
        message: `LEAF_FREEZE: ${layer} ${source} differs from ${status} (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`,
      });
    }
  }
  return findings;
}

/** Loader assertion, separate from content, voice and copy findings. */
export function assertWriterLeafSets(
  placements: readonly WriterLeafPlacement[],
  slots: readonly { id: string; layer: string }[],
  layers: readonly WriterLayer[],
  options: WriterLeafFreezeOptions = {},
): void {
  const findings = checkWriterLeafSets(placements, slots, layers, options);
  if (findings.length) throw new Error(findings.map(finding => finding.message).join("\n"));
}
