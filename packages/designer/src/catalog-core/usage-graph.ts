/**
 * The cross-layer usage graph: one registry of who uses what, derived only from existing
 * producers (consumptionReport, components consumption, buildSurfaceConsumption and the
 * route registry's runtime assembly bindings). Pure: no I/O, no clock, no hand-maintained rows.
 */
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";

export type UsageLayer = "tokens" | "assets" | "components" | "sections" | "frames" | "pages";
export type UsageEdgeKind = "reads" | "composes" | "hosts" | "renders";
export type UsageEvidence = "declared" | "scanned" | "runtime";
export type UsageDirection = "uses" | "usedBy";
export interface UsageNode {
  readonly id: string;
  readonly layer: UsageLayer;
  readonly leaf: string;
  /** The selected fill; absent when nothing is selected for the leaf. */
  readonly fill?: { readonly id: string; readonly source: string };
  /** Which input introduced the node: catalog inventory, a registered route, or only an edge reference. */
  readonly origin: "inventory" | "route" | "reference";
  /** Static source measurement of the selected fill, when a producer reported one. */
  readonly scan?: string;
}
/** Scanned edges carry file/line/tag; route edges carry route and slot; runtime edges carry route and selector. */
export interface UsageEdgeSite { readonly file?: string; readonly line?: number; readonly tag?: string; readonly route?: string; readonly slot?: string; readonly selector?: string }
export interface UsageEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: UsageEdgeKind;
  /** Non-empty, in declared/scanned/runtime order; the declared/scanned difference is kept. */
  readonly evidence: readonly UsageEvidence[];
  readonly at?: readonly UsageEdgeSite[];
}
export interface UsageGraph {
  readonly schemaVersion: 1;
  /** Digest of every normalized input; a changed input always changes it. */
  readonly inputsHash: string;
  /** Per-input digest, or "absent" when the producer did not supply that input. */
  readonly inputs: Readonly<Record<"inventory" | "selection" | "consumption" | "components" | "surfaces" | "pages" | "runtime", string>>;
  readonly nodes: readonly UsageNode[];
  readonly edges: readonly UsageEdge[];
  readonly summary: {
    readonly nodes: Readonly<Record<UsageLayer, number>>;
    readonly edges: Readonly<Record<UsageEdgeKind, number>>;
    readonly evidence: Readonly<Record<UsageEvidence, number>>;
  };
}

type Reads = Partial<Record<"tokens" | "assets", readonly string[]>>;
/** A fill row as emitted by components consumption or buildSurfaceConsumption. */
export interface UsageGraphFill {
  readonly id: string;
  readonly slot: string;
  readonly scanStatus?: string;
  readonly declaredReads?: Reads;
  readonly scannedReads?: Reads;
  readonly observedComposes?: readonly { readonly file: string; readonly line: number; readonly slotId: string; readonly tag?: string }[];
}
/** Composed leaf -> parents. Parents are fill ids ("source/leaf") or, from a consumer emit, selected leaf ids. */
export type UsageReverseComposes = Readonly<Record<string, readonly string[] | { readonly declared?: readonly string[]; readonly scanned?: readonly string[]; readonly effective?: readonly string[] }>>;
export interface UsageFillSelectionLike { readonly leaf: string; readonly fill?: string }
export interface UsageBindingLike {
  readonly frame: UsageFillSelectionLike;
  readonly frameSlots: Readonly<Record<string, readonly UsageFillSelectionLike[]>>;
  readonly sections: Readonly<Record<string, readonly UsageFillSelectionLike[]>>;
}
export interface UsageRuntimeObservation { readonly from: string; readonly to: string; readonly kind: UsageEdgeKind; readonly route: string; readonly selector: string }
export interface UsageGraphInputs {
  readonly inventory: Partial<Record<Exclude<UsageLayer, "pages">, readonly string[]>>;
  /** Leaf -> selected fill id. Only selected fills contribute edges. */
  readonly selection: Readonly<Record<string, string>>;
  /** relationships.ts consumptionReport: token/asset reads. */
  readonly consumption?: { readonly leaves: readonly { readonly id: string; readonly tokens: readonly string[]; readonly assets: readonly string[] }[] };
  /** components-consumption.json: component reads and reverseComposes. */
  readonly components?: { readonly fills?: readonly UsageGraphFill[]; readonly reverseComposes?: UsageReverseComposes };
  /** buildSurfaceConsumption(): section/frame reads and reverseComposes. */
  readonly surfaces?: { readonly fills?: readonly UsageGraphFill[]; readonly reverseComposes?: UsageReverseComposes };
  /** Route registry projection: one RuntimeAssemblyBinding per registered route. */
  readonly pages?: readonly { readonly routeId: string; readonly binding: UsageBindingLike }[];
  /** DOM provenance (section D). Absent until a capture run supplies it; absence is never an error. */
  readonly runtime?: readonly UsageRuntimeObservation[];
}
export interface UsageGraphFinding {
  readonly code: "dangling-endpoint" | "unselected-endpoint" | "unused-declaration" | "used-nowhere";
  readonly severity: "warning" | "notice";
  readonly subject: string;
  readonly target?: string;
  readonly kind?: UsageEdgeKind;
  readonly message: string;
}

