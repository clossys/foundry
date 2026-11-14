/**
 * The IA regroup operations of `clossys ia` (IA-V): pure edits of one agent's ia.json, and the plan
 * that turns an edit into the files one guarded write changes. owner.ts gates each operation on a
 * registered owner decision (records/owner-decisions.ts), prints the plan under `--dry` and otherwise
 * applies it through its guarded writer.
 *
 * Leaf (slot) ids never change: a regroup changes placement only. After every edit each slot.json
 * whose `ia` was the slot's old position is rewritten to its new one (L0 per nodeLayers, L1, L2 and
 * the agent-wide order), the rule `retire --slot` follows; the targeted slot of a move is always
 * rewritten. Refs: an L2 is `<l1>/<l2>`; a bare id is the L1 node or the L0 layer of that id.
 */
import { iaPath, jsonBytes, slotDir, slotFile } from "../records/slot-model/layout.js";
import { nodeLayers, slotPositions } from "../records/slot-model/foundry-ia.js";
import { validateIa, validateSlotDoc } from "../records/slot-model/validate.js";
import { NODE_ID, type IaChange, type IaDoc, type SlotAgent } from "../records/slot-model/types.js";
import { modelExists, readModelText } from "../records/slots.js";

export interface IaGroup { id: string; label: string; slots: string[] }
export interface IaL1 { id: string; label: string; children: IaGroup[] }
export interface IaL0 { id: string; label: string; nodes: string[] }
export interface IaFile {
  schema: string; source: string; extensions: string[]; nodes: IaL1[];
  layers?: IaL0[]; axes?: { L0: unknown; L1: Record<string, unknown>; shared?: string[] }; changes?: IaChange[];
  [key: string]: unknown;
}
/** What an edit did: the next IA and one line saying so, or why it was refused, or that nothing changes. */
export type Edit = { ia: IaFile; detail: string; slot?: { id: string; extension?: boolean } } | { error: string } | { unchanged: string };

const copy = (ia: IaFile): IaFile => JSON.parse(JSON.stringify(ia)) as IaFile;
const leaves = (node: IaL1) => node.children.reduce((sum, group) => sum + group.slots.length, 0);
const groupOf = (node: IaL1, l2: string) => node.children.find(group => group.id === l2 || group.id === `${node.id}.${l2}`);
const isPermutation = (order: readonly string[], members: readonly string[]) =>
  order.length === members.length && new Set(order).size === order.length && order.every(id => members.includes(id));
/** The L0 of each L1 in the layers as listed, whether or not the axes make them L0 yet: the first layer that names it. */
function layerIndex(ia: IaFile): Map<string, number> {
  const index = new Map<string, number>();
  (ia.layers ?? []).forEach((layer, at) => { for (const ref of layer.nodes) { const l1 = ref.split("/")[0]!; if (!index.has(l1)) index.set(l1, at); } });
  return index;
}
/** Drop the layer refs `gone` names; a layer left with none goes too, with its `axes.L1` entry. */
function pruneLayers(ia: IaFile, gone: (ref: string) => boolean): void {
  if (!ia.layers) return;
  for (const layer of ia.layers) layer.nodes = layer.nodes.filter(ref => !gone(ref));
  for (const layer of ia.layers.filter(each => !each.nodes.length)) if (ia.axes?.L1) delete ia.axes.L1[layer.id];
  ia.layers = ia.layers.filter(layer => layer.nodes.length);
}
const isSplit = (ia: IaFile, l1: string) => (ia.layers ?? []).some(layer => layer.nodes.some(ref => ref.startsWith(`${l1}/`)));
/** A new id for an L1 or L0 must not collide with either level: a bare ref names one or the other. */
function freeId(ia: IaFile, id: string): string | undefined {
  if (!NODE_ID.test(id)) return `${id} is not an IA id (${NODE_ID.source})`;
  if (ia.nodes.some(node => node.id === id)) return `${id} is already an L1`;
  if ((ia.layers ?? []).some(layer => layer.id === id)) return `${id} is already an L0 layer`;
  return undefined;
}

