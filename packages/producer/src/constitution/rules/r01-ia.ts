/**
 * R01.7-R01.15, the IA checks (foundry-plan-0002 unit IA-C; slot-constitution.md "IA round"). The owner's levels: L0 is the nav link (an ia.json
 * `layers` entry), L1 a tab (a node), L2 a group (a node's child) and L3 the leaf (a slot).
 *
 * An ia.json without `layers` is read the way the Studio shows it today, so every check reports on
 * today's tree: a dotted node id (`themes.colors`) implies its L0 from the prefix; an undotted node
 * (Publisher `studio`, Producer `direct`) is itself the L0, its children the L1 tabs and its leaves
 * sit at L2. R01.8 reports both readings as depth findings.
 *
 * - R01.7 IA-AXIS: ia.json declares `axes {L0, L1}`, each a name plus a closed label list (`instance`
 *   for data-driven tabs, L1 only), and every L0 and L1 label is in its level's list.
 * - R01.8 IA-DEPTH: every leaf sits at L3 under a declared L0, and slot.json `ia` carries `l0`, `l1`
 *   and `l2` equal to the leaf's placement.
 * - R01.9 IA-NO-CONSUMER: no L0 or L1 id or label is an agent id, a Foundry package name, a
 *   publication id or a provenance word, unless the L1 axis is `instance`.
 * - R01.10 IA-NO-MIRROR: Publisher ia.json holds no page grouping: no node repeats a nav group of the
 *   Studio publication map, and no node spreads its pages over more than one L2 group.
 * - R01.11 IA-SHARED-AXIS: Writer Section copy L2 groups = Designer Sections L2 groups (same keys, labels
 *   and order, IA_MIRRORS); an axis that declares `mirrors` holds its L0's L1 list equal to the source's.
 * - R01.12 IA-LABEL-UNIQUE: an L0 or L1 label names one concept within and across agents unless the
 *   agent declares it in `axes.shared` or a declared mirror links the two; its slug equals the id.
 * - R01.13 NAV-IA-PARITY: the Studio nav groups are Workspace plus each agent with an ia.json, in
 *   chain order; an agent group's pages match that agent's L0s; every placed page is reachable from
 *   the nav or declared hidden (`nav: {hidden: true}`).
 * - R01.14 IA-EXTENSION-FACET: every listed extension carries slot.json `extension: true` under a
 *   Foundry (non-provenance) L1; every `extension: true` leaf is listed; every leaf in a provenance tab
 *   is listed.
 * - R01.15 IA-FANOUT (warn): an L0 with one L1, or an L1 with one leaf.
 * - R01.16 IA-EMPTY-GROUP: every L2 group (a node's child) places at least one leaf. An empty group is
 *   filled, or dropped through `clossys ia <agent> --drop <l1>/<l2>`; a package group whose leaves all
 *   retired is left out of the consumer tree by the package IA (foundry-build-0048 U33).
 */
import { AGENT_LISTS, AGENT_ROWS } from "../../agent-lists.generated.js";
import { MODEL_AGENTS, type ModelAgent } from "../../records/slot-model/index.js";
import { isCurrentSlot } from "../../records/slot-current.js";
import { positionIa } from "../../records/slot.js";
import { isObject, liveSlots, row, stringList } from "../checks/shared.js";
import type { AgentRecord, Check, ConstitutionContext, Row, SlotRecord } from "../types.js";

/** The Foundry packages (packages/* of the Foundry repository); an L0 or L1 must not name one (R01.9). */
export const FOUNDRY_PACKAGES: readonly string[] = AGENT_ROWS.map(row => row.id);
/**
 * Words that name where a leaf came from or who consumes it, not what it is (R01.9, R01.14).
 * Specimens is a Studio surface (proposal (c): "Specimens and Producer are consumers").
 */
export const PROVENANCE_WORDS: readonly string[] = ["extension", "extensions", "consumer", "consumers", "studio", "producer", "specimen", "specimens"];
/** The Studio publication whose nav R01.10 and R01.13 read. */
export const STUDIO_PUBLICATION = "publication.studio";
/** The Studio nav group above the agents (proposal (c), Studio nav). */
export const WORKSPACE_GROUP = "workspace";
/** Nav order of the agent groups: chain order (proposal (c), owner Q-order). */
export const NAV_AGENT_ORDER: readonly ModelAgent[] = AGENT_LISTS.nav;
/**
 * One side of an IA mirror: an L0 (its L1 tabs are the list), or with `l1` one L1 of it (its L2 groups are the
 * list, an L2 id read without its L1's `<key>-` prefix).
 */
export interface MirrorSide { readonly agent: ModelAgent; readonly l0: string; readonly l1?: string }
/**
 * The mirrors IA-SHARED-AXIS holds (R01.11): the mirror's list must equal the source's. Writer Section copy
 * groups its leaves as Designer Sections does (the Voice/Prose/Copy tree, foundry-build-0048 U2).
 */
