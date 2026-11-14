/**
 * The Foundry IA as slot-model data (F1/F2). Director, Designer and Writer slot
 * lists are Foundry data read from the installed agent packages; the Publisher IA
 * is consumer data (publication, then collection, then page) built by migrate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadBuildCatalog, type PlacementNode } from "@clossys/designer/catalog";
import { resolveAgent } from "../../agents.js";
import { PRODUCER_ROOT } from "../../package-path.js";
import { isAbsent } from "../../errors.js";
import { DESIGN_BRIEF_INPUTS } from "./design-brief-inputs.js";
import { IA_SCHEMA, type IaAxes, type IaDoc, type IaLayer, type IaLeafGroup, type IaNode, type ModelAgent, type SlotAgent, type SlotKind, type SlotPosition } from "./types.js";

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
  /** The package's per-slot defaults (src/catalog/slot-defaults.json): its standard and any non-derived inputs. */
  readonly defaults: SlotDefaults;
}
/** One slot's row in a package's src/catalog/slot-defaults.json (schema clossys.slot-defaults/1). */
export interface SlotDefaults {
  /** The standard that judges the slot. */
  readonly standard?: string;
  /** The slot's inputs, in order, where the read graph does not derive them; unset means derived. */
  readonly inputs?: readonly string[];
}
export const SLOT_DEFAULTS_SCHEMA = "clossys.slot-defaults/1";
export const SLOT_DEFAULTS_FILE = "src/catalog/slot-defaults.json";
export interface FoundryIa { readonly agent: SlotAgent; readonly ia: IaDoc; readonly slots: ReadonlyMap<string, FoundrySlot> }