type Ref = { level: "L0"; layer: IaL0 } | { level: "L1"; node: IaL1 } | { level: "L2"; node: IaL1; group: IaGroup };
function resolveRef(ia: IaFile, ref: string): Ref | string {
  const parts = ref.split("/");
  if (parts.length === 2) {
    const node = ia.nodes.find(each => each.id === parts[0]);
    const group = node && groupOf(node, parts[1]!);
    return node && group ? { level: "L2", node, group } : `no L2 ${ref} in ia.json (<l1>/<l2> as ia.json lists them)`;
  }
  if (parts.length !== 1) return `${ref} is not an IA ref (<l0>, <l1> or <l1>/<l2>)`;
  const node = ia.nodes.find(each => each.id === ref), layer = ia.layers?.find(each => each.id === ref);
  if (node && layer) return `${ref} names both an L0 layer and an L1 node`;
  if (node) return { level: "L1", node };
  if (layer) return { level: "L0", layer };
  return `no L0 layer or L1 node ${ref} in ia.json`;
}
const refText = (ref: Ref) => ref.level === "L0" ? ref.layer.id : ref.level === "L1" ? ref.node.id : `${ref.node.id}/${ref.group.id}`;

/** `--move --under <l1>/<l2>` or `<l0>/<l1>/<l2>`: an already placed slot to the end of another L2 group. */
export function moveSlot(agent: SlotAgent, before: IaFile, slot: string, under: string): Edit {
  const ia = copy(before);
  const parts = under.split("/");
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !part)) return { error: `--under ${under} is not <l1>/<l2> or <l0>/<l1>/<l2>` };
  const [l0, l1, l2] = parts.length === 3 ? parts : [undefined, ...parts];
  const node = ia.nodes.find(each => each.id === l1) ?? (l0 ? ia.nodes.find(each => each.id === `${l0}.${l1}`) : undefined);
  const group = node && groupOf(node, l2!);
  if (!node || !group) return { error: `${agent} ia.json has no ${under} (L1/L2 ids as ia.json lists them)` };
  if (l0 !== undefined) {
    const level = nodeLayers(agent, ia as unknown as IaDoc).get(node.id);
    if (level !== l0) return { error: `${node.id} is in L0 ${level ?? "(none: this IA has no L0 level yet)"}, not ${l0}` };
  }
  const from = ia.nodes.flatMap(each => each.children.map(child => ({ node: each, group: child }))).find(place => place.group.slots.includes(slot));
  if (!from) return { error: `${agent}/${slot} is not placed; place a new slot with --contract <file> --under` };
  if (from.group === group) return { unchanged: `${agent}/${slot} is already under ${node.id}/${group.id}` };
  from.group.slots = from.group.slots.filter(id => id !== slot);
  group.slots.push(slot);
  return { ia, detail: `moved ${slot} from ${from.node.id}/${from.group.id} to ${node.id}/${group.id}`, slot: { id: slot } };
}

/** `--extension true|false`: the slot is (or is no longer) an owner-signed consumer extension, in ia.json and slot.json alike. */
export function setExtension(before: IaFile, slot: string, extension: boolean): Edit {
  const ia = copy(before);
  ia.extensions = extension ? [...new Set([...ia.extensions, slot])] : ia.extensions.filter(id => id !== slot);
  return { ia, detail: `${slot} ${extension ? "is" : "is no longer"} an extension`, slot: { id: slot, extension } };
}