export const IA_MIRRORS: readonly { readonly mirror: MirrorSide; readonly source: MirrorSide }[] = [
  { mirror: { agent: "writer", l0: "copy", l1: "copy.section-copy" }, source: { agent: "designer", l0: "sections", l1: "sections.sections" } },
];

// ---- the level view ------------------------------------------------------------------------------

export interface L2View { readonly id: string; readonly label: string; readonly leaves: readonly string[] }
export interface L1View {
  readonly id: string;
  readonly label: string;
  /** Its L2 groups; empty when the leaves sit directly under it (an undotted node without layers). */
  readonly l2s: readonly L2View[];
  /** Every leaf under it. */
  readonly leaves: readonly string[];
  /** The `<l1>/<l2>` layer ref that shows one L2 group as this L1. */
  readonly partial?: string;
}
export interface L0View {
  readonly id: string;
  /** Undefined for an L0 implied by a dotted node id prefix. */
  readonly label?: string;
  /** `prefix`: implied by dotted node ids; `node`: an undotted node read as L0 (leaves at L2). */
  readonly implied?: "prefix" | "node";
  readonly l1s: readonly L1View[];
}
/** Where ia.json places one leaf: its layer (when any), node and child. */
export interface LeafPlace { readonly l0?: string; readonly node: string; readonly child: string }
export interface IaView {
  readonly agent: AgentRecord;
  readonly path: string;
  readonly layers: boolean;
  readonly l0s: readonly L0View[];
  readonly axes?: Record<string, unknown>;
  readonly extensions: readonly string[];
  readonly places: ReadonlyMap<string, LeafPlace>;
}

interface RawChild { id: string; label: string; slots: string[] }
interface RawNode { id: string; label: string; children: RawChild[] }

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);
function rawNodes(ia: Record<string, unknown>): RawNode[] {
  if (!Array.isArray(ia.nodes)) return [];
  return ia.nodes.flatMap(node => {
    if (!isObject(node) || !text(node.id)) return [];
    const children = Array.isArray(node.children) ? node.children.flatMap(child => (isObject(child) && text(child.id)
      ? [{ id: child.id as string, label: text(child.label) ?? "", slots: stringList(child.slots) }] : [])) : [];
    return [{ id: node.id as string, label: text(node.label) ?? "", children }];
  });
}
const l1Of = (node: RawNode): L1View => ({
  id: node.id, label: node.label,
  l2s: node.children.map(child => ({ id: child.id, label: child.label, leaves: child.slots })),
  leaves: node.children.flatMap(child => child.slots),
});

/** One agent's IA read as levels, or undefined without a readable ia.json (R01.1 reports that). */
export function iaView(agent: AgentRecord): IaView | undefined {
  const ia = agent.ia?.value;
  if (!isObject(ia)) return undefined;
  const nodes = rawNodes(ia);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const places = new Map<string, LeafPlace>();
  const l0s: L0View[] = [];
  const layerOf = new Map<string, string>();
  const layers = Array.isArray(ia.layers) && ia.layers.length > 0;
  if (layers) {
    for (const layer of ia.layers as unknown[]) {
      if (!isObject(layer) || !text(layer.id)) continue;
      const l1s: L1View[] = [];
      for (const ref of stringList(layer.nodes)) {
        const [l1 = "", l2] = ref.split("/");
        const node = byId.get(l1);
        if (!node) continue;
        if (!layerOf.has(node.id)) layerOf.set(node.id, layer.id as string);
        if (l2 === undefined) { l1s.push(l1Of(node)); continue; }
        const child = node.children.find(each => each.id === l2);
        if (child) l1s.push({ id: node.id, label: node.label, l2s: [{ id: child.id, label: child.label, leaves: child.slots }], leaves: child.slots, partial: ref });
      }
      l0s.push({ id: layer.id as string, label: text(layer.label) ?? "", l1s });
    }
  } else {
    const prefixed = new Map<string, L1View[]>();
    for (const node of nodes) {
      const dot = node.id.indexOf(".");
      if (dot > 0) {
        const prefix = node.id.slice(0, dot);
        if (!prefixed.has(prefix)) { const l1s: L1View[] = []; prefixed.set(prefix, l1s); l0s.push({ id: prefix, implied: "prefix", l1s }); }
        prefixed.get(prefix)!.push(l1Of(node));
        layerOf.set(node.id, prefix);
      } else {
        l0s.push({ id: node.id, label: node.label, implied: "node", l1s: node.children.map(child => ({ id: child.id, label: child.label, l2s: [], leaves: child.slots })) });
      }
    }
  }
  for (const node of nodes) for (const child of node.children) for (const slot of child.slots) {
    if (places.has(slot)) continue;
    const l0 = layerOf.get(node.id);
    places.set(slot, l0 === undefined ? { node: node.id, child: child.id } : { l0, node: node.id, child: child.id });
  }
  return {
    agent, path: `${agent.dir}/ia.json`, layers, l0s, places,
    ...(isObject(ia.axes) ? { axes: ia.axes } : {}),
    extensions: stringList(ia.extensions),
  };
}