const readJson = (root: string, path: string): any => JSON.parse(readFileSync(join(root, path), "utf8"));
/** A Foundry data file older agent builds may not ship: undefined when absent; a malformed one surfaces. */
const readOptionalJson = (root: string, path: string): any => {
  let text: string;
  try { text = readFileSync(join(root, path), "utf8"); } catch (error) { if (isAbsent(error)) return undefined; throw error; }
  return JSON.parse(text);
};
/** A package's per-slot defaults; empty when an older agent build ships none, a malformed file surfaces. */
export function readSlotDefaults(root: string, agent: SlotAgent): ReadonlyMap<string, SlotDefaults> {
  const doc = readOptionalJson(root, SLOT_DEFAULTS_FILE) as { schema?: unknown; agent?: unknown; slots?: unknown } | undefined;
  if (doc === undefined) return new Map();
  if (doc.schema !== SLOT_DEFAULTS_SCHEMA || doc.agent !== agent || !doc.slots || typeof doc.slots !== "object") throw new Error(`${agent} ${SLOT_DEFAULTS_FILE}: expected ${SLOT_DEFAULTS_SCHEMA} for ${agent}`);
  const out = new Map<string, SlotDefaults>();
  for (const [id, row] of Object.entries(doc.slots as Record<string, { standard?: unknown; inputs?: unknown }>)) {
    if (row.standard !== undefined && typeof row.standard !== "string") throw new Error(`${agent} ${SLOT_DEFAULTS_FILE}: ${id} standard must be a string`);
    if (row.inputs !== undefined && !(Array.isArray(row.inputs) && row.inputs.every(item => typeof item === "string"))) throw new Error(`${agent} ${SLOT_DEFAULTS_FILE}: ${id} inputs must be slot ids`);
    out.set(id, { ...(row.standard !== undefined ? { standard: row.standard as string } : {}), ...(row.inputs !== undefined ? { inputs: [...row.inputs as string[]] } : {}) });
  }
  return out;
}
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
  const ia = readJson(root, "src/catalog/ia/strategy.json") as { nodes: { id: string; name: string; children: { id: string; name: string; leaves: string[] }[] }[]; layers?: IaLayer[]; axes?: IaAxes };
  const cells = new Map((readJson(root, join("src", "catalog", "cells", "strategy.json")) as { id: string; question: string; mustContain: unknown }[]).map(cell => [cell.id, cell]));
  const freeze = readJson(root, "src/catalog/ia/strategy.leaf-freeze.json") as { frozenAt: string };
  // Older director builds carry no slot contracts: inputs stay undeclared.
  const raw = readOptionalJson(root, "src/slot-contracts/contracts.json") as { fixture?: Record<string, unknown>; slots: { id: string; inputs: string[]; feeds: string[] }[] } | undefined;
  const contracts = new Map<string, { inputs: string[]; feeds: string[] }>((raw?.slots ?? []).map(slot => [slot.id, { inputs: strings(slot.inputs), feeds: strings(slot.feeds) }]));
  const slots = new Map<string, FoundrySlot>();
  const defaults = readSlotDefaults(root, "director");
  const nodes: IaNode[] = ia.nodes.map(node => ({
    id: node.id, label: node.name,
    children: node.children.map(child => ({ id: child.id, label: child.name, slots: [...child.leaves] })),
  }));
  for (const node of nodes) for (const child of node.children) for (const id of child.slots) {
    const cell = cells.get(id), contract = contracts.get(id);
    slots.set(id, {
      // The brief fixture (DIR-CERT: Direction, Because, Watch) is the package default for every Director contract.
      id, kind: "brief", contract: { question: cell?.question ?? "", mustContain: cell?.mustContain ?? [], ...(raw?.fixture ? { fixture: raw.fixture } : {}) },
      declaredInputs: (contract?.inputs ?? []).map(stripAgent), declaredUses: [], feeds: (contract?.feeds ?? []).map(stripAgent),
      defaults: defaults.get(id) ?? {},
    });
  }
  // The owner-decided L0 layers and axes (2026-11-13 IA review) are package data: every consumer IA levels by them.
  const levels = { ...(ia.layers ? { layers: ia.layers } : {}), ...(ia.axes ? { axes: ia.axes } : {}) };
  return { agent: "director", ia: { schema: IA_SCHEMA, source: `@clossys/director#leaf-freeze:${freeze.frozenAt}`, extensions: [], nodes, ...levels }, slots };
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
  // The read graph: every Designer decision reads the Designer brief's Director slots, and each
  // slot contract names the theme and asset slots its element reads.
  const reads = new Map<string, string[]>();
  for (const layer of DESIGNER_LAYERS) {
    let rows: { slot: string; inputs?: { name: string; kind: string }[] }[] = [];
    try { rows = readJson(root, `src/catalog/slot-contracts/${layer}.json`) as typeof rows; } catch (error) {
      // Older designer builds carry no slot contracts file for a layer; a present but unreadable one is an error.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const row of rows) reads.set(row.slot, (row.inputs ?? []).filter(input => input.kind === "theme" || input.kind === "asset").map(input => input.name));
  }
  const brief = DESIGN_BRIEF_INPUTS.map(([, id]) => id as string);
  const slots = new Map<string, FoundrySlot>();
  const defaults = readSlotDefaults(root, "designer");
  for (const node of nodes) for (const child of node.children) for (const id of child.slots) {
    const slot = contracts.get(id) as { contract?: Record<string, unknown>; requires?: readonly string[] } | undefined;
    const contract = (slot?.contract ?? {}) as Record<string, unknown>;
    const composes = [...strings(contract.allowedComposes), ...strings(contract.composes)];
    const declaredInputs = [...new Set([...brief, ...(reads.get(id) ?? []).filter(input => input !== id)])].sort();
    slots.set(id, { id, kind: "element", contract, declaredInputs, declaredUses: [...strings(slot?.requires), ...composes], feeds: [], defaults: defaults.get(id) ?? {} });
  }
  for (const extra of studioDesignerSlots()) {
    let node = nodes.find(candidate => candidate.id === extra.l1.id);
    if (!node) { node = { id: extra.l1.id, label: extra.l1.label, children: [] }; nodes.push(node); }
    let group = node.children.find(candidate => candidate.id === extra.l2.id) as { id: string; label: string; slots: string[] } | undefined;
    if (!group) { group = { id: extra.l2.id, label: extra.l2.label, slots: [] }; (node.children as IaLeafGroup[]).push(group); }
    const at = extra.after === null ? -1 : group.slots.indexOf(extra.after);
    group.slots.splice(at === -1 ? (extra.after === null ? 0 : group.slots.length) : at + 1, 0, extra.id);
    slots.set(extra.id, { id: extra.id, kind: extra.kind, contract: extra.contract, declaredInputs: [...brief].sort(), declaredUses: [...extra.uses], feeds: [], defaults: { standard: extra.standard } });
  }
  return { agent: "designer", ia: { schema: IA_SCHEMA, source: `@clossys/designer#${ref}`, extensions: [], nodes }, slots };
}