/** `--add <l1> | <l1>/<l2> --label <text> [--layer <l0>]`: a new, empty L1 or L2 group. */
export function addGroup(agent: SlotAgent, before: IaFile, ref: string, label: string, layerId: string | undefined): Edit {
  const ia = copy(before);
  const parts = ref.split("/");
  const layer = layerId === undefined ? undefined : ia.layers?.find(each => each.id === layerId);
  if (layerId !== undefined && !layer) return { error: `no L0 layer ${layerId}${ia.layers?.length ? "" : " (this IA lists no layers; declare them with --layers)"}` };
  if (parts.length === 2) {
    const [l1, l2] = parts as [string, string];
    const node = ia.nodes.find(each => each.id === l1);
    if (!node) return { error: `no L1 ${l1} in ia.json` };
    if (!NODE_ID.test(l2)) return { error: `${l2} is not an IA id (${NODE_ID.source})` };
    if (groupOf(node, l2)) return { error: `${l1}/${l2} exists` };
    node.children.push({ id: l2, label, slots: [] });
    if (isSplit(ia, l1)) {
      if (!layer) return { error: `${l1} is split across L0 layers: give --layer <l0> for ${ref}` };
      layer.nodes.push(ref);
    } else if (layer) return { error: `--layer is for an L1, or an L2 of an L1 split across layers; ${l1} is listed whole` };
    return { ia, detail: `added L2 ${ref} "${label}"` };
  }
  if (parts.length !== 1) return { error: `${ref} is not <l1> or <l1>/<l2>` };
  const taken = freeId(ia, ref);
  if (taken) return { error: taken };
  const node: IaL1 = { id: ref, label, children: [] };
  if (ia.layers?.length) {
    if (!layer) return { error: `this IA lists L0 layers: give --layer <l0> for the new L1 ${ref}` };
    const members = new Set(layer.nodes.map(each => each.split("/")[0]!));
    const last = ia.nodes.reduce((at, each, index) => members.has(each.id) ? index : at, -1);
    ia.nodes.splice(last < 0 ? ia.nodes.length : last + 1, 0, node);
    layer.nodes.push(ref);
  } else {
    const prefixed = (agent === "designer" || agent === "writer") && ia.axes === undefined;
    const prefix = ref.split(".")[0]!;
    if (prefixed && (!ref.includes(".") || !ia.nodes.some(each => each.id.startsWith(`${prefix}.`)))) {
      return { error: `${agent} L1 ids carry their L0: ${ref} must start with one of ${[...new Set(ia.nodes.map(each => each.id.split(".")[0]))].join(", ")} and a dot` };
    }
    const last = prefixed ? ia.nodes.reduce((at, each, index) => each.id.startsWith(`${prefix}.`) ? index : at, -1) : -1;
    ia.nodes.splice(last < 0 ? ia.nodes.length : last + 1, 0, node);
  }
  return { ia, detail: `added L1 ${ref} "${label}"${layer ? ` in ${layer.id}` : ""}` };
}

/** `--rename <ref> [--label <text>] [--id <new id>]`: the label by default; an id only when given, its refs following. */
export function renameGroup(before: IaFile, ref: string, label: string | undefined, id: string | undefined): Edit {
  if (label === undefined && id === undefined) return { error: "--rename needs --label <text>, --id <new id> or both" };
  const ia = copy(before);
  const found = resolveRef(ia, ref);
  if (typeof found === "string") return { error: found };
  const said: string[] = [];
  if (found.level === "L0") {
    if (label !== undefined) { said.push(`label "${found.layer.label}" -> "${label}"`); found.layer.label = label; }
    if (id !== undefined && id !== found.layer.id) {
      const taken = freeId(ia, id);
      if (taken) return { error: taken };
      if (ia.axes?.L1) ia.axes.L1 = Object.fromEntries(Object.entries(ia.axes.L1).map(([key, axis]) => [key === found.layer.id ? id : key, axis]));
      said.push(`id ${found.layer.id} -> ${id}`); found.layer.id = id;
    }
  } else if (found.level === "L1") {
    if (label !== undefined) { said.push(`label "${found.node.label}" -> "${label}"`); found.node.label = label; }
    if (id !== undefined && id !== found.node.id) {
      const taken = freeId(ia, id);
      if (taken) return { error: taken };
      const old = found.node.id;
      for (const layer of ia.layers ?? []) layer.nodes = layer.nodes.map(each => each === old ? id : each.startsWith(`${old}/`) ? `${id}${each.slice(old.length)}` : each);
      said.push(`id ${old} -> ${id}`); found.node.id = id;
    }
  } else {
    if (label !== undefined) { said.push(`label "${found.group.label}" -> "${label}"`); found.group.label = label; }
    if (id !== undefined && id !== found.group.id) {
      if (!NODE_ID.test(id)) return { error: `${id} is not an IA id (${NODE_ID.source})` };
      if (found.node.children.some(group => group.id === id)) return { error: `${found.node.id}/${id} exists` };
      const old = `${found.node.id}/${found.group.id}`;
      for (const layer of ia.layers ?? []) layer.nodes = layer.nodes.map(each => each === old ? `${found.node.id}/${id}` : each);
      said.push(`id ${found.group.id} -> ${id}`); found.group.id = id;
    }
  }
  if (!said.length) return { unchanged: `${ref} already has that label and id` };
  return { ia, detail: `renamed ${found.level} ${ref}: ${said.join(", ")}` };
}