const viewsOf = (ctx: ConstitutionContext): IaView[] => ctx.agents.flatMap(agent => { const view = iaView(agent); return view ? [view] : []; });

// ---- shared helpers ------------------------------------------------------------------------------

/** `Consumer extensions` → `consumer-extensions`: lowercase, every non-alphanumeric run one dash. */
export const slug = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** The id's own segment: `themes.colors` → `colors`. */
export const keyOf = (id: string): string => id.slice(id.lastIndexOf(".") + 1);
const tokens = (value: string): string[] => slug(value).split("-").filter(Boolean);
const where = (l0: L0View, l1?: L1View): string => (l1 ? `L1 ${l1.id}${l1.label ? ` (${l1.label})` : ""}` : `L0 ${l0.id}${l0.label ? ` (${l0.label})` : ""}`);
const iaRow = (check: string, view: { agent: AgentRecord; path: string }, reason: string): Row => row("R01", check, { agent: view.agent.agent, id: "*" }, reason, view.path);

interface Axis { readonly name?: string; readonly values?: readonly string[]; readonly instance: boolean; readonly mirrors?: string }
function axisOf(value: unknown): Axis | undefined {
  if (!isObject(value)) return undefined;
  return {
    ...(text(value.name) ? { name: value.name as string } : {}),
    ...(Array.isArray(value.values) ? { values: stringList(value.values) } : {}),
    instance: value.instance === true,
    ...(text(value.mirrors) ? { mirrors: value.mirrors as string } : {}),
  };
}
const l1AxisOf = (view: IaView, l0: string): Axis | undefined => (isObject(view.axes?.L1) ? axisOf((view.axes.L1 as Record<string, unknown>)[l0]) : undefined);
const sharedOf = (view: IaView): Set<string> => new Set(stringList(view.axes?.shared).map(label => label.toLowerCase()));

/** The words an L0 or L1 must not name (R01.9), each with what it names. */
function consumerWords(ctx: ConstitutionContext): Map<string, string> {
  const words = new Map<string, string>();
  for (const id of PROVENANCE_WORDS) words.set(id, "a provenance word");
  for (const id of FOUNDRY_PACKAGES) words.set(id, "a Foundry package");
  for (const agent of ctx.agents) for (const id of agent.liveIds) if (id.startsWith("publication.")) for (const word of tokens(id.slice("publication.".length))) words.set(word, `a publication (${id})`);
  for (const id of MODEL_AGENTS) words.set(id, "an agent");
  return words;
}
function namedWords(words: Map<string, string>, id: string, label: string | undefined): string[] {
  const hits = new Set([...tokens(keyOf(id)), ...(label ? tokens(label) : [])].filter(word => words.has(word)));
  return [...hits].map(word => `${word} (${words.get(word)})`);
}
const isProvenance = (l1: L1View): boolean => [...tokens(keyOf(l1.id)), ...tokens(l1.label)].some(word => PROVENANCE_WORDS.includes(word));

/** A pinned candidate's parsed JSON, or why there is none. */
function pinnedJson(record: SlotRecord): { json?: Record<string, unknown>; path: string; error?: string } {
  const pin = isObject(record.pin?.value) ? record.pin.value : undefined;
  const name = typeof pin?.candidate === "string" ? pin.candidate : undefined;
  const candidate = name === undefined ? undefined : record.candidates.find(each => each.name === name);
  if (!candidate) return { path: record.pin?.path ?? record.dir, error: name === undefined ? "has no readable pin" : `pins ${name}, which is not in candidates/` };
  return isObject(candidate.json) ? { json: candidate.json, path: candidate.path } : { path: candidate.path, error: `pinned ${candidate.name} is not a JSON object` };
}

interface NavPage { readonly id: string; readonly path?: string; readonly group?: string; readonly nav: boolean; readonly hidden: boolean; readonly recordPath: string }
interface StudioNav { readonly path: string; readonly groups: readonly string[]; readonly pages: readonly NavPage[]; readonly error?: string }