/** One Designer slot the Studio publication defines (src/studio-defaults/designer-slots.json). */
interface StudioDesignerSlot {
  readonly id: string; readonly standard: string; readonly l1: { id: string; label: string }; readonly l2: { id: string; label: string };
  readonly after: string | null; readonly kind: SlotKind; readonly uses: readonly string[]; readonly contract: Record<string, unknown>;
}
/**
 * The Designer slots the Studio publication (this package) defines on top of the Designer catalog:
 * package leaves like the catalog's own, placed in their L1/L2 group after the slot they name (or at
 * the group end when it is not placed). The Designer leaf freezes do not list them.
 */
export function studioDesignerSlots(): readonly StudioDesignerSlot[] {
  const doc = JSON.parse(readFileSync(join(PRODUCER_ROOT, "src", "studio-defaults", "designer-slots.json"), "utf8")) as { schema: string; agent: string; slots: StudioDesignerSlot[] };
  if (doc.schema !== "clossys.package-slots/1" || doc.agent !== "designer" || !Array.isArray(doc.slots) || doc.slots.some(slot => typeof slot.standard !== "string")) throw new Error("studio-defaults/designer-slots.json: unexpected shape");
  return doc.slots;
}

/** Writer: the five Writer IA layers (136 leaves); a slot is one Writer leaf (D5). */
export function writerIa(): FoundryIa {
  const root = resolveAgent("writer").packageRoot;
  const ref = leafFreezeRef(root, "src/catalog/ia/strings.leaf-freeze.json");
  type WriterNode = { id: string; label: string; children?: WriterNode[]; leaves?: string[] };
  const flat = (node: WriterNode): string[] => node.leaves ? [...node.leaves] : (node.children ?? []).flatMap(flat);
  const nodes: IaNode[] = [];
  const slots = new Map<string, FoundrySlot>();
  const defaults = readSlotDefaults(root, "writer");
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
        slots.set(id, { id, kind: "strings", contract: slot?.contract ?? {}, declaredInputs: strings(slot?.requires).map(stripAgent), declaredUses: [], feeds: [], defaults: defaults.get(id) ?? {} });
      }
    }
  }
  return { agent: "writer", ia: { schema: IA_SCHEMA, source: `@clossys/writer#${ref}`, extensions: [], nodes }, slots };
}

/**
 * Each L1 node's L0, for every agent. An IA that declares its axes (R01.7, `axes`) and its `layers`
 * reads each layer as an L0: a node's L0 is the first layer that lists it (`<l1>` or `<l1>/<l2>`),
 * the way the R01 checks read it (constitution/rules/r01-ia.ts iaView). Without declared axes the
 * layers stay display-only (IaDoc.layers), and only Designer and Writer have an L0: the prefix of
 * their dotted node ids (`themes.colors` is in `themes`). Declaring the axes (`clossys ia <agent>
 * --axes`) is therefore the write that re-levels every slot.json of a layered agent.
 */
export function nodeLayers(agent: ModelAgent, ia: IaDoc): Map<string, string> {
  const layers = new Map<string, string>();
  if (ia.axes !== undefined && ia.layers?.length) {
    for (const layer of ia.layers) for (const ref of layer.nodes) {
      const l1 = ref.split("/")[0]!;
      if (!layers.has(l1)) layers.set(l1, layer.id);
    }
    return layers;
  }
  if (agent === "designer" || agent === "writer") for (const node of ia.nodes) layers.set(node.id, node.id.split(".")[0]!);
  return layers;
}

/** Each placed folder id (a slot, or a seat in the Producer tree) and its IA position (L0 per nodeLayers, L1, L2, order in IA order). */
export function slotPositions(agent: ModelAgent, ia: IaDoc): Map<string, SlotPosition> {
  const positions = new Map<string, SlotPosition>();
  const layers = nodeLayers(agent, ia);
  let order = 0;
  for (const node of ia.nodes) for (const child of node.children) for (const slot of child.slots) {
    const l0 = layers.get(node.id);
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