/** `--merge <ref> --into <ref>`: two groups of one level become the second; the first leaves the IA. */
export function mergeGroups(before: IaFile, ref: string, into: string): Edit {
  const ia = copy(before);
  const from = resolveRef(ia, ref), to = resolveRef(ia, into);
  if (typeof from === "string") return { error: from };
  if (typeof to === "string") return { error: to };
  if (from.level !== to.level) return { error: `${ref} is an ${from.level} and ${into} an ${to.level}: merge within one level` };
  if (refText(from) === refText(to)) return { error: `${ref} cannot merge into itself` };
  if (from.level === "L0" && to.level === "L0") {
    to.layer.nodes.push(...from.layer.nodes);
    if (ia.axes?.L1) delete ia.axes.L1[from.layer.id];
    ia.layers = ia.layers!.filter(layer => layer !== from.layer);
    return { ia, detail: `merged L0 ${from.layer.id} into ${to.layer.id} (${from.layer.nodes.length} L1 refs)` };
  }
  if (from.level === "L1" && to.level === "L1") {
    if (isSplit(ia, to.node.id)) return { error: `${to.node.id} is split across L0 layers: its new L2 groups would be in no layer; assign it whole first (--assign)` };
    for (const group of from.node.children) {
      const same = to.node.children.find(each => each.id === group.id);
      if (same) same.slots.push(...group.slots); else to.node.children.push(group);
    }
    ia.nodes = ia.nodes.filter(node => node !== from.node);
    pruneLayers(ia, each => each === from.node.id || each.startsWith(`${from.node.id}/`));
    return { ia, detail: `merged L1 ${from.node.id} into ${to.node.id} (${from.node.children.length} L2 groups, ${leaves(from.node)} leaves)` };
  }
  if (from.level === "L2" && to.level === "L2") {
    to.group.slots.push(...from.group.slots);
    from.node.children = from.node.children.filter(group => group !== from.group);
    pruneLayers(ia, each => each === `${from.node.id}/${from.group.id}`);
    return { ia, detail: `merged L2 ${from.node.id}/${from.group.id} into ${to.node.id}/${to.group.id} (${from.group.slots.length} leaves)` };
  }
  return { error: "unreachable" };
}

/** `--drop <ref>`: an L0, L1 or L2 group that holds no leaf leaves the IA; one that holds leaves is refused. */
export function dropGroup(before: IaFile, ref: string): Edit {
  const ia = copy(before);
  const found = resolveRef(ia, ref);
  if (typeof found === "string") return { error: found };
  if (found.level === "L2") {
    if (found.group.slots.length) return { error: `${ref} holds ${found.group.slots.length} leaves; move or merge them first (only an empty group is dropped)` };
    found.node.children = found.node.children.filter(group => group !== found.group);
    pruneLayers(ia, each => each === `${found.node.id}/${found.group.id}`);
    return { ia, detail: `dropped empty L2 ${found.node.id}/${found.group.id}` };
  }
  if (found.level === "L1") {
    if (leaves(found.node)) return { error: `${ref} holds ${leaves(found.node)} leaves; move or merge them first (only an empty group is dropped)` };
    ia.nodes = ia.nodes.filter(node => node !== found.node);
    pruneLayers(ia, each => each === found.node.id || each.startsWith(`${found.node.id}/`));
    return { ia, detail: `dropped empty L1 ${found.node.id}` };
  }
  let held = 0;
  for (const each of found.layer.nodes) {
    const part = resolveRef(ia, each);
    if (typeof part !== "string") held += part.level === "L2" ? part.group.slots.length : part.level === "L1" ? leaves(part.node) : 0;
  }
  if (held) return { error: `${ref} holds ${held} leaves; move or merge them first (only an empty group is dropped)` };
  for (const each of found.layer.nodes) {
    const [l1, l2] = each.split("/");
    if (l2 === undefined) ia.nodes = ia.nodes.filter(node => node.id !== l1);
    else for (const node of ia.nodes) if (node.id === l1) node.children = node.children.filter(group => group.id !== l2);
  }
  if (ia.axes?.L1) delete ia.axes.L1[found.layer.id];
  ia.layers = ia.layers!.filter(layer => layer.id !== found.layer.id);
  return { ia, detail: `dropped empty L0 ${found.layer.id} (${found.layer.nodes.length} empty L1 refs)` };
}