const LAYERS: readonly UsageLayer[] = ["tokens", "assets", "components", "sections", "frames", "pages"];
const KINDS: readonly UsageEdgeKind[] = ["reads", "composes", "hosts", "renders"];
const EVIDENCE: readonly UsageEvidence[] = ["declared", "scanned", "runtime"];
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const digest = (value: unknown): string => `sha256:${sha256(stableStringify(value))}`;
const layerOf = (id: string): UsageLayer | undefined => LAYERS.find(layer => id.startsWith(layer + "."));
/** `tokens.region-width.aside` -> `tokens.region-width`; leaf names never contain dots. */
const leafOf = (id: string): string => id.split(".").slice(0, 2).join(".");
const slotOfFill = (fill: string): string => fill.includes("/") ? fill.slice(fill.indexOf("/") + 1) : fill;
const sourceOfFill = (fill: string): string => fill.includes("/") ? fill.slice(0, fill.indexOf("/")) : fill;

export function buildUsageGraph(inputs: UsageGraphInputs): UsageGraph {
  const selection = inputs.selection;
  const selected = (fill: string): boolean => selection[slotOfFill(fill)] === fill;
  const nodes = new Map<string, UsageNode>();
  for (const layer of LAYERS) for (const id of layer === "pages" ? [] : inputs.inventory[layer] ?? []) {
    const fill = selection[id];
    nodes.set(id, { id, layer, leaf: id, ...(fill ? { fill: { id: fill, source: sourceOfFill(fill) } } : {}), origin: "inventory" });
  }
  for (const fill of [...inputs.components?.fills ?? [], ...inputs.surfaces?.fills ?? []]) {
    const node = nodes.get(fill.slot);
    if (node && fill.scanStatus && selected(fill.id)) nodes.set(fill.slot, { ...node, scan: fill.scanStatus });
  }
  const edges = new Map<string, { from: string; to: string; kind: UsageEdgeKind; evidence: Set<UsageEvidence>; at: Map<string, UsageEdgeSite> }>();
  const add = (from: string, to: string, kind: UsageEdgeKind, evidence: UsageEvidence, at?: UsageEdgeSite): void => {
    if (from === to) return;
    const key = stableStringify([from, to, kind]);
    const edge = edges.get(key) ?? { from, to, kind, evidence: new Set<UsageEvidence>(), at: new Map<string, UsageEdgeSite>() };
    edge.evidence.add(evidence); if (at) edge.at.set(stableStringify(at), at); edges.set(key, edge);
  };
  // Token/asset reads, already limited to selected fills by consumptionReport.
  for (const leaf of inputs.consumption?.leaves ?? []) for (const target of [...leaf.tokens, ...leaf.assets]) add(leaf.id, target, "reads", "declared");
  // Component, section and frame reads from the selected fill's declared contract and source scan.
  for (const fill of [...inputs.components?.fills ?? [], ...inputs.surfaces?.fills ?? []]) {
    if (!selected(fill.id)) continue;
    for (const [evidence, reads] of [["declared", fill.declaredReads], ["scanned", fill.scannedReads]] as const)
      for (const target of [...reads?.tokens ?? [], ...reads?.assets ?? []]) add(fill.slot, target, "reads", evidence);
  }
  // Composition, only through each producer's reverseComposes map.
  const observed = new Map<string, UsageEdgeSite[]>();
  for (const fill of [...inputs.components?.fills ?? [], ...inputs.surfaces?.fills ?? []]) if (selected(fill.id))
    for (const row of fill.observedComposes ?? []) observed.set(`${fill.slot}>${row.slotId}`, [...observed.get(`${fill.slot}>${row.slotId}`) ?? [], { file: row.file, line: row.line, ...(row.tag ? { tag: row.tag } : {}) }]);
  for (const reverse of [inputs.components?.reverseComposes, inputs.surfaces?.reverseComposes]) for (const [target, parents] of Object.entries(reverse ?? {})) {
    const rows: [UsageEvidence, readonly string[]][] = Array.isArray(parents) ? [["declared", parents as readonly string[]]] : [["declared", (parents as { declared?: readonly string[] }).declared ?? []], ["scanned", (parents as { scanned?: readonly string[] }).scanned ?? []]];
    for (const [evidence, ids] of rows) for (const parent of ids) {
      // A fill id counts only when selected; a bare leaf id comes from a selection-only consumer emit.
      if (parent.includes("/") ? !selected(parent) : !selection[parent]) continue;
      const from = slotOfFill(parent);
      add(from, target, "composes", evidence);
      if (evidence === "scanned") for (const site of observed.get(`${from}>${target}`) ?? []) add(from, target, "composes", evidence, site);
    }
  }
  // Pages: a route renders its frame and sections; the frame hosts the sections placed in its slots.
  for (const page of inputs.pages ?? []) {
    const id = `pages.${page.routeId}`, frame = page.binding.frame.leaf;
    nodes.set(id, { id, layer: "pages", leaf: id, origin: "route" });
    add(id, frame, "renders", "declared", { route: page.routeId });
    for (const placements of [page.binding.frameSlots, page.binding.sections]) for (const [slot, rows] of Object.entries(placements)) for (const row of rows) {
      add(id, row.leaf, "renders", "declared", { route: page.routeId, slot });
      add(frame, row.leaf, "hosts", "declared", { route: page.routeId, slot });
    }
  }
  for (const row of inputs.runtime ?? []) add(row.from, row.to, row.kind, "runtime", { route: row.route, selector: row.selector });
  for (const edge of edges.values()) for (const id of [edge.from, edge.to]) {
    const layer = layerOf(id);
    if (!nodes.has(id) && layer) nodes.set(id, { id, layer, leaf: layer === "pages" ? id : leafOf(id), origin: "reference" });
  }
  const sortedEdges: UsageEdge[] = [...edges.values()].map(edge => ({
    from: edge.from, to: edge.to, kind: edge.kind, evidence: EVIDENCE.filter(value => edge.evidence.has(value)),
    ...(edge.at.size ? { at: [...edge.at.entries()].sort(([a], [b]) => compare(a, b)).map(([, site]) => site) } : {}),
  })).sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to) || compare(a.kind, b.kind));
  const sortedNodes = [...nodes.values()].sort((a, b) => compare(a.id, b.id));
  const normalized = {
    inventory: Object.fromEntries(LAYERS.filter(layer => layer !== "pages").map(layer => [layer, [...inputs.inventory[layer as Exclude<UsageLayer, "pages">] ?? []].sort(compare)])),
    selection: Object.fromEntries(Object.entries(selection).sort(([a], [b]) => compare(a, b))),
    consumption: inputs.consumption && [...inputs.consumption.leaves].map(leaf => ({ id: leaf.id, tokens: [...leaf.tokens].sort(compare), assets: [...leaf.assets].sort(compare) })).sort((a, b) => compare(a.id, b.id)),
    components: inputs.components && normalizeSource(inputs.components),
    surfaces: inputs.surfaces && normalizeSource(inputs.surfaces),
    pages: inputs.pages && [...inputs.pages].sort((a, b) => compare(a.routeId, b.routeId)),
    runtime: inputs.runtime && [...inputs.runtime].sort((a, b) => compare(stableStringify(a), stableStringify(b))),
  };
  const count = <K extends string>(keys: readonly K[], value: (key: K) => number) => Object.fromEntries(keys.map(key => [key, value(key)])) as Record<K, number>;
  return {
    schemaVersion: 1,
    inputsHash: digest(normalized),
    inputs: Object.fromEntries(Object.entries(normalized).map(([name, value]) => [name, value === undefined ? "absent" : digest(value)])) as UsageGraph["inputs"],
    nodes: sortedNodes,
    edges: sortedEdges,
    summary: {
      nodes: count(LAYERS, layer => sortedNodes.filter(node => node.layer === layer).length),
      edges: count(KINDS, kind => sortedEdges.filter(edge => edge.kind === kind).length),
      evidence: count(EVIDENCE, value => sortedEdges.filter(edge => edge.evidence.includes(value)).length),
    },
  };
}
function normalizeSource(source: NonNullable<UsageGraphInputs["components"]>) {
  const list = (values: readonly string[] | undefined) => [...values ?? []].sort(compare);
  return {
    fills: [...source.fills ?? []].map(fill => ({ id: fill.id, slot: fill.slot, scanStatus: fill.scanStatus, declaredReads: { tokens: list(fill.declaredReads?.tokens), assets: list(fill.declaredReads?.assets) }, scannedReads: fill.scannedReads && { tokens: list(fill.scannedReads.tokens), assets: list(fill.scannedReads.assets) },
      observedComposes: fill.observedComposes && [...fill.observedComposes].map(row => ({ file: row.file, line: row.line, slotId: row.slotId, tag: row.tag })).sort((a, b) => compare(stableStringify(a), stableStringify(b))) })).sort((a, b) => compare(a.id, b.id)),
    reverseComposes: source.reverseComposes && Object.fromEntries(Object.entries(source.reverseComposes).sort(([a], [b]) => compare(a, b)).map(([target, parents]) => [target, Array.isArray(parents) ? list(parents as readonly string[]) : { declared: list((parents as { declared?: readonly string[] }).declared), scanned: list((parents as { scanned?: readonly string[] }).scanned) }])),
  };
}