/** The Studio publication's nav: its groups in order and every page cell it places, or undefined without one. */
function studioNav(ctx: ConstitutionContext): StudioNav | undefined {
  const publisher = ctx.agents.find(agent => agent.agent === "publisher");
  const record = publisher?.slots.get(STUDIO_PUBLICATION);
  if (!publisher || !record || !publisher.liveIds.includes(STUDIO_PUBLICATION)) return undefined;
  const pinned = pinnedJson(record);
  const tree = isObject(pinned.json?.meta) ? (pinned.json.meta as Record<string, unknown>).tree : undefined;
  if (!isObject(tree)) return { path: pinned.path, groups: [], pages: [], error: pinned.error ?? "has no meta.tree" };
  const implicit = STUDIO_PUBLICATION.slice("publication.".length);
  const groups: string[] = [];
  const pages: NavPage[] = [];
  const add = (group: string) => { if (!groups.includes(group)) groups.push(group); };
  const pageOf = (id: string, treeGroup: string | undefined): NavPage => {
    const page = publisher.slots.get(id);
    const doc = page ? pinnedJson(page) : undefined;
    const nav = isObject(doc?.json?.nav) ? doc.json.nav as Record<string, unknown> : undefined;
    const group = typeof nav?.group === "string" ? nav.group : treeGroup;
    return {
      id, ...(typeof doc?.json?.path === "string" ? { path: doc.json.path } : {}), ...(group !== undefined ? { group } : {}),
      nav: nav?.nav === true, hidden: nav?.hidden === true, recordPath: doc?.path ?? `${publisher.dir}/${id}`,
    };
  };
  const visit = (node: Record<string, unknown>, treeGroup: string | undefined) => {
    const isGroup = isObject(node.entry) && node.entry.kind === "group" && typeof node.id === "string";
    const group = isGroup ? node.id as string : treeGroup;
    if (isGroup) add(group!);
    for (const cell of stringList(node.cells)) {
      const page = pageOf(cell, group);
      pages.push(page);
      if (page.nav) add(page.group ?? implicit);
    }
    if (Array.isArray(node.children)) for (const child of node.children) if (isObject(child)) visit(child, group);
  };
  visit(tree, undefined);
  return { path: pinned.path, groups, pages };
}
const lastSegment = (path: string | undefined): string => (path ?? "").split("/").filter(Boolean).pop() ?? "";

// ---- the checks ----------------------------------------------------------------------------------

/** R01.7 IA-AXIS: closed L0 and L1 vocabularies, and every label in its level's list. */
export function iaAxis(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const view of viewsOf(ctx)) {
    if (!view.axes) { rows.push(iaRow("R01.7", view, "ia.json declares no axes {L0, L1}: its L0 and L1 labels have no closed vocabulary")); continue; }
    const l0 = axisOf(view.axes.L0);
    if (!l0?.name || (!l0.values && !l0.instance)) rows.push(iaRow("R01.7", view, "axes.L0 must be {name, values}"));
    else if (l0.instance) rows.push(iaRow("R01.7", view, "axes.L0 is instance: only L1 tabs may be data-driven"));
    else for (const node of view.l0s) if (node.label !== undefined && !l0.values!.includes(node.label)) rows.push(iaRow("R01.7", view, `${where(node)} label is not in axes.L0 ${l0.name} [${l0.values!.join(", ")}]`));
    for (const node of view.l0s) {
      const axis = l1AxisOf(view, node.id);
      if (!axis?.name || (!axis.values && !axis.instance)) { rows.push(iaRow("R01.7", view, `axes.L1.${node.id} must be {name, values} or {name, instance: true}`)); continue; }
      if (axis.instance) continue;
      for (const tab of node.l1s) if (!axis.values!.includes(tab.label)) rows.push(iaRow("R01.7", view, `${where(node, tab)} label is not in axes.L1.${node.id} ${axis.name} [${axis.values!.join(", ")}]`));
    }
  }
  return rows;
}

/**
 * R01.8 IA-DEPTH: every leaf at L3 under a declared L0; slot.json ia carries l0, l1 and l2 equal to its placement.
 * A `clossys.slot/2` file writes its placement as slash paths (records/slot.ts positionIa), so its ia is compared
 * with the slash paths of the ia.json placement; a `clossys.slot/1` file with the dotted ids themselves.
 */
