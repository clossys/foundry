import { readFileSync } from "node:fs";
import { WRITER_LAYERS, isValidWriterLeafId, type WriterLayer } from "../../catalog-core/ids.js";
import { checkWriterLeafSets, loadWriterLeafFreezeSnapshots, type WriterLeafFreezeSnapshot } from "../../catalog-core/leaf-freeze.js";
export type WriterNode = { id: string; label: string } & ({ children: WriterNode[] } | { leaves: string[] });
export interface WriterPlacement { layer: string; status?: string; nodes: WriterNode[] }
export interface WriterSlot { id: string; layer: string; status: string; requires: string[]; contract: Record<string, unknown> }
export interface WriterCatalog { placements: WriterPlacement[]; slots: WriterSlot[] }
export interface WriterIAFinding { code: string; severity: "error"; layer: string; message: string }
export interface WriterIAReport {
  schemaVersion: 1;
  source: "writer";
  leafCounts: Partial<Record<WriterLayer, number>>;
  layers: { layer: WriterLayer; count: number; tree: WriterNode[]; contracts: WriterSlot[]; freeze: { status: "proposed" | "owner-signed" | "unfrozen"; signedHead: string | null; ownerSignoffComment: string | null } }[];
  findings: WriterIAFinding[];
}
/**
 * The old five-layer store (lexicon, strings, patterns, passages, narratives; 137 ids) is retired as live IA
 * (foundry-build-0033): every old ia file is flagged `status: "retired"` and every old id either has a row in
 * `src/catalog/retired.json` or is kept under the same id in the target voice, prose and copy trees. The store
 * stays only so existing records keep validating; the live Writer IA is `loadWriterTrees()` in `target.ts`.
 * Source JSON ships with Writer; the same URL works from src/ and dist/.
 */
export function loadWriterStore(): WriterCatalog {
  const read = (area: "ia" | "slots", layer: WriterLayer): unknown => JSON.parse(readFileSync(new URL(`../../../src/catalog/${area}/${layer}.json`, import.meta.url), "utf8"));
  const placements: WriterPlacement[] = [], slots: WriterSlot[] = [];
  for (const layer of WRITER_LAYERS) {
    const placement = read("ia", layer) as WriterPlacement;
    const contracts = read("slots", layer) as WriterSlot[];
    if (!placement || placement.layer !== layer || !Array.isArray(placement.nodes) || !Array.isArray(contracts) || contracts.some(slot => !slot || slot.layer !== layer)) {
      throw new Error(`Writer IA: invalid ${layer} catalog file shape`);
    }
    placements.push(placement);
    slots.push(...contracts);
  }
  return { placements, slots };
}

/** Old-store ids recorded retired in `src/catalog/retired.json`. */
export function loadWriterRetiredIds(): Set<string> {
  const rows = JSON.parse(readFileSync(new URL("../../../src/catalog/retired.json", import.meta.url), "utf8")) as { id: string }[];
  return new Set(rows.map(row => row.id));
}

/**
 * The live part of the old store: layers not flagged retired and ids with no retired row. Since foundry-build-0033
 * every layer is flagged retired, so this serves no old id; callers that brief or plan Writer work read the target
 * trees instead, and record validators read `loadWriterStore()`.
 */
export function loadWriterCatalog(store: WriterCatalog = loadWriterStore(), retired: ReadonlySet<string> = loadWriterRetiredIds()): WriterCatalog {
  const live = new Set(store.placements.filter(placement => placement.status !== "retired").map(placement => placement.layer));
  return {
    placements: store.placements.filter(placement => live.has(placement.layer)),
    slots: store.slots.filter(slot => live.has(slot.layer) && !retired.has(slot.id)),
  };
}

