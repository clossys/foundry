/**
 * The Foundry IA as slot-model data (F1/F2). Director, Designer and Writer slot
 * lists are Foundry data read from the installed agent packages (Writer: its Voice, Prose and Copy trees); the Publisher IA
 * is consumer data (publication, then collection, then page) built by migrate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadBuildCatalog, type PlacementNode } from "@clossys/designer/catalog";
import { resolveAgent } from "../../agents.js";
import { composedSlots } from "../../specimen/composed-slots.js";
import { PRODUCER_ROOT } from "../../package-path.js";
import { isAbsent } from "../../errors.js";
import { DESIGN_BRIEF_INPUTS } from "./design-brief-inputs.js";
import { packageIaSource } from "./ia-source.js";
import { PRODUCER_IA_SOURCE, readPipelineSeats } from "./pipeline-seats.js";
import type { TargetSlotKind } from "../types.js";
import { IA_SCHEMA, type IaAxes, type IaDoc, type IaLayer, type IaLeafGroup, type IaNode, type ModelAgent, type SlotAgent, type SlotKind, type SlotPosition } from "./types.js";
import { LOOPS_L0 } from "../../loop/agent-loops-ia.js";

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
  /** The package's per-slot defaults (`@clossys/<agent>/src/catalog/slot-defaults.json`): its standard and any non-derived inputs. */
  readonly defaults: SlotDefaults;
  /** The clossys.slot/2 kind the package tree names (Writer voice, prose, copy); `kind` is its slot/1 family. */
  readonly targetKind?: TargetSlotKind;
  /** The package tree's own refs (`<agent>/<id>`, rel, key), in order: a clossys.slot/2 slot takes them as written. */
  readonly refs?: readonly { readonly to: string; readonly rel: string; readonly key?: string }[];
  /**
   * Contract keys the package leaves to the consumer (FCR): a composed Designer section or frame slot (no reference
   * adoptable in the selected style and engine) takes its `fixture`, and the `props` that type it, from its own pinned,
   * certified composition, so `ia sync` keeps them and compares the rest.
   */
  readonly consumerOwned?: readonly string[];
}
/** One slot's row in a package's `@clossys/<agent>/src/catalog/slot-defaults.json` (schema clossys.slot-defaults/1). */
export interface SlotDefaults {
  /** The standard that judges the slot. */
  readonly standard?: string;
  /** The slot's inputs, in order, where the read graph does not derive them; unset means derived. */
  readonly inputs?: readonly string[];
}
export const SLOT_DEFAULTS_SCHEMA = "clossys.slot-defaults/1";
export const SLOT_DEFAULTS_FILE = "src/catalog/slot-defaults.json";
export interface FoundryIa { readonly agent: ModelAgent; readonly ia: IaDoc; readonly slots: ReadonlyMap<string, FoundrySlot> }

const readJson = (root: string, path: string): any => JSON.parse(readFileSync(join(root, path), "utf8"));
/** A Foundry data file older agent builds may not ship: undefined when absent; a malformed one surfaces. */
const readOptionalJson = (root: string, path: string): any => {
  let text: string;
  try { text = readFileSync(join(root, path), "utf8"); } catch (error) { if (isAbsent(error)) return undefined; throw error; }
  return JSON.parse(text);
};
/** A package's per-slot defaults; empty when an older agent build ships none, a malformed file surfaces. */
export function readSlotDefaults(root: string, agent: SlotAgent, file: string = SLOT_DEFAULTS_FILE): ReadonlyMap<string, SlotDefaults> {
  const doc = readOptionalJson(root, file) as { schema?: unknown; agent?: unknown; slots?: unknown } | undefined;
  if (doc === undefined) return new Map();
  if (doc.schema !== SLOT_DEFAULTS_SCHEMA || doc.agent !== agent || !doc.slots || typeof doc.slots !== "object") throw new Error(`${agent} ${file}: expected ${SLOT_DEFAULTS_SCHEMA} for ${agent}`);
  const out = new Map<string, SlotDefaults>();
  for (const [id, row] of Object.entries(doc.slots as Record<string, { standard?: unknown; inputs?: unknown }>)) {
    if (row.standard !== undefined && typeof row.standard !== "string") throw new Error(`${agent} ${file}: ${id} standard must be a string`);
    if (row.inputs !== undefined && !(Array.isArray(row.inputs) && row.inputs.every(item => typeof item === "string"))) throw new Error(`${agent} ${file}: ${id} inputs must be slot ids`);
    out.set(id, { ...(row.standard !== undefined ? { standard: row.standard as string } : {}), ...(row.inputs !== undefined ? { inputs: [...row.inputs as string[]] } : {}) });
  }
  return out;
}
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
/** A ref without its agent (`director:x.y@2`, `director/x.y`): the bare slot id. */
const stripAgent = (ref: string) => ref.replace(/^[a-z]+[:/]/, "").replace(/@\d+$/, "");