const resolveId = (graph: UsageGraph, id: string): string => graph.nodes.some(node => node.id === id) ? id : leafOf(id);
/** Out-edges: what `id` uses. A member id resolves to its leaf. */
export function uses(graph: UsageGraph, id: string): readonly UsageEdge[] {
  const subject = resolveId(graph, id); return graph.edges.filter(edge => edge.from === subject);
}
/** In-edges: where `id` is used. A member id resolves to its leaf. */
export function usedBy(graph: UsageGraph, id: string): readonly UsageEdge[] {
  const subject = resolveId(graph, id); return graph.edges.filter(edge => edge.to === subject);
}
/** Transitive closure (usesAll / usedByAll): sorted node ids reachable from `id`, excluding `id`. */
export function closure(graph: UsageGraph, id: string, dir: UsageDirection): readonly string[] {
  const start = resolveId(graph, id), seen = new Set<string>([start]), queue = [start];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of dir === "uses" ? uses(graph, current) : usedBy(graph, current)) {
      const next = dir === "uses" ? edge.to : edge.from;
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  seen.delete(start);
  return [...seen].sort(compare);
}
/**
 * Graph-local findings. Scanned-not-declared stays a DF/SEC-3 finding and is not repeated here;
 * WL error codes belong to the wiring checks, so nothing in this list is an error.
 */
