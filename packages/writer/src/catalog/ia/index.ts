import { readFileSync } from "node:fs";
import { WRITER_LAYERS, isValidWriterLeafId, type WriterLayer } from "../../catalog-core/ids.js";
import { checkWriterLeafSets, loadWriterLeafFreezeSnapshots, type WriterLeafFreezeSnapshot } from "../../catalog-core/leaf-freeze.js";
export type WriterNode = { id: string; label: string } & ({ children: WriterNode[] } | { leaves: string[] });
export interface WriterPlacement { layer: string; nodes: WriterNode[] }
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
/** Source JSON ships with Writer; the same URL works from src/ and dist/. */
export function loadWriterCatalog(): WriterCatalog {
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
  snapshots: readonly WriterLeafFreezeSnapshot[] = loadWriterLeafFreezeSnapshots()): WriterIAReport {
  const findings: WriterIAFinding[] = [...writerIAFindings(catalog, layers), ...checkWriterLeafSets(catalog.placements, catalog.slots, layers, { snapshots })];
  const rows = layers.map(layer => {
    const contracts = catalog.slots.filter(slot => slot.layer === layer);
    const snapshot = snapshots.find(row => row.layer === layer);
    return {
      layer, count: contracts.length, tree: catalog.placements.find(placement => placement.layer === layer)?.nodes ?? [], contracts,
      freeze: { status: snapshot ? snapshot.signedHead === null ? "proposed" as const : "owner-signed" as const : "unfrozen" as const,
        signedHead: snapshot?.signedHead ?? null, ownerSignoffComment: snapshot?.ownerSignoffComment ?? null },
    };
  });
  return { schemaVersion: 1, source: "writer", leafCounts: Object.fromEntries(rows.map(row => [row.layer, row.count])), layers: rows, findings };
}