export function iaDepth(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const view of viewsOf(ctx)) {
    if (!view.layers) {
      const flat = view.l0s.filter(node => node.implied === "node").map(node => node.id);
      const prefixed = view.l0s.filter(node => node.implied === "prefix").map(node => node.id);
      const parts = [
        ...(prefixed.length ? [`L0 is only implied by node id prefixes (${prefixed.join(", ")})`] : []),
        ...(flat.length ? [`nodes ${flat.join(", ")} stand in for L0, so their leaves sit at L2, not L3`] : []),
      ];
      rows.push(iaRow("R01.8", view, `ia.json declares no layers (L0): ${parts.join("; ") || "no nodes"}`));
    }
    for (const node of view.l0s) for (const tab of node.l1s) if (tab.partial) rows.push(iaRow("R01.8", view, `layer ${node.id} shows L2 group ${tab.partial} as an L1: its leaves sit at L2, not L3`));
    for (const { id, record } of liveSlots(view.agent)) {
      const place = view.places.get(id);
      const doc = isObject(record?.slot?.value) ? record.slot.value : undefined;
      if (!place || !doc || !isObject(doc.ia)) continue;
      const ia = doc.ia;
      const ref = { agent: view.agent.agent, id };
      const path = record!.slot!.path;
      if (isCurrentSlot(doc)) {
        if (place.l0 === undefined) rows.push(row("R01", "R01.8", ref, `ia.json gives the leaf no L0 (slot.json ia.l0 is ${String(ia.l0)})`, path));
        const want = positionIa(id, { ...(place.l0 === undefined ? {} : { l0: place.l0 }), l1: place.node, l2: place.child });
        if (ia.l0 !== want.l0 || ia.l1 !== want.l1 || ia.l2 !== want.l2) rows.push(row("R01", "R01.8", ref, `slot.json ia is ${String(ia.l2)}, but ia.json places the leaf at ${want.l2} (${place.node}/${place.child})`, path));
        continue;
      }
      if (ia.l0 === undefined) rows.push(row("R01", "R01.8", ref, place.l0 === undefined ? "slot.json ia has no l0, and ia.json gives the leaf no L0" : `slot.json ia has no l0 (the leaf's L0 is ${place.l0})`, path));
      else if (ia.l0 !== place.l0) rows.push(row("R01", "R01.8", ref, `slot.json ia.l0 is ${String(ia.l0)}, but ia.json places the leaf under L0 ${place.l0 ?? "(none)"}`, path));
      if (ia.l1 !== place.node || ia.l2 !== place.child) rows.push(row("R01", "R01.8", ref, `slot.json ia is ${String(ia.l1)}/${String(ia.l2)}, but ia.json places the leaf at ${place.node}/${place.child}`, path));
    }
  }
  return rows;
}

/** R01.9 IA-NO-CONSUMER: no L0 or L1 names an agent, a package, a publication or a provenance word. */
export function iaNoConsumer(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  const words = consumerWords(ctx);
  for (const view of viewsOf(ctx)) for (const node of view.l0s) {
    const hits = namedWords(words, node.id, node.label);
    if (hits.length) rows.push(iaRow("R01.9", view, `${where(node)} names a consumer, not a kind: ${hits.join(", ")}`));
    if (l1AxisOf(view, node.id)?.instance) continue;
    for (const tab of node.l1s) {
      const found = namedWords(words, tab.id, tab.label);
      if (found.length) rows.push(iaRow("R01.9", view, `${where(node, tab)} names a consumer, not a kind: ${found.join(", ")}`));
    }
  }
  return rows;
}

/** R01.10 IA-NO-MIRROR: Publisher ia.json copies no nav group and spreads no node's pages over several L2 groups. */
export function iaNoMirror(ctx: ConstitutionContext): Row[] {
  const view = viewsOf(ctx).find(each => each.agent.agent === "publisher");
  if (!view) return [];
  const rows: Row[] = [];
  const nav = studioNav(ctx);
  const groups = new Set(nav?.groups ?? []);
  const ia = view.agent.ia!.value as Record<string, unknown>;
  for (const node of rawNodes(ia)) {
    for (const entry of [{ id: node.id, label: node.label, kind: "node" }, ...node.children.map(child => ({ id: child.id, label: child.label, kind: `node ${node.id} child` }))]) {
      const copied = [...new Set([keyOf(entry.id), slug(entry.label)])].filter(name => groups.has(name));
      if (copied.length) rows.push(iaRow("R01.10", view, `${entry.kind} ${entry.id} copies the ${STUDIO_PUBLICATION} nav group ${copied.join(", ")}: page groups derive from the publication map`));
    }
    const grouped = node.children.filter(child => child.slots.some(slot => slot.startsWith("page.")));
    if (grouped.length > 1) rows.push(iaRow("R01.10", view, `node ${node.id} groups its pages into ${grouped.map(child => child.id).join(", ")}: page groups derive from the publication map, not ia.json`));
  }
  return rows;
}

