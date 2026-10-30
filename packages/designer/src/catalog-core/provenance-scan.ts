/**
 * Provenance scan (D3): a pure reader of server-rendered HTML. It reads the `data-ds-*` stamps that
 * provenance-attrs alone writes, reports wiring findings for one route and returns the runtime
 * observations a usage graph accepts as `runtime` input. No DOM, no network and no React: the input
 * is the markup string, the route's binding, the selection and (optionally) the route's usage graph.
 */
import { WIRING_GUIDANCE } from "./check-guidance.js";
import { DS_ATTR, DS_LAYERS, type DsLayer } from "./provenance-attrs.js";
import type { UsageBindingLike, UsageEdgeKind, UsageGraph, UsageRuntimeObservation } from "./usage-graph.js";
import type { WiringCode } from "./wiring.js";

// The four runtime (DOM) codes this scanner reports; their definitions are WIRE-2's wiring guidance.
export type ProvenanceFindingCode = Extract<WiringCode, "WL1" | "WL5" | "WL6" | "WL7">;
export const PROVENANCE_FINDING_CODES: Readonly<Record<ProvenanceFindingCode, string>> = Object.freeze({
  WL1: WIRING_GUIDANCE.WL1.meaning,
  WL5: WIRING_GUIDANCE.WL5.meaning,
  WL6: WIRING_GUIDANCE.WL6.meaning,
  WL7: WIRING_GUIDANCE.WL7.meaning,
});

export interface ProvenanceFinding {
  readonly code: ProvenanceFindingCode;
  readonly severity: "error";
  readonly subject: string;
  readonly message: string;
  readonly selector?: string;
}
/** A package-pointer surface: the component fills it is bound to, by component leaf. */
export interface ProvenanceSurfaceBinding { readonly leaf: string; readonly components: Readonly<Record<string, string>> }
export interface ProvenanceScanInput {
  readonly html: string;
  readonly route: { readonly id: string; readonly binding: UsageBindingLike };
  readonly selection: Readonly<Record<string, string>>;
  /** The route's usage graph. Without it WL5 reports only malformed or missing stamps. */
  readonly graph?: UsageGraph;
  readonly surfaces?: readonly ProvenanceSurfaceBinding[];
  /**
   * Selected consumer fill id → the package fill its renderer stamps (`planSurfaceRuntime().origins`).
   * An adopted package pointer renders the package's own stamp; WL7 accepts exactly that origin.
   */
  readonly fillOrigins?: Readonly<Record<string, string>>;
}
export interface ProvenanceScan {
  readonly findings: readonly ProvenanceFinding[];
  /** Nearest-stamped-ancestor edges, ready for `buildUsageGraph({ runtime })`. */
  readonly observations: readonly UsageRuntimeObservation[];
}

interface Element {
  readonly tag: string;
  readonly attrs: ReadonlyMap<string, string>;
  readonly parent?: Element;
  readonly children: Element[];
  stamp?: { readonly layer: DsLayer; readonly leaf: string; readonly fill?: string };
}
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title"]);
const TAG = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[^\s"'=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const ATTR = /\s+([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const ENTITY: Readonly<Record<string, string>> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
const decode = (value: string): string => value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) =>
  code[0] === "#" ? String.fromCodePoint(Number.parseInt(code.slice(code[1] === "x" || code[1] === "X" ? 2 : 1), code[1] === "x" || code[1] === "X" ? 16 : 10)) : ENTITY[code.toLowerCase()] ?? match);

