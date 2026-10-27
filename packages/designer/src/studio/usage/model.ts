/**
 * The Usage area's data (spec C1-C5, OWN-1). Every list is read from the usage graph API (B5) and nothing
 * else: no per-tab computation, and the host supplies the graph (the committed report by default).
 */
import { closure, graphFindings, usedBy, uses, type UsageEdge, type UsageEdgeKind, type UsageEvidence, type UsageGraph, type UsageLayer, type UsageNode } from "../../catalog-core/usage-graph.js";
import type { WiringException } from "../../catalog-core/wiring.js";
import type { ComputedBlockRelations, ComputedLeafConsumers } from "../../catalog/types.js";

/** Lowest layer first. "Using what" reads in this order (below first); "Used where" in reverse (above first). */
export const USAGE_LAYERS: readonly UsageLayer[] = ["tokens", "assets", "components", "sections", "frames", "pages"];
const EVIDENCE: readonly UsageEvidence[] = ["declared", "scanned", "runtime"];

/** One row: the element at the other end, its selected fill, and (direct rows) the edge kinds, evidence and site count. */
export interface UsageRow {
  readonly id: string;
  /** The leaf a selection navigates to; a member row navigates to its leaf. */
  readonly leaf: string;
  readonly layer: UsageLayer;
  readonly fill?: UsageNode["fill"];
  /** Absent on a transitive row: closure() reports reachability, not one edge. */
  readonly kinds?: readonly UsageEdgeKind[];
  readonly evidence?: readonly UsageEvidence[];
  /** Sites that evidence the edges (file lines, route slots, runtime selectors); one per edge that names none. Absent on a transitive row. */
  readonly count?: number;
}
export interface UsageGroup { readonly layer: UsageLayer; readonly rows: readonly UsageRow[] }
/** A WL5 provenance finding for this element: shown as a "not linked" row with its code. */
export interface UsageNotLinked { readonly code: string; readonly subject: string; readonly message: string }
export interface UsageModel {
  readonly id: string;
  readonly node?: UsageNode;
  readonly using: readonly UsageGroup[];
  readonly usedWhere: readonly UsageGroup[];
  /** Reads and Composes (OWN-1): the direct out-edges of each kind. */
  readonly reads: readonly UsageRow[];
  readonly composes: readonly UsageRow[];
  /** Options (OWN-1): the member ids the graph names under this leaf. */
  readonly options: readonly string[];
  /** Owns (OWN-1): wiring exceptions recorded in a source file this element's own edges were scanned from. */
  readonly owns: readonly WiringException[];
  /** Wiring exceptions whose direct read is this element or one of its members. */
  readonly exceptions: readonly WiringException[];
  readonly notLinked: readonly UsageNotLinked[];
  /** A selected leaf the graph reports as used nowhere. */
  readonly usedNowhere: boolean;
}

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const byId = (a: { id: string }, b: { id: string }): number => compare(a.id, b.id);
const layerOf = (id: string): UsageLayer | undefined => USAGE_LAYERS.find(layer => id.startsWith(layer + "."));
const leafOf = (id: string): string => id.startsWith("pages.") ? id : id.split(".").slice(0, 2).join(".");
const sorted = <T extends string>(values: readonly T[]): T[] => [...new Set(values)].sort(compare);

/** graphFindings() walks the whole graph; one pass per graph object. */
const usedNowhereByGraph = new WeakMap<UsageGraph, ReadonlySet<string>>();
function usedNowhereSubjects(graph: UsageGraph): ReadonlySet<string> {
  let subjects = usedNowhereByGraph.get(graph);
  if (!subjects) usedNowhereByGraph.set(graph, subjects = new Set(graphFindings(graph).filter(finding => finding.code === "used-nowhere").map(finding => finding.subject)));
  return subjects;
}

