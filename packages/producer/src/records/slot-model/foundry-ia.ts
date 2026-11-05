/**
 * The Foundry IA as slot-model data (F1/F2). Director, Designer and Writer slot
 * lists are Foundry data read from the installed agent packages; the Publisher IA
 * is consumer data (publication, then collection, then page) built by migrate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadBuildCatalog, type PlacementNode } from "@clossys/designer/catalog";
import { resolveAgent } from "../../agents.js";
import { isAbsent } from "../../errors.js";
import { IA_SCHEMA, type IaDoc, type IaLeafGroup, type IaNode, type ModelAgent, type SlotAgent, type SlotKind, type SlotPosition } from "./types.js";

export interface FoundrySlot {
  readonly id: string;
  readonly kind: SlotKind;
  readonly contract: Readonly<Record<string, unknown>>;
  /** Upstream slot refs the Foundry data declares (Director contract inputs, Writer requires). */
  readonly declaredInputs: readonly string[];
  /** Slots composed or bound by contract (Designer requires and allowed composes). */
  readonly declaredUses: readonly string[];
  /** Downstream slots this slot feeds (Director contract feeds). */
  readonly feeds: readonly string[];
}
export interface FoundryIa { readonly agent: SlotAgent; readonly ia: IaDoc; readonly slots: ReadonlyMap<string, FoundrySlot> }

const readJson = (root: string, path: string): any => JSON.parse(readFileSync(join(root, path), "utf8"));
/** A Foundry data file older agent builds may not ship: undefined when absent; a malformed one surfaces. */
const readOptionalJson = (root: string, path: string): any => {
  let text: string;
  try { text = readFileSync(join(root, path), "utf8"); } catch (error) { if (isAbsent(error)) return undefined; throw error; }
  return JSON.parse(text);
};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const stripAgent = (ref: string) => ref.replace(/^[a-z]+:/, "").replace(/@\d+$/, "");

/** `leaf-freeze:<signed head>`, or `build-unfrozen` when the layer ships no freeze record. */
function leafFreezeRef(root: string, path: string): string {
  const freeze = readOptionalJson(root, path) as { signedHead?: unknown } | undefined;
  if (freeze === undefined) return "build-unfrozen";
  // Unchanged from the prior reader: an unsigned record (no signedHead) yields `leaf-freeze:undefined`,
  // which consumer ia.json files already carry as their source; renaming it is not this unit's scope.
  return `leaf-freeze:${freeze.signedHead}`;
}

export const DESIGNER_LAYERS = ["themes", "assets", "components", "sections", "frames"] as const;
export const WRITER_LAYERS = ["lexicon", "strings", "patterns", "passages", "narratives"] as const;

/** Director: the director catalog (57 slots, 7 L1 / 28 L2). */
export function directorIa(): FoundryIa {
  const root = resolveAgent("director").packageRoot;
  const ia = readJson(root, "src/catalog/ia/strategy.json") as { nodes: { id: string; name: string; children: { id: string; name: string; leaves: string[] }[] }[] };
  const cells = new Map((readJson(root, join("src", "catalog", "cells", "strategy.json")) as { id: string; question: string; mustContain: unknown }[]).map(cell => [cell.id, cell]));
  const freeze = readJson(root, "src/catalog/ia/strategy.leaf-freeze.json") as { frozenAt: string };
  // Older director builds carry no slot contracts: inputs stay undeclared.
  const raw = readOptionalJson(root, "src/slot-contracts/contracts.json") as { slots: { id: string; inputs: string[]; feeds: string[] }[] } | undefined;
  const contracts = new Map<string, { inputs: string[]; feeds: string[] }>((raw?.slots ?? []).map(slot => [slot.id, { inputs: strings(slot.inputs), feeds: strings(slot.feeds) }]));
  const slots = new Map<string, FoundrySlot>();
  const nodes: IaNode[] = ia.nodes.map(node => ({
    id: node.id, label: node.name,
    children: node.children.map(child => ({ id: child.id, label: child.name, slots: [...child.leaves] })),
  }));
  for (const node of nodes) for (const child of node.children) for (const id of child.slots) {
    const cell = cells.get(id), contract = contracts.get(id);
    slots.set(id, {
      id, kind: "brief", contract: { question: cell?.question ?? "", mustContain: cell?.mustContain ?? [] },
      declaredInputs: (contract?.inputs ?? []).map(stripAgent), declaredUses: [], feeds: (contract?.feeds ?? []).map(stripAgent),
    });
  }
  return { agent: "director", ia: { schema: IA_SCHEMA, source: `@clossys/director#leaf-freeze:${freeze.frozenAt}`, extensions: [], nodes }, slots };
}

/** Flatten a placement subtree: groups below L2 fold into their L2 ancestor. */
function leavesOf(node: PlacementNode): string[] {
  return "leaves" in node ? [...node.leaves] : node.children.flatMap(leavesOf);
}