/** `--reorder L0 | <l0> | <l1> | <l1>/<l2> --order <id,...>`: the members of one parent, in the given order (an exact permutation). */
export function reorderGroup(agent: SlotAgent, before: IaFile, scope: string, order: readonly string[]): Edit {
  const ia = copy(before);
  const prefixed = !ia.layers?.length && (agent === "designer" || agent === "writer");
  const prefixes = prefixed ? [...new Set(ia.nodes.map(node => node.id.split(".")[0]!))] : [];
  const permute = (what: string, members: readonly string[]): string | undefined =>
    isPermutation(order, members) ? undefined : `--order must list each ${what} exactly once: ${members.join(",")}`;
  if (scope === "L0") {
    if (ia.layers?.length) {
      const wrong = permute("L0 layer", ia.layers.map(layer => layer.id));
      if (wrong) return { error: wrong };
      ia.layers = order.map(id => ia.layers!.find(layer => layer.id === id)!);
      const index = layerIndex(ia);
      ia.nodes = ia.nodes.map((node, at) => ({ node, at })).sort((a, b) => (index.get(a.node.id) ?? 0) - (index.get(b.node.id) ?? 0) || a.at - b.at).map(each => each.node);
    } else if (prefixed) {
      const wrong = permute("L0", prefixes);
      if (wrong) return { error: wrong };
      ia.nodes = ia.nodes.map((node, at) => ({ node, at })).sort((a, b) => order.indexOf(a.node.id.split(".")[0]!) - order.indexOf(b.node.id.split(".")[0]!) || a.at - b.at).map(each => each.node);
    } else return { error: `${agent} ia.json has no L0 level (no layers)` };
    return { ia, detail: `reordered L0: ${order.join(", ")}` };
  }
  if (scope.includes("/")) {
    const found = resolveRef(ia, scope);
    if (typeof found === "string") return { error: found };
    if (found.level !== "L2") return { error: `${scope} is not an L2 group` };
    const wrong = permute("leaf", found.group.slots);
    if (wrong) return { error: wrong };
    found.group.slots = [...order];
    return { ia, detail: `reordered the leaves of ${scope}: ${order.join(", ")}` };
  }
  const node = ia.nodes.find(each => each.id === scope);
  const layer = ia.layers?.find(each => each.id === scope);
  const prefix = prefixes.includes(scope) ? scope : undefined;
  if ([node, layer, prefix].filter(Boolean).length > 1) return { error: `${scope} names more than one IA parent` };
  if (node) {
    const wrong = permute("L2 group", node.children.map(group => group.id));
    if (wrong) return { error: wrong };
    node.children = order.map(id => node.children.find(group => group.id === id)!);
    return { ia, detail: `reordered the L2 groups of ${scope}: ${order.join(", ")}` };
  }
  if (!layer && !prefix) return { error: `no L0 layer, L0 prefix or L1 node ${scope} in ia.json` };
  const memberOf = (id: string) => layer ? layer.nodes.some(ref => ref.split("/")[0] === id) : id.startsWith(`${prefix}.`);
  const members = ia.nodes.filter(each => memberOf(each.id)).map(each => each.id);
  const wrong = permute(`L1 of ${scope}`, members);
  if (wrong) return { error: wrong };
  const seats = ia.nodes.map((each, at) => memberOf(each.id) ? at : -1).filter(at => at >= 0);
  const moved = order.map(id => ia.nodes.find(each => each.id === id)!);
  seats.forEach((at, index) => { ia.nodes[at] = moved[index]!; });
  if (layer) layer.nodes = layer.nodes.map((ref, at) => ({ ref, at })).sort((a, b) => order.indexOf(a.ref.split("/")[0]!) - order.indexOf(b.ref.split("/")[0]!) || a.at - b.at).map(each => each.ref);
  return { ia, detail: `reordered the L1 of ${scope}: ${order.join(", ")}` };
}