export function graphFindings(graph: UsageGraph): readonly UsageGraphFinding[] {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const findings: UsageGraphFinding[] = [];
  for (const edge of graph.edges) {
    for (const end of [edge.from, edge.to]) {
      const node = nodes.get(end);
      if (!node || node.origin === "reference") findings.push({ code: "dangling-endpoint", severity: "warning", subject: edge.from, target: edge.to, kind: edge.kind, message: `${end} is not in the catalog inventory` });
      else if (node.origin === "inventory" && !node.fill) findings.push({ code: "unselected-endpoint", severity: "notice", subject: edge.from, target: edge.to, kind: edge.kind, message: `${end} has no selected fill` });
    }
    if ((edge.kind === "reads" || edge.kind === "composes") && edge.evidence.includes("declared") && !edge.evidence.includes("scanned") && nodes.get(edge.from)?.scan === "lower-bound")
      findings.push({ code: "unused-declaration", severity: "notice", subject: edge.from, target: edge.to, kind: edge.kind, message: `declared ${edge.kind} not observed in the scanned source` });
  }
  const used = new Set(graph.edges.map(edge => edge.to));
  for (const node of graph.nodes) if (node.origin === "inventory" && node.fill && !used.has(node.id))
    findings.push({ code: "used-nowhere", severity: "notice", subject: node.id, message: "selected but used nowhere" });
  const unique = new Map(findings.map(finding => [stableStringify(finding), finding]));
  return [...unique.values()].sort((a, b) => compare(a.code, b.code) || compare(a.subject, b.subject) || compare(a.target ?? "", b.target ?? "") || compare(a.kind ?? "", b.kind ?? ""));
}
/** The committed report: the graph plus its findings, stable bytes with no timestamps. */
export function serializeUsageGraph(graph: UsageGraph, meta: Readonly<Record<string, unknown>> = {}): string {
  return stableStringify({ ...meta, ...graph, findings: graphFindings(graph) });
}