/** Placement and basic leaf contracts only; record validation belongs to library checks. */
export function writerIAFindings(catalog: WriterCatalog, layers: readonly WriterLayer[]): WriterIAFinding[] {
  const findings: WriterIAFinding[] = [];
  const kinds: Record<WriterLayer, string> = { lexicon: "lexicon", strings: "string", patterns: "pattern", passages: "passage", narratives: "narrative" };
  for (const layer of layers) {
    const fail = (message: string): void => { findings.push({ code: "IA", severity: "error", layer, message }); };
    const slots = catalog.slots.filter(slot => slot.layer === layer);
    const ids = new Set<string>();
    if (!slots.length) fail(`IA: ${layer} has no slots`);
    for (const slot of slots) {
      if (!isValidWriterLeafId(slot.id) || !slot.id.startsWith(`${layer}.`)) fail(`IA: invalid ${layer} slot ${slot.id}`);
      if (ids.has(slot.id)) fail(`IA: duplicate slot ${slot.id}`);
      ids.add(slot.id);
      if (!slot.contract || slot.contract.source !== "writer") fail(`IA: ${slot.id} source must be writer`);
      if (slot.contract?.kind !== kinds[layer]) fail(`IA: ${slot.id} has the wrong record kind`);
    }
    const placements = catalog.placements.filter(placement => placement.layer === layer);
    if (placements.length !== 1) fail(`IA: expected exactly one ${layer} placement`);
    const occurrences = new Map<string, number>(), nodeIds = new Set<string>();
    const visit = (nodes: WriterNode[], depth: number): void => {
      if (!Array.isArray(nodes) || !nodes.length) { fail(`IA: ${layer} has an empty or invalid group`); return; }
      for (const node of nodes) {
        if (!node || typeof node.id !== "string" || typeof node.label !== "string" || !node.label.trim() || depth > 2) {
          fail(`IA: invalid ${layer} grouping node`); continue;
        }
        if (nodeIds.has(node.id)) fail(`IA: duplicate group ${node.id}`);
        nodeIds.add(node.id);
        const hasChildren = "children" in node, hasLeaves = "leaves" in node;
        if (hasChildren === hasLeaves) { fail(`IA: ${node.id} needs exactly one of children or leaves`); continue; }
        if (hasLeaves && "leaves" in node) {
          if (!Array.isArray(node.leaves) || !node.leaves.length) { fail(`IA: ${node.id} has no leaves`); continue; }
          for (const id of node.leaves) {
            occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
            if (!ids.has(id)) fail(`IA: unknown leaf ${id}`);
          }
        } else if ("children" in node) visit(node.children, depth + 1);
      }
    };
    for (const placement of placements) visit(placement.nodes, 1);
    for (const id of ids) if (!occurrences.has(id)) fail(`IA: unplaced slot ${id}`);
    for (const [id, count] of occurrences) if (count !== 1) fail(`IA: ${id} appears ${count} times`);
  }
  return findings;
}

export function createWriterIAReport(catalog: WriterCatalog, layers: readonly WriterLayer[] = WRITER_LAYERS,
  snapshots?: readonly WriterLeafFreezeSnapshot[]): WriterIAReport {
  const findings: WriterIAFinding[] = [...writerIAFindings(catalog, layers), ...checkWriterLeafSets(catalog.placements, catalog.slots, layers, snapshots ? { snapshots } : {})];
  const baselines = snapshots ?? loadWriterLeafFreezeSnapshots();
  const rows = layers.map(layer => {
    const contracts = catalog.slots.filter(slot => slot.layer === layer);
    const snapshot = baselines.find(row => row.layer === layer);
    return {
      layer, count: contracts.length, tree: catalog.placements.find(placement => placement.layer === layer)?.nodes ?? [], contracts,
      freeze: { status: snapshot ? snapshot.signedHead === null ? "proposed" as const : "owner-signed" as const : "unfrozen" as const,
        signedHead: snapshot?.signedHead ?? null, ownerSignoffComment: snapshot?.ownerSignoffComment ?? null },
    };
  });
  return { schemaVersion: 1, source: "writer", leafCounts: Object.fromEntries(rows.map(row => [row.layer, row.count])), layers: rows, findings };
}