/** The package IA files an ia.json `source` names (check:ia-source resolves them). */
const DIRECTOR_IA_FILE = "src/catalog/ia/strategy.json";
const CATALOG_IA_DIR = "src/catalog/ia";

export const DESIGNER_LAYERS = ["themes", "assets", "components", "sections", "frames"] as const;

/** Director: the director catalog (55 slots, 9 L1 / 27 L2). */
export function directorIa(): FoundryIa {
  const root = resolveAgent("director").packageRoot;
  const ia = readJson(root, DIRECTOR_IA_FILE) as { nodes: { id: string; name: string; children: { id: string; name: string; leaves: string[] }[] }[]; layers?: IaLayer[]; axes?: IaAxes };
  const cells = new Map((readJson(root, join("src", "catalog", "cells", "strategy.json")) as { id: string; question: string; mustContain: unknown }[]).map(cell => [cell.id, cell]));
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
  return { agent: "director", ia: { schema: IA_SCHEMA, source: packageIaSource("@clossys/director", DIRECTOR_IA_FILE), extensions: [], nodes, ...levels }, slots };
}

/**
 * The ids `@clossys/designer/src/catalog/retired.json` lists; none when the installed package ships no such file. A file that is
 * there but is not an array is a broken package, not an empty list: it throws rather than place every retired leaf.
 */