/** A tolerant tree builder for rendered markup: comments, doctype and raw-text bodies are skipped. */
function parse(html: string): Element {
  const root: Element = { tag: "#root", attrs: new Map(), children: [] };
  let open: Element = root, index = 0;
  while (index < html.length) {
    const next = html.indexOf("<", index);
    if (next < 0) break;
    if (html.startsWith("<!--", next)) { const end = html.indexOf("-->", next + 4); index = end < 0 ? html.length : end + 3; continue; }
    if (html.startsWith("<!", next) || html.startsWith("<?", next)) { const end = html.indexOf(">", next); index = end < 0 ? html.length : end + 1; continue; }
    TAG.lastIndex = next;
    const match = TAG.exec(html);
    if (!match) { index = next + 1; continue; }
    index = TAG.lastIndex;
    const tag = match[2]!.toLowerCase();
    if (match[1]) {
      let cursor: Element | undefined = open;
      while (cursor && cursor.tag !== tag) cursor = cursor.parent;
      if (cursor?.parent) open = cursor.parent;
      continue;
    }
    const attrs = new Map<string, string>();
    for (const attr of match[3]!.matchAll(ATTR)) attrs.set(attr[1]!.toLowerCase(), decode(attr[2] ?? attr[3] ?? attr[4] ?? ""));
    const element: Element = { tag, attrs, parent: open, children: [] };
    open.children.push(element);
    if (RAW.has(tag)) { const end = html.toLowerCase().indexOf(`</${tag}`, index); index = end < 0 ? html.length : html.indexOf(">", end) + 1 || html.length; continue; }
    if (!VOID.has(tag) && !match[4]) open = element;
  }
  return root;
}
function* walk(element: Element): Generator<Element> {
  for (const child of element.children) { yield child; yield* walk(child); }
}
const ancestors = function* (element: Element): Generator<Element> {
  for (let cursor = element.parent; cursor; cursor = cursor.parent) yield cursor;
};
const nearestStamp = (element: Element): Element | undefined => { for (const item of ancestors(element)) if (item.stamp) return item; return undefined; };
const within = (element: Element, layer: DsLayer, self = true): boolean => (self && element.stamp?.layer === layer) || [...ancestors(element)].some(item => item.stamp?.layer === layer);
function selectorOf(element: Element): string {
  const chain = [element, ...ancestors(element)].filter(item => item.stamp).reverse().map(item => `[${DS_ATTR.leaf}="${item.stamp!.leaf}"]`);
  return element.stamp ? chain.join(" ") : [...chain, element.tag].join(" ");
}
function interactive(element: Element): boolean {
  const { tag, attrs } = element;
  if (attrs.has("role") || attrs.has("tabindex") || attrs.has("contenteditable")) return true;
  if (tag === "a") return attrs.has("href");
  if (tag === "input") return attrs.get("type")?.toLowerCase() !== "hidden";
  return ["button", "select", "textarea", "summary", "iframe"].includes(tag);
}
const styled = (element: Element): boolean => element.attrs.has("class") || element.attrs.has("style");
function edgeKind(from: Element, to: Element): UsageEdgeKind {
  if (from.stamp!.layer === "pages") return "renders";
  return from.stamp!.layer === "frames" && to.stamp!.layer === "sections" ? "hosts" : "composes";
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export function scanProvenance(input: ProvenanceScanInput): ProvenanceScan {
  const findings: ProvenanceFinding[] = [];
  const report = (code: ProvenanceFindingCode, subject: string, message: string, selector?: string): void => { findings.push({ code, severity: "error", subject, message, ...(selector ? { selector } : {}) }); };
  const root = parse(input.html), route = input.route.id, pageLeaf = `pages.${route}`;
  // Stamps: all three attributes, a known layer and a leaf inside that layer. Anything less is unlinked.
  for (const element of walk(root)) {
    const layer = element.attrs.get(DS_ATTR.layer), leaf = element.attrs.get(DS_ATTR.leaf), fill = element.attrs.get(DS_ATTR.fill);
    if (layer === undefined && leaf === undefined && fill === undefined) continue;
    if (!layer || !(DS_LAYERS as readonly string[]).includes(layer) || !leaf || !leaf.startsWith(`${layer}.`)) { report("WL5", leaf ?? layer ?? element.tag, "malformed provenance stamp", selectorOf(element)); continue; }
    element.stamp = { layer: layer as DsLayer, leaf, ...(fill ? { fill } : {}) };
  }
  // A Section a selected Section renders internally (a PricingTable's SectionHeader) is part of the outer
  // fill, not a placement or selection of its own: everything under it is attributed to the outer Section.
  for (const element of walk(root)) if (element.stamp?.layer === "sections" && within(element, "sections", false)) delete element.stamp;
  const stamped = [...walk(root)].filter(element => element.stamp);
  const pages = stamped.filter(element => element.stamp!.layer === "pages");
  if (!pages.length) report("WL5", pageLeaf, "page root stamp is missing; the whole document is scanned as the page");
  for (const page of pages) if (page.stamp!.leaf !== pageLeaf) report("WL5", page.stamp!.leaf, `page root names ${page.stamp!.leaf}, route is ${pageLeaf}`, selectorOf(page));
  const scopes = pages.length ? pages : [root];
  const inScope = (element: Element): boolean => scopes.includes(element) || [...ancestors(element)].some(item => scopes.includes(item));

  // Observations: each stamp hangs from its nearest stamped ancestor.
  const observations = new Map<string, UsageRuntimeObservation>();
  for (const element of stamped) {
    const parent = nearestStamp(element);
    if (!parent || element.stamp!.layer === "pages") continue;
    const row = { from: parent.stamp!.leaf, to: element.stamp!.leaf, kind: edgeKind(parent, element), route, selector: selectorOf(element) };
    observations.set(JSON.stringify([row.from, row.to, row.kind, row.selector]), row);
  }

  // WL1: chrome a page draws outside every Section or Frame, or inside a frame content slot without a Section.
  const reported = new Set<Element>();
  for (const element of walk(root)) {
    if (!inScope(element) || scopes.includes(element) || element.stamp?.layer === "frames" || [...ancestors(element)].some(item => reported.has(item))) continue;
    if (!styled(element) && !interactive(element)) continue;
    if (within(element, "sections")) continue;
    const frame = [...ancestors(element)].find(item => item.stamp?.layer === "frames");
    if (frame) {
      // The frame's own chrome is frame-owned; its <main> content slot holds Sections only.
      const slot = [...ancestors(element)].find(item => item.tag === "main" && [...ancestors(item)].includes(frame));
      if (!slot || element.tag === "main") continue;
      reported.add(element); report("WL1", frame.stamp!.leaf, `<${element.tag}> in the frame content slot has no Section ancestor`, selectorOf(element));
      continue;
    }
    reported.add(element); report("WL1", pageLeaf, `<${element.tag}> renders outside any Section or Frame`, selectorOf(element));
  }

  // WL6: the route's declared Sections against the outermost rendered Section stamps.
  const declared = new Map<string, number>(), rendered = new Map<string, { count: number; selector: string }>();
  for (const placements of [input.route.binding.sections, input.route.binding.frameSlots]) for (const rows of Object.values(placements)) for (const row of rows) declared.set(row.leaf, (declared.get(row.leaf) ?? 0) + 1);
  for (const element of stamped) if (element.stamp!.layer === "sections" && inScope(element)) {
    const entry = rendered.get(element.stamp!.leaf);
    rendered.set(element.stamp!.leaf, { count: (entry?.count ?? 0) + 1, selector: entry?.selector ?? selectorOf(element) });
  }
  for (const leaf of [...new Set([...declared.keys(), ...rendered.keys()])].sort(compare)) {
    const want = declared.get(leaf) ?? 0, got = rendered.get(leaf)?.count ?? 0;
    if (want > got) report("WL6", leaf, `declared ${want} time(s) in the route binding, rendered ${got}`);
    else if (got > want) report("WL6", leaf, `rendered ${got} time(s), declared ${want} in the route binding`, rendered.get(leaf)!.selector);
  }

  // WL7: the rendered fill is the selected fill; package-pointer surfaces bind the selected components.
  for (const element of stamped) {
    const { layer, leaf, fill } = element.stamp!;
    if (!fill) { report("WL7", leaf, "stamp names no fill", selectorOf(element)); continue; }
    if (layer === "pages") continue;
    const selected = input.selection[leaf];
    if (!selected) report("WL7", leaf, `renders ${fill}, but the leaf has no selected fill`, selectorOf(element));
    else if (selected !== fill && input.fillOrigins?.[selected] !== fill) report("WL7", leaf, `renders ${fill}, selection is ${selected}`, selectorOf(element));
  }
  for (const surface of input.surfaces ?? []) for (const [leaf, bound] of Object.entries(surface.components).sort(([a], [b]) => compare(a, b))) {
    const selected = input.selection[leaf];
    if (selected !== bound) report("WL7", surface.leaf, `binds ${leaf} to ${bound}, selection is ${selected ?? "none"}`);
  }

  // WL5 against the route's usage graph: rendered leaves and edges it lacks, and its route edges with an
  // unselected or (for components) unrendered endpoint.
  const graph = input.graph;
  if (graph) {
    const nodes = new Set(graph.nodes.map(node => node.id));
    const edges = new Set(graph.edges.map(edge => JSON.stringify([edge.from, edge.to, edge.kind])));
    for (const element of stamped) if (!nodes.has(element.stamp!.leaf)) report("WL5", element.stamp!.leaf, "rendered leaf has no usage-graph node", selectorOf(element));
    for (const row of observations.values()) if (!edges.has(JSON.stringify([row.from, row.to, row.kind]))) report("WL5", row.to, `rendered ${row.kind} edge ${row.from} -> ${row.to} is not in the usage graph`, row.selector);
    const renderedUnder = (from: string, to: string): boolean => stamped.some(element => element.stamp!.leaf === to && nearestStamp(element)?.stamp!.leaf === from);
    for (const edge of graph.edges) {
      if (edge.from !== pageLeaf && !edge.at?.some(site => site.route === route)) continue;
      for (const end of [edge.from, edge.to]) if (!end.startsWith("pages.") && !input.selection[end]) report("WL5", end, `usage-graph ${edge.kind} edge ${edge.from} -> ${edge.to} has an unselected endpoint`);
      if (edge.to.startsWith("components.") && input.selection[edge.to] && !renderedUnder(edge.from, edge.to)) {
        report("WL5", edge.to, `usage-graph ${edge.kind} edge ${edge.from} -> ${edge.to} is not rendered on ${route}`);
        report("WL7", edge.to, `selected fill ${input.selection[edge.to]} is not rendered under ${edge.from}`);
      }
    }
  }
  const unique = new Map(findings.map(finding => [JSON.stringify(finding), finding]));
  return {
    findings: [...unique.values()].sort((a, b) => compare(a.code, b.code) || compare(a.subject, b.subject) || compare(a.message, b.message) || compare(a.selector ?? "", b.selector ?? "")),
    observations: [...observations.values()].sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to) || compare(a.selector, b.selector)),
  };
}