/** The element and every member the graph names under it, so a token's member reads count as the token's. */
function subjects(graph: UsageGraph, id: string): readonly string[] {
  return [id, ...graph.nodes.filter(node => node.leaf === id && node.id !== id).map(node => node.id)];
}
function row(graph: UsageGraph, id: string, edges: readonly UsageEdge[]): UsageRow | undefined {
  const node = graph.nodes.find(candidate => candidate.id === id), layer = node?.layer ?? layerOf(id);
  if (!layer) return undefined;
  const base = { id, leaf: node?.leaf ?? leafOf(id), layer, ...(node?.fill ? { fill: node.fill } : {}) };
  if (!edges.length) return base;
  return { ...base, kinds: sorted(edges.map(edge => edge.kind)), evidence: EVIDENCE.filter(value => edges.some(edge => edge.evidence.includes(value))),
    count: edges.reduce((sum, edge) => sum + Math.max(1, edge.at?.length ?? 0), 0) };
}
function direct(graph: UsageGraph, edges: readonly UsageEdge[], end: (edge: UsageEdge) => string): UsageRow[] {
  const byEnd = new Map<string, UsageEdge[]>();
  for (const edge of edges) byEnd.set(end(edge), [...byEnd.get(end(edge)) ?? [], edge]);
  return [...byEnd].flatMap(([id, list]) => row(graph, id, list) ?? []).sort(byId);
}
function grouped(rows: readonly UsageRow[], order: readonly UsageLayer[]): UsageGroup[] {
  return order.flatMap(layer => { const list = rows.filter(entry => entry.layer === layer); return list.length ? [{ layer, rows: list }] : []; });
}
/** A scanned site names a repository path; an exception names a package path. */
const sameFile = (site: string, file: string): boolean => site === file || site.endsWith("/" + file);

export interface UsageModelOptions {
  /** Use closure() instead of direct edges. */
  readonly transitive?: boolean;
  readonly exceptions?: readonly WiringException[];
  readonly findings?: readonly UsageNotLinked[];
}
export function usageModel(graph: UsageGraph, id: string, options: UsageModelOptions = {}): UsageModel {
  const node = graph.nodes.find(candidate => candidate.id === id);
  const ids = subjects(graph, id), self = new Set(ids);
  const out = ids.flatMap(subject => uses(graph, subject)), into = ids.flatMap(subject => usedBy(graph, subject));
  const reach = (dir: "uses" | "usedBy") => sorted(ids.flatMap(subject => closure(graph, subject, dir))).filter(other => !self.has(other)).flatMap(other => row(graph, other, []) ?? []);
  const using = options.transitive ? reach("uses") : direct(graph, out, edge => edge.to);
  const usedWhere = options.transitive ? reach("usedBy") : direct(graph, into, edge => edge.from);
  const files = new Set(out.flatMap(edge => edge.at ?? []).flatMap(site => site.file ? [site.file] : []));
  const exceptions = options.exceptions ?? [];
  return {
    id, ...(node ? { node } : {}),
    using: grouped(using, USAGE_LAYERS), usedWhere: grouped(usedWhere, [...USAGE_LAYERS].reverse()),
    reads: direct(graph, out.filter(edge => edge.kind === "reads"), edge => edge.to),
    composes: direct(graph, out.filter(edge => edge.kind === "composes"), edge => edge.to),
    options: sorted(ids.slice(1)),
    owns: exceptions.filter(exception => [...files].some(file => sameFile(file, exception.file))),
    exceptions: exceptions.filter(exception => exception.read === id || leafOf(exception.read) === id),
    notLinked: (options.findings ?? []).filter(finding => finding.code === "WL5" && (finding.subject === id || leafOf(finding.subject) === id)),
    usedNowhere: !into.length && usedNowhereSubjects(graph).has(id),
  };
}

/** The catalog computed `consumers` field (catalog/types.ts) of a token or glyph leaf, from the graph. */
export function usageConsumers(graph: UsageGraph, leaf: string): ComputedLeafConsumers {
  return { consumers: sorted(subjects(graph, leaf).flatMap(subject => usedBy(graph, subject)).map(edge => edge.from)) };
}
/** The catalog computed relations (catalog/types.ts) of a block, read from its section leaf in the graph. */
export function usageBlockRelations(graph: UsageGraph, sectionLeaf: string): ComputedBlockRelations {
  const out = uses(graph, sectionLeaf);
  return {
    components: sorted(out.flatMap(edge => edge.kind === "composes" && edge.to.startsWith("components.") ? [edge.to as `components.${string}`] : [])),
    tokens: sorted(out.flatMap(edge => edge.kind === "reads" && edge.to.startsWith("tokens.") ? [edge.to as `tokens.${string}`] : [])),
    composedBy: sorted(usedBy(graph, sectionLeaf).map(edge => edge.from)),
  };
}