/** Designer: the build catalog placements (themes, assets, components, sections, frames). */
export function designerIa(): FoundryIa {
  const catalog = loadBuildCatalog();
  const root = resolveAgent("designer").packageRoot;
  const ref = leafFreezeRef(root, "src/catalog/ia/themes.leaf-freeze.json");
  const contracts = new Map(catalog.slots.map(slot => [slot.id, slot]));
  const nodes: IaNode[] = [];
  const order = [...catalog.placements].sort((a, b) => DESIGNER_LAYERS.indexOf(a.layer as typeof DESIGNER_LAYERS[number]) - DESIGNER_LAYERS.indexOf(b.layer as typeof DESIGNER_LAYERS[number]));
  for (const placement of order) for (const node of placement.nodes) {
    const children: IaLeafGroup[] = "leaves" in node
      ? [{ id: node.id, label: node.label, slots: [...node.leaves] }]
      : node.children.map(child => ({ id: child.id, label: child.label, slots: leavesOf(child) }));
    nodes.push({ id: `${placement.layer}.${node.id}`, label: node.label, children });
  }
  const slots = new Map<string, FoundrySlot>();
  for (const node of nodes) for (const child of node.children) for (const id of child.slots) {
    const slot = contracts.get(id) as { contract?: Record<string, unknown>; requires?: readonly string[] } | undefined;
    const contract = (slot?.contract ?? {}) as Record<string, unknown>;
    const composes = [...strings(contract.allowedComposes), ...strings(contract.composes)];
    slots.set(id, { id, kind: "element", contract, declaredInputs: [], declaredUses: [...strings(slot?.requires), ...composes], feeds: [] });
  }
  return { agent: "designer", ia: { schema: IA_SCHEMA, source: `@clossys/designer#${ref}`, extensions: [], nodes }, slots };
}

/** Writer: the five Writer IA layers (136 leaves); a slot is one Writer leaf (D5). */
export function writerIa(): FoundryIa {
  const root = resolveAgent("writer").packageRoot;
  const ref = leafFreezeRef(root, "src/catalog/ia/strings.leaf-freeze.json");
  type WriterNode = { id: string; label: string; children?: WriterNode[]; leaves?: string[] };
  const flat = (node: WriterNode): string[] => node.leaves ? [...node.leaves] : (node.children ?? []).flatMap(flat);
  const nodes: IaNode[] = [];
  const slots = new Map<string, FoundrySlot>();
  for (const layer of WRITER_LAYERS) {
    const placement = readJson(root, `src/catalog/ia/${layer}.json`) as { nodes: WriterNode[] };
    const contracts = new Map((readJson(root, `src/catalog/slots/${layer}.json`) as { id: string; contract: Record<string, unknown>; requires: string[] }[]).map(slot => [slot.id, slot]));
    for (const node of placement.nodes) {
      const children: IaLeafGroup[] = node.leaves
        ? [{ id: node.id, label: node.label, slots: [...node.leaves] }]
        : (node.children ?? []).map(child => ({ id: child.id, label: child.label, slots: flat(child) }));
      nodes.push({ id: `${layer}.${node.id}`, label: node.label, children });
      for (const child of children) for (const id of child.slots) {
        const slot = contracts.get(id);
        slots.set(id, { id, kind: "strings", contract: slot?.contract ?? {}, declaredInputs: strings(slot?.requires).map(stripAgent), declaredUses: [], feeds: [] });
      }
    }
  }
  return { agent: "writer", ia: { schema: IA_SCHEMA, source: `@clossys/writer#${ref}`, extensions: [], nodes }, slots };
}

/** Slot -> its IA position (L0 for layered agents, L1, L2, order in IA order). */
/** Each placed folder id (a slot, or a seat in the Producer tree) and its IA position. */
export function slotPositions(agent: ModelAgent, ia: IaDoc): Map<string, SlotPosition> {
  const positions = new Map<string, SlotPosition>();
  let order = 0;
  for (const node of ia.nodes) for (const child of node.children) for (const slot of child.slots) {
    const l0 = agent === "designer" || agent === "writer" ? node.id.split(".")[0] : undefined;
    positions.set(slot, { ...(l0 ? { l0 } : {}), l1: node.id, l2: child.id, order: order++ });
  }
  return positions;
}

/** Add owner-signed consumer extensions under one `<l0>.extensions` L1 per layer. */
export function withExtensions(agent: SlotAgent, base: IaDoc, extensions: readonly string[]): IaDoc {
  const placed = new Set(base.nodes.flatMap(node => node.children.flatMap(child => child.slots)));
  const extra = [...new Set(extensions)].filter(id => !placed.has(id)).sort();
  if (!extra.length) return { ...base, extensions: [] };
  const byLayer = new Map<string, string[]>();
  for (const id of extra) {
    const layer = agent === "designer" || agent === "writer" ? id.split(".")[0]! : "consumer";
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), id]);
  }
  const nodes = [...base.nodes, ...[...byLayer].map(([layer, slots]) => ({
    id: `${layer}.extensions`, label: "Consumer extensions",
    children: [{ id: "extensions", label: "Signed extensions", slots }],
  }))];
  return { ...base, extensions: extra, nodes };
}