/** R01.11 IA-SHARED-AXIS: every mirror's L1 list equals its source's, and the mirror axis declares it. */
export function iaSharedAxis(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  const views = viewsOf(ctx);
  const viewOf = (agent: string) => views.find(each => each.agent.agent === agent);
  const l0In = (view: IaView | undefined, id: string) => view?.l0s.find(node => node.id === id);
  const pairs: { mirror: MirrorSide; source: MirrorSide }[] = [...IA_MIRRORS];
  for (const view of views) for (const node of view.l0s) {
    const declared = l1AxisOf(view, node.id)?.mirrors;
    if (!declared) continue;
    const [agent = "", l0 = ""] = declared.split("/");
    if (!pairs.some(pair => pair.mirror.agent === view.agent.agent && pair.mirror.l0 === node.id && pair.source.agent === agent && pair.source.l0 === l0)) {
      pairs.push({ mirror: { agent: view.agent.agent, l0: node.id }, source: { agent: agent as ModelAgent, l0 } });
    }
  }
  for (const { mirror, source } of pairs) {
    if (mirror.l1 !== undefined || source.l1 !== undefined) { rows.push(...l1Mirror(mirror, source, viewOf(mirror.agent), viewOf(source.agent))); continue; }
    const mirrorView = viewOf(mirror.agent), sourceView = viewOf(source.agent);
    const mine = l0In(mirrorView, mirror.l0), theirs = l0In(sourceView, source.l0);
    const name = `${mirror.agent}/${mirror.l0}`, sourceName = `${source.agent}/${source.l0}`;
    if (!mine && !theirs) continue;
    if (!theirs) { if (sourceView) rows.push(iaRow("R01.11", sourceView, `L0 ${source.l0} is missing: ${name} mirrors its L1 list`)); else if (mirrorView) rows.push(iaRow("R01.11", mirrorView, `${name} mirrors ${sourceName}, which has no ia.json`)); continue; }
    if (!mine) { if (mirrorView) rows.push(iaRow("R01.11", mirrorView, `L0 ${mirror.l0} is missing: it must mirror the L1 list of ${sourceName}`)); continue; }
    const view = mirrorView!;
    if (l1AxisOf(view, mirror.l0)?.mirrors !== sourceName) rows.push(iaRow("R01.11", view, `axes.L1.${mirror.l0} does not declare mirrors: ${sourceName}`));
    const want = theirs.l1s.map(tab => ({ key: keyOf(tab.id), label: tab.label }));
    const have = mine.l1s.map(tab => ({ key: keyOf(tab.id), label: tab.label }));
    for (const tab of want) if (!have.some(each => each.key === tab.key)) rows.push(iaRow("R01.11", view, `${sourceName} L1 ${tab.key} (${tab.label}) has no mirror in ${name}`));
    for (const tab of have) {
      const match = want.find(each => each.key === tab.key);
      if (!match) rows.push(iaRow("R01.11", view, `${name} L1 ${tab.key} (${tab.label}) is not in ${sourceName}`));
      else if (match.label !== tab.label) rows.push(iaRow("R01.11", view, `${name} L1 ${tab.key} is labelled ${tab.label}, ${sourceName} labels it ${match.label}`));
    }
    const common = (list: { key: string }[], other: { key: string }[]) => list.map(each => each.key).filter(key => other.some(each => each.key === key));
    if (common(have, want).join() !== common(want, have).join()) rows.push(iaRow("R01.11", view, `${name} orders its L1 tabs ${common(have, want).join(", ")}; ${sourceName} orders them ${common(want, have).join(", ")}`));
  }
  return rows;
}

/**
 * R01.11 for an L1 mirror: the mirror L1's L2 groups equal the source L1's (keys, labels, order). The pair is
 * package data (IA_MIRRORS), so no axis declares it; a side that is missing is named only when the other is placed.
 */
function l1Mirror(mirror: MirrorSide, source: MirrorSide, mirrorView: IaView | undefined, sourceView: IaView | undefined): Row[] {
  const side = (at: MirrorSide) => `${at.agent}/${at.l1 ?? at.l0}`;
  const l1In = (view: IaView | undefined, at: MirrorSide) => view?.l0s.find(node => node.id === at.l0)?.l1s.find(tab => tab.id === (at.l1 ?? at.l0));
  const mine = l1In(mirrorView, mirror), theirs = l1In(sourceView, source);
  const name = side(mirror), sourceName = side(source);
  if (!mine && !theirs) return [];
  if (!theirs) return sourceView ? [iaRow("R01.11", sourceView, `L1 ${source.l1} is missing: ${name} mirrors its L2 groups`)] : mirrorView ? [iaRow("R01.11", mirrorView, `${name} mirrors ${sourceName}, which has no ia.json`)] : [];
  if (!mine) return mirrorView ? [iaRow("R01.11", mirrorView, `L1 ${mirror.l1} is missing: it must mirror the L2 groups of ${sourceName}`)] : [];
  const groups = (tab: L1View) => tab.l2s.map(group => ({ key: group.id.startsWith(`${keyOf(tab.id)}-`) ? group.id.slice(keyOf(tab.id).length + 1) : group.id, label: group.label }));
  const want = groups(theirs), have = groups(mine);
  const rows: Row[] = [];
  const view = mirrorView!;
  for (const group of want) if (!have.some(each => each.key === group.key)) rows.push(iaRow("R01.11", view, `${sourceName} L2 ${group.key} (${group.label}) has no mirror in ${name}`));
  for (const group of have) {
    const match = want.find(each => each.key === group.key);
    if (!match) rows.push(iaRow("R01.11", view, `${name} L2 ${group.key} (${group.label}) is not in ${sourceName}`));
    else if (match.label !== group.label) rows.push(iaRow("R01.11", view, `${name} L2 ${group.key} is labelled ${group.label}, ${sourceName} labels it ${match.label}`));
  }
  const common = (list: { key: string }[], other: { key: string }[]) => list.map(each => each.key).filter(key => other.some(each => each.key === key));
  if (common(have, want).join() !== common(want, have).join()) rows.push(iaRow("R01.11", view, `${name} orders its L2 groups ${common(have, want).join(", ")}; ${sourceName} orders them ${common(want, have).join(", ")}`));
  return rows;
}

