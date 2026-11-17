/**
 * The Producer slot tree (producer.md 1): three layers, the loops, the queues and the ledgers, each `L1 > L2 > L3`
 * with the slot ids as leaves. Package data in `src/catalog/ia/{loops,queue,ledger}.json`; every leaf is a loop name,
 * a queue name or the ledger of one loop, so the tree, the runner and `loop.reachable` read the same names.
 *
 * The int2 seat tree (records/slot-model producerIa, pipeline/seats.json) stays until the stage verbs retire.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCER_ROOT } from "../package-path.js";
import { QUEUE_NAMES } from "../queue/entry.js";
import { LOOP_NAMES, ledgerOf } from "./names.js";

export const PRODUCER_LAYERS = ["loops", "queue", "ledger"] as const;
export type ProducerLayer = (typeof PRODUCER_LAYERS)[number];

export interface ProducerIaLeafPosition { readonly layer: ProducerLayer; readonly l1: string; readonly l2: string; readonly order: number }
export interface ProducerIaLayer {
  readonly layer: ProducerLayer;
  readonly nodes: readonly { readonly id: string; readonly label: string; readonly children: readonly { readonly id: string; readonly label: string; readonly leaves: readonly string[] }[] }[];
}

export const producerIaFile = (layer: ProducerLayer): string => join(PRODUCER_ROOT, "src", "catalog", "ia", `${layer}.json`);

export function readProducerIa(): ProducerIaLayer[] {
  return PRODUCER_LAYERS.map(layer => {
    const doc = JSON.parse(readFileSync(producerIaFile(layer), "utf8")) as ProducerIaLayer;
    if (doc.layer !== layer) throw new Error(`${producerIaFile(layer)}: layer is ${String(doc.layer)}, not ${layer}`);
    return doc;
  });
}

/** Every leaf with its place (`ia.l0` = layer, `l1`, `l2`, `order` within its L2). */
export function producerSlotPositions(layers: readonly ProducerIaLayer[] = readProducerIa()): Map<string, ProducerIaLeafPosition> {
  const out = new Map<string, ProducerIaLeafPosition>();
  for (const layer of layers) for (const node of layer.nodes) for (const child of node.children) {
    child.leaves.forEach((leaf, order) => {
      if (out.has(leaf)) throw new Error(`producer IA: ${leaf} is placed twice`);
      out.set(leaf, { layer: layer.layer, l1: node.id, l2: child.id, order });
    });
  }
  return out;
}

/** The leaves each layer must hold, exactly: the six loops, the four queues, one ledger per loop. */
export const PRODUCER_LEAVES: Readonly<Record<ProducerLayer, readonly string[]>> = {
  loops: LOOP_NAMES,
  queue: QUEUE_NAMES,
  ledger: LOOP_NAMES.map(ledgerOf),
};

/** Reasons the tree does not match the runner's names; empty when it does. */
export function producerIaIssues(layers: readonly ProducerIaLayer[] = readProducerIa()): string[] {
  const issues: string[] = [];
  let positions: Map<string, ProducerIaLeafPosition>;
  try { positions = producerSlotPositions(layers); } catch (error) { return [(error as Error).message]; }
  for (const layer of PRODUCER_LAYERS) {
    const placed = [...positions].filter(([, at]) => at.layer === layer).map(([leaf]) => leaf).sort();
    const want = [...PRODUCER_LEAVES[layer]].sort();
    for (const leaf of want) if (!placed.includes(leaf)) issues.push(`producer IA ${layer}: ${leaf} is not placed`);
    for (const leaf of placed) if (!want.includes(leaf)) issues.push(`producer IA ${layer}: ${leaf} is not a ${layer} slot`);
  }
  return issues;
}