/** `--assign <l1> --layer <l0> [--label <text>]`: a whole L1 into one L0 layer (`--label` creates the layer). */
export function assignGroup(before: IaFile, l1: string, layerId: string, label: string | undefined): Edit {
  const ia = copy(before);
  if (!ia.layers?.length) return { error: "this IA lists no L0 layers: declare them first with --layers <file>" };
  const node = ia.nodes.find(each => each.id === l1);
  if (!node) return { error: `no L1 ${l1} in ia.json` };
  let layer = ia.layers.find(each => each.id === layerId);
  if (layer && layer.nodes.length === 1 && layer.nodes[0] === l1) return { unchanged: `${l1} is already the whole of ${layerId}` };
  if (layer?.nodes.includes(l1) && !isSplit(ia, l1)) return { unchanged: `${l1} is already in ${layerId}` };
  if (!layer) {
    if (label === undefined) return { error: `no L0 layer ${layerId}: give --label <text> to create it` };
    const taken = freeId(ia, layerId);
    if (taken) return { error: taken };
    layer = { id: layerId, label, nodes: [] };
    ia.layers.push(layer);
  }
  const target = layer;
  for (const each of ia.layers) each.nodes = each.nodes.filter(ref => ref !== l1 && !ref.startsWith(`${l1}/`));
  target.nodes.push(l1);
  pruneLayers(ia, () => false);
  ia.nodes = ia.nodes.filter(each => each !== node);
  const members = new Set(target.nodes.map(ref => ref.split("/")[0]!));
  const last = ia.nodes.reduce((at, each, index) => members.has(each.id) ? index : at, -1);
  ia.nodes.splice(last < 0 ? ia.nodes.length : last + 1, 0, node);
  return { ia, detail: `assigned L1 ${l1} to L0 ${target.id}` };
}

/** `--layers <file>`: the L0 layers (a JSON list, or `{ "layers": [...] }`); each lists its `<l1>` or `<l1>/<l2>` refs. */
export function setLayers(before: IaFile, value: unknown): Edit {
  const layers = Array.isArray(value) ? value : value !== null && typeof value === "object" ? (value as { layers?: unknown }).layers : undefined;
  if (!Array.isArray(layers)) return { error: "--layers takes a JSON list of { id, label, nodes } (or { \"layers\": [...] })" };
  const ia = copy(before);
  ia.layers = JSON.parse(JSON.stringify(layers)) as IaL0[];
  if (jsonBytes(ia.layers) === jsonBytes(before.layers ?? null)) return { unchanged: "ia.json already lists these layers" };
  return { ia, detail: `declared ${layers.length} L0 layers: ${ia.layers.map(layer => (layer as { id?: unknown }).id).join(", ")}` };
}

/** `--axes <file>`: the closed L0 and L1 vocabularies (R01.7, ia.schema.json `axes`); once declared, the layers are the L0. */
export function setAxes(before: IaFile, value: unknown): Edit {
  const ia = copy(before);
  ia.axes = JSON.parse(JSON.stringify(value)) as IaFile["axes"];
  if (jsonBytes(ia.axes) === jsonBytes(before.axes ?? null)) return { unchanged: "ia.json already declares these axes" };
  return { ia, detail: `declared axes L0 ${JSON.stringify((value as { L0?: { name?: unknown } })?.L0?.name ?? null)} with L1 axes for ${Object.keys((value as { L1?: object })?.L1 ?? {}).join(", ") || "no layer"}` };
}

export interface IaPlan { readonly writes: readonly (readonly [string, string])[]; readonly lines: readonly string[]; readonly slotFiles: number }
export interface IaChangeInput { readonly op: string; readonly ownerRef?: string; readonly at: string }
const position = (value: unknown) => {
  const ia = (value ?? {}) as { l0?: string; l1?: string; l2?: string; order?: number };
  return `${ia.l0 ? `${ia.l0}/` : ""}${ia.l1}/${ia.l2}#${ia.order}`;
};

/** The slot.json rewrites an ia.json change carries: the files with their new bytes, level moves listed, order-only renumbers counted. */
export interface PositionFollow { readonly writes: [string, string][]; readonly moved: string[]; readonly reordered: number }
/**
 * Each slot.json whose `ia` was the slot's position in `before` and differs in `next` is rewritten to
 * its `next` position (L0, L1, L2 and the agent-wide order), as `retire --slot` renumbers; the targeted
 * slot is always rewritten (and its `extension` set). `except` names a slot whose slot.json the caller
 * writes itself (a slot being placed). Shared by every regroup plan and by `--contract --under`.
 */