/** R01.12 IA-LABEL-UNIQUE: one label, one concept, within and across agents; the label's slug is the id. */
export function iaLabelUnique(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  const views = viewsOf(ctx);
  interface Entry { readonly view: IaView; readonly level: "L0" | "L1"; readonly id: string; readonly label: string; readonly parent: string; readonly at: string }
  const entries: Entry[] = [];
  for (const view of views) for (const node of view.l0s) {
    if (node.label !== undefined) entries.push({ view, level: "L0", id: node.id, label: node.label, parent: "", at: `${view.agent.agent} ${where(node)}` });
    for (const tab of node.l1s) if (!tab.partial) entries.push({ view, level: "L1", id: tab.id, label: tab.label, parent: node.id, at: `${view.agent.agent} ${where(node, tab)}` });
  }
  const linked = (a: Entry, b: Entry) => a.level === "L1" && b.level === "L1" && keyOf(a.id) === keyOf(b.id) && [...IA_MIRRORS.filter(pair => pair.mirror.l1 === undefined), ...views.flatMap(view => view.l0s.flatMap(node => {
    const declared = l1AxisOf(view, node.id)?.mirrors?.split("/");
    return declared ? [{ mirror: { agent: view.agent.agent, l0: node.id }, source: { agent: declared[0] as ModelAgent, l0: declared[1] ?? "" } }] : [];
  }))].some(({ mirror, source }) => [[a, b], [b, a]].some(([x, y]) => x!.view.agent.agent === mirror.agent && x!.parent === mirror.l0 && y!.view.agent.agent === source.agent && y!.parent === source.l0));
  for (const entry of entries) {
    if (slug(entry.label) !== keyOf(entry.id)) rows.push(iaRow("R01.12", entry.view, `${entry.level} ${entry.id} is labelled ${entry.label}: the label's slug ${slug(entry.label)} must be the id ${keyOf(entry.id)}`));
    const same = entries.filter(other => other !== entry && other.label.toLowerCase() === entry.label.toLowerCase());
    if (!same.length) continue;
    const siblings = same.filter(other => other.view === entry.view && other.level === entry.level && other.parent === entry.parent);
    if (siblings.length) { rows.push(iaRow("R01.12", entry.view, `${entry.level} ${entry.id} repeats the label ${entry.label} under one parent (${siblings.map(other => other.id).join(", ")})`)); continue; }
    if (sharedOf(entry.view).has(entry.label.toLowerCase())) continue;
    const clashes = same.filter(other => !linked(entry, other));
    if (clashes.length) rows.push(iaRow("R01.12", entry.view, `${entry.level} ${entry.id} label ${entry.label} also names ${clashes.map(other => other.at).join("; ")} (declare it in axes.shared or rename)`));
  }
  return rows;
}

/** R01.13 NAV-IA-PARITY: Studio nav groups = Workspace plus each agent with an ia.json; nav L0 = ia.json L0; every page reachable or hidden. */
export function navIaParity(ctx: ConstitutionContext): Row[] {
  const nav = studioNav(ctx);
  if (!nav) return [];
  const publisher = { agent: ctx.agents.find(agent => agent.agent === "publisher")!, path: nav.path };
  if (nav.error) return [iaRow("R01.13", publisher, `${STUDIO_PUBLICATION} ${nav.error}: its nav cannot be read`)];
  const rows: Row[] = [];
  const views = viewsOf(ctx);
  const expected = [WORKSPACE_GROUP, ...NAV_AGENT_ORDER.filter(agent => views.some(view => view.agent.agent === agent))];
  for (const group of expected) if (!nav.groups.includes(group)) rows.push(iaRow("R01.13", publisher, `the Studio nav has no group ${group}`));
  for (const group of nav.groups) if (!expected.includes(group)) rows.push(iaRow("R01.13", publisher, `nav group ${group} is neither ${WORKSPACE_GROUP} nor an agent with an ia.json`));
  const order = (list: readonly string[], other: readonly string[]) => list.filter(each => other.includes(each)).join(", ");
  if (order(nav.groups, expected) !== order(expected, nav.groups)) rows.push(iaRow("R01.13", publisher, `nav groups run ${order(nav.groups, expected)}; chain order is ${order(expected, nav.groups)}`));
  for (const view of views) {
    if (!nav.groups.includes(view.agent.agent)) continue;
    const shown = nav.pages.filter(page => page.nav && page.group === view.agent.agent).map(page => lastSegment(page.path));
    const l0s = view.l0s.map(node => node.id);
    for (const l0 of l0s) if (!shown.includes(l0)) rows.push(iaRow("R01.13", publisher, `nav group ${view.agent.agent} has no page for ${view.agent.agent} L0 ${l0}`));
    for (const page of shown) if (!l0s.includes(page)) rows.push(iaRow("R01.13", publisher, `nav group ${view.agent.agent} shows ${page}, which is not a ${view.agent.agent} L0 (${l0s.join(", ")})`));
    if (order(shown, l0s) !== order(l0s, shown)) rows.push(iaRow("R01.13", publisher, `nav group ${view.agent.agent} orders its pages ${order(shown, l0s)}; ia.json orders the L0s ${order(l0s, shown)}`));
  }
  for (const page of nav.pages) if (!page.nav && !page.hidden) {
    rows.push(row("R01", "R01.13", { agent: "publisher", id: page.id }, `route ${page.path ?? "(no path)"} is not reachable from the nav and not declared hidden (nav: {hidden: true})`, page.recordPath));
  }
  return rows;
}