export function designerRetired(root: string): ReadonlySet<string> {
  let rows: unknown;
  try { rows = readJson(root, "src/catalog/retired.json"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return new Set();
  }
  if (!Array.isArray(rows)) throw new Error(`${join(root, "src/catalog/retired.json")} is not an array of retired leaves`);
  return new Set(rows.flatMap(row => (row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string" ? [(row as { id: string }).id] : [])));
}

/** Flatten a placement subtree: groups below L2 fold into their L2 ancestor. */
function leavesOf(node: PlacementNode): string[] {
  return "leaves" in node ? [...node.leaves] : node.children.flatMap(leavesOf);
}

/**
 * Producer: the seat tree (pipeline/seats.json, SOURCE-MIGRATE step 5). One `seat.<step>` slot per
 * decide step; its contract names the step (the sample seat is the package default in that file)
 * and its standard is the seat standard.
 */
export function producerIa(): FoundryIa {
  const doc = readPipelineSeats();
  const nodes: IaNode[] = doc.nodes.map(node => ({ id: node.id, label: node.label, children: node.children.map(child => ({ id: child.id, label: child.label, slots: [...child.slots] })) }));
  const slots = new Map<string, FoundrySlot>();
  for (const node of nodes) for (const child of node.children) for (const id of child.slots) {
    const step = id.slice("seat.".length);
    slots.set(id, { id, kind: "seat", contract: { step, fixture: { step } }, declaredInputs: [], declaredUses: [], feeds: [], defaults: { standard: "seat" } });
  }
  return { agent: "producer", ia: { schema: IA_SCHEMA, source: PRODUCER_IA_SOURCE, extensions: [], nodes }, slots };
}

/** The contract keys a composed Designer slot's consumer owns (FoundrySlot `consumerOwned`, FCR). */
export const COMPOSED_CONSUMER_OWNED = ["fixture", "props"] as const;

/** Designer: the build catalog placements (themes, assets, components, sections, frames). */
export function designerIa(): FoundryIa {
  const catalog = loadBuildCatalog();
  const root = resolveAgent("designer").packageRoot;
  const contracts = new Map(catalog.slots.map(slot => [slot.id, slot]));
  // Designer keeps its retired leaves placed (loadBuildCatalog enforces it); its retired.json marks them, and the
  // package tree leaves them out, as `migrate recut` does, so ia sync neither reports nor re-adds them.
  const retired = designerRetired(root);
  const nodes: IaNode[] = [];
  const order = [...catalog.placements].sort((a, b) => DESIGNER_LAYERS.indexOf(a.layer as typeof DESIGNER_LAYERS[number]) - DESIGNER_LAYERS.indexOf(b.layer as typeof DESIGNER_LAYERS[number]));
  for (const placement of order) for (const node of placement.nodes) {
    const groups = "leaves" in node
      ? [{ id: node.id, label: node.label, leaves: [...node.leaves] }]
      : node.children.map(child => ({ id: child.id, label: child.label, leaves: leavesOf(child) }));
    // A group whose leaves all retired retires with them, as Writer's tree does, so the consumer tree holds no
    // empty L2 (R01.16); a package group that never listed a leaf stays, so R01.16 still reports it.
    const children: IaLeafGroup[] = groups
      .filter(group => !group.leaves.length || group.leaves.some(id => !retired.has(id)))
      .map(group => ({ id: group.id, label: group.label, slots: group.leaves.filter(id => !retired.has(id)) }));
    if (groups.length && !children.length) continue;
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
  const composed = composedSlots(root);
  for (const node of nodes) for (const child of node.children) for (const id of child.slots) {
    const slot = contracts.get(id) as { contract?: Record<string, unknown>; requires?: readonly string[] } | undefined;
    const contract = (slot?.contract ?? {}) as Record<string, unknown>;
    const composes = [...strings(contract.allowedComposes), ...strings(contract.composes)];
    const declaredInputs = [...new Set([...brief, ...(reads.get(id) ?? []).filter(input => input !== id)])].sort();
    slots.set(id, { id, kind: "element", contract, declaredInputs, declaredUses: [...strings(slot?.requires), ...composes], feeds: [], defaults: defaults.get(id) ?? {}, ...(composed.has(id) ? { consumerOwned: COMPOSED_CONSUMER_OWNED } : {}) });
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
  return { agent: "designer", ia: { schema: IA_SCHEMA, source: packageIaSource("@clossys/designer", CATALOG_IA_DIR), extensions: [], nodes }, slots };
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

/** The Writer target groups (L0), in owner order: one package tree file each (src/catalog/ia/<group>.json). */
export const WRITER_GROUPS = ["voice", "prose", "copy"] as const;

/**
 * Writer: the Voice, Prose and Copy trees (foundry-build-0019 target trees, taken into Producer in foundry-build-0048
 * U2) in place of the retired five-layer store. Each group file is `{nodes: L1 > L2 > leaves, slots: [{id, kind,
 * mark, inputs, contract}], awaiting?}`; a leaf is a slot when the file defines a `slots` row for it, and an
 * `awaiting` leaf (a Designer unit with no copy fields yet) is not placed. The tree's slash ids become dotted node ids
 * (`voice/tone` -> L1 `voice.tone`, L2 `attitude`), so the slot/1 position and the slot/2 slash path
 * (positionIa: `voice`, `voice/tone`, `voice/tone/attitude`) both name the package tree. A slot's inputs are its row's
 * inputs (inputs are per L3), its standard the Writer's slot-defaults.json row; the counts follow the files.
 */
export function writerIa(): FoundryIa {
  const root = resolveAgent("writer").packageRoot;
  type Row = { id: string; kind: TargetSlotKind; inputs?: { to: string; rel?: string; key?: string }[]; contract?: Record<string, unknown> };
  type Tree = { group: string; nodes: { id: string; label: string; children: { id: string; label: string; leaves: string[] }[] }[]; slots: Row[] };
  const nodes: IaNode[] = [];
  const slots = new Map<string, FoundrySlot>();
  const defaults = readSlotDefaults(root, "writer");
  const dotted = (id: string) => id.split("/").join(".");
  for (const group of WRITER_GROUPS) {
    const tree = readJson(root, `${CATALOG_IA_DIR}/${group}.json`) as Tree;
    if (tree.group !== group || !Array.isArray(tree.nodes) || !Array.isArray(tree.slots)) throw new Error(`writer ${CATALOG_IA_DIR}/${group}.json: expected the ${group} tree`);
    const rows = new Map(tree.slots.map(row => [row.id, row]));
    for (const node of tree.nodes) {
      const children: IaLeafGroup[] = node.children
        .map(child => ({ id: child.id.split("/").pop()!, label: child.label, slots: child.leaves.filter(id => rows.has(id)) }))
        .filter(child => child.slots.length > 0);
      if (!children.length) continue;
      nodes.push({ id: dotted(node.id), label: node.label, children });
      for (const child of children) for (const id of child.slots) {
        const row = rows.get(id)!;
        const refs = (row.inputs ?? []).filter(input => typeof input.to === "string").map(input => ({ to: input.to, rel: input.rel ?? "input", ...(input.key !== undefined ? { key: input.key } : {}) }));
        const standard = defaults.get(id)?.standard;
        slots.set(id, {
          id, kind: "strings", targetKind: row.kind, contract: row.contract ?? {}, refs,
          declaredInputs: [...new Set(refs.filter(ref => ref.rel === "input").map(ref => stripAgent(ref.to)))], declaredUses: [], feeds: [],
          defaults: standard !== undefined ? { standard } : {},
        });
      }
    }
  }
  return { agent: "writer", ia: { schema: IA_SCHEMA, source: packageIaSource("@clossys/writer", CATALOG_IA_DIR), extensions: [], nodes }, slots };
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
  // An agent's own loops L1 (`loops.<key>`, loop/agent-loops-ia.ts) is in the `loops` L0 in every unlayered tree.
  else for (const node of ia.nodes) if (node.id.startsWith(`${LOOPS_L0}.`)) layers.set(node.id, LOOPS_L0);
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