export function followPositions(consumer: string, agent: SlotAgent, before: IaFile, next: IaFile, slot?: { id: string; extension?: boolean }, except?: string): PositionFollow | { error: string } {
  const was = slotPositions(agent, before as unknown as IaDoc), now = slotPositions(agent, next as unknown as IaDoc);
  const writes: [string, string][] = [], moved: string[] = [];
  let reordered = 0;
  for (const [id, at] of now) {
    if (id === except) continue;
    const file = slotFile(slotDir(consumer, agent, id));
    const targeted = slot?.id === id;
    if (!modelExists(file)) {
      if (targeted && slot?.extension !== undefined) return { error: `${agent}/${id} has no slot.json: write its contract first (--contract <file>)` };
      continue;
    }
    const doc = JSON.parse(readModelText(file)) as Record<string, unknown>;
    let nextDoc: Record<string, unknown> = doc;
    if (jsonBytes(doc.ia) !== jsonBytes(at) && (targeted || jsonBytes(doc.ia) === jsonBytes(was.get(id)))) nextDoc = { ...nextDoc, ia: { ...at } };
    if (targeted && slot?.extension === true) nextDoc = { ...nextDoc, extension: true };
    if (targeted && slot?.extension === false) { const { extension: _drop, ...rest } = nextDoc; nextDoc = rest; }
    const bytes = jsonBytes(nextDoc);
    if (bytes === jsonBytes(doc)) continue;
    const issues = validateSlotDoc(nextDoc, file);
    if (issues.length) return { error: `${agent}/${id}: ${issues.map(issue => issue.message).join("; ")}` };
    writes.push([file, bytes]);
    const levelChanged = position({ ...(doc.ia as object), order: 0 }) !== position({ ...at, order: 0 });
    if (targeted || levelChanged) moved.push(`slot.json ${id}: ia ${position(doc.ia)} -> ${position(at)}${targeted && slot?.extension !== undefined ? `, extension ${slot.extension}` : ""}`);
    else reordered++;
  }
  return { writes, moved, reordered };
}

/**
 * The files one guarded write changes for an edit: ia.json (with the owner-authorized change recorded
 * when there is an owner ref) and each slot.json whose position follows. Validated, never written here.
 */
export function planIaWrite(consumer: string, agent: SlotAgent, before: IaFile, edit: { ia: IaFile; detail: string; slot?: { id: string; extension?: boolean } }, change: IaChangeInput): IaPlan | { error: string } | { unchanged: string } {
  const next = copy(edit.ia);
  const iaFile = iaPath(consumer, agent);
  if (next.axes !== undefined) {
    const levels = new Set(nodeLayers(agent, next as unknown as IaDoc).values());
    const unknown = Object.keys(next.axes.L1 ?? {}).filter(key => !levels.has(key));
    if (unknown.length) return { error: `axes.L1 names ${unknown.join(", ")}, which ${unknown.length === 1 ? "is" : "are"} not an L0 of this IA (${[...levels].join(", ") || "none"})` };
  }
  const follow = followPositions(consumer, agent, before, next, edit.slot);
  if ("error" in follow) return follow;
  const { writes, moved, reordered } = follow;
  const { changes: _beforeChanges, ...beforeRest } = before, { changes: _nextChanges, ...nextRest } = next;
  if (jsonBytes(beforeRest) === jsonBytes(nextRest) && !writes.length) return { unchanged: `${edit.detail}: nothing changes` };
  if (change.ownerRef) next.changes = [...(next.changes ?? []), { op: change.op, ownerRef: change.ownerRef, at: change.at, detail: edit.detail, slotFiles: writes.length }];
  const iaIssues = validateIa(next, iaFile, agent);
  if (iaIssues.length) return { error: iaIssues.map(issue => issue.message).join("; ") };
  const lines = [
    `ia.json: ${edit.detail}${change.ownerRef ? ` (owner ${change.ownerRef})` : ""}`,
    ...moved,
    ...(reordered ? [`${reordered} other slot.json renumbered (order only)`] : []),
  ];
  return { writes: [[iaFile, jsonBytes(next)], ...writes], lines, slotFiles: writes.length };
}