/** R01.14 IA-EXTENSION-FACET: extension is a leaf property under a Foundry L1, never a tab. */
export function iaExtensionFacet(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const view of viewsOf(ctx)) {
    const listed = new Set(view.extensions);
    const tabOf = new Map<string, L1View>();
    for (const node of view.l0s) for (const tab of node.l1s) for (const leaf of tab.leaves) if (!tabOf.has(leaf)) tabOf.set(leaf, tab);
    for (const { id, record } of liveSlots(view.agent)) {
      const doc = isObject(record?.slot?.value) ? record.slot.value : undefined;
      const flagged = doc?.extension === true;
      const tab = tabOf.get(id);
      const provenance = tab !== undefined && isProvenance(tab);
      const ref = { agent: view.agent.agent, id };
      const path = record?.slot?.path ?? view.path;
      if (listed.has(id) && doc && !flagged) rows.push(row("R01", "R01.14", ref, "listed in ia.json extensions, but slot.json has no extension: true", path));
      if (!listed.has(id) && flagged) rows.push(row("R01", "R01.14", ref, "slot.json says extension: true, but ia.json extensions does not list it", path));
      if (provenance && listed.has(id)) rows.push(row("R01", "R01.14", ref, `extension sits in the provenance tab ${tab.id} (${tab.label}): place it under its Foundry L1`, view.path));
      if (provenance && !listed.has(id)) rows.push(row("R01", "R01.14", ref, `leaf in the provenance tab ${tab.id} (${tab.label}) is not in ia.json extensions`, view.path));
    }
  }
  return rows;
}

/** R01.15 IA-FANOUT (warn): an L0 with one L1, or an L1 with one leaf. */
export function iaFanout(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const view of viewsOf(ctx)) for (const node of view.l0s) {
    if (node.l1s.length === 1) rows.push(iaRow("R01.15", view, `${where(node)} has one L1 (${node.l1s[0]!.id})`));
    for (const tab of node.l1s) if (tab.leaves.length === 1) rows.push(iaRow("R01.15", view, `${where(node, tab)} has one leaf (${tab.leaves[0]})`));
  }
  return rows;
}

/**
 * R01.16 IA-EMPTY-GROUP: an L2 group that places no leaf. Read from the raw nodes, not the level view, so a group is
 * caught however its L1 is read (a layered L1, a dotted-prefix L1, or the child of an undotted node read as L0).
 */
export function iaEmptyGroup(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const view of viewsOf(ctx)) for (const node of rawNodes(view.agent.ia!.value as Record<string, unknown>)) {
    for (const child of node.children) if (!child.slots.length) {
      rows.push(iaRow("R01.16", view, `L2 group ${node.id}/${child.id}${child.label ? ` (${child.label})` : ""} places no leaf: fill it or drop it (clossys ia ${view.agent.agent} --drop ${node.id}/${child.id})`));
    }
  }
  return rows;
}

/** The IA checks, by check id; R01 (checks/R01-catalog.ts) spreads them into its module. */
export const R01_IA_CHECKS: Readonly<Record<string, Check>> = {
  "R01.7": iaAxis,
  "R01.8": iaDepth,
  "R01.9": iaNoConsumer,
  "R01.10": iaNoMirror,
  "R01.11": iaSharedAxis,
  "R01.12": iaLabelUnique,
  "R01.13": navIaParity,
  "R01.14": iaExtensionFacet,
  "R01.15": iaFanout,
  "R01.16": iaEmptyGroup,
};
