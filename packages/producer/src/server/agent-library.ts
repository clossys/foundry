/**
 * Studio agent libraries: one read-only projection shape for the Director, Writer and
 * Publisher galleries (`/<agent>`) and leaf details (`/<agent>/<leaf>`), fed by one
 * adapter per agent. Records come only through the agents' own readers: the shared cell
 * store (`readStudioCells`), Writer's `parseWriterCell`, the strategist's `parseCell` and
 * catalog, and Publisher's `contentMapFromCells`.
 *
 * REPLACE with the Publisher content-map projection when it lands, as for `designer-library`.
 */
import { join } from "node:path";
import type { AgentKind } from "../agents.js";
import { agentModule, agentRoot, hasCellTree, readStudioCells } from "./cells.js";
import { designerGallery } from "./designer-library.js";

export const LIBRARY_AGENTS = ["director", "writer", "publisher"] as const;
export type LibraryAgent = typeof LIBRARY_AGENTS[number];
export const isLibraryAgent = (value: string): value is LibraryAgent => (LIBRARY_AGENTS as readonly string[]).includes(value);

export type AgentLeafStatus = "active" | "draft" | "retired";
export interface AgentRef { readonly label: string; readonly agent?: AgentKind; readonly slug?: string }
export interface AgentCard {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly version: number;
  readonly status: AgentLeafStatus;
  /** One or two short lines of the specimen for the gallery card. */
  readonly excerpt: readonly string[];
}
export interface AgentSection { readonly id: string; readonly label: string; readonly level: 0 | 1 | 2; readonly cards: readonly AgentCard[] }
export interface AgentGallery {
  readonly agent: LibraryAgent;
  /** `ia` when the agent's own IA data placed the leaves; `kind` when they are grouped by record kind. */
  readonly grouping: "ia" | "kind";
  readonly sections: readonly AgentSection[];
  readonly count: number;
}
export interface AgentSpecimenRow { readonly label: string; readonly text: string; readonly ref?: AgentRef }
export interface AgentCheck { readonly label: string; readonly ok: boolean; readonly detail?: string }
export interface AgentHistoryRow { readonly version: number; readonly status: AgentLeafStatus; readonly updated: string; readonly note: string; readonly active: boolean }
export interface AgentLeaf {
  readonly agent: LibraryAgent;
  readonly card: AgentCard;
  readonly trail: readonly string[];
  readonly statusDetail: readonly string[];
  readonly specimen: { readonly summary: string; readonly rows: readonly AgentSpecimenRow[] };
  readonly checks: readonly AgentCheck[];
  readonly contract: { readonly facts: readonly { readonly label: string; readonly value: string }[]; readonly lists: readonly { readonly label: string; readonly items: readonly string[] }[] };
  readonly history: readonly AgentHistoryRow[];
  readonly uses: readonly AgentRef[];
  readonly usedBy: readonly AgentRef[];
}

type Stored = Awaited<ReturnType<typeof readStudioCells>>[number];
type Fields = Record<string, unknown>;
interface TreeNode { id: string; name: string; children?: TreeNode[]; cells?: string[] }
interface AgentTree { active: Record<string, number | null>; tree?: TreeNode[]; meta?: { publications?: { id: string }[] } }
interface Store { parseLinkRef(text: string): { agent?: string; cell: string; version: number } | undefined }

/** One group placement: the layer (L0) and up to two groups below it. */
interface Placement { layer: { id: string; label: string }; groups: { id: string; label: string }[] }
interface Built {
  cards: AgentCard;
  leaf: Omit<AgentLeaf, "agent" | "card" | "trail" | "statusDetail" | "history" | "usedBy" | "checks"> & { checks: AgentCheck[] };
  /** Downstream readers the record itself declares (the Director's `feeds`). */
  feeds?: AgentRef[];
}
interface Adapter {
  /** The agent's IA: leaf id -> placement; undefined when the agent has no IA data. */
  placements(tree: AgentTree): Promise<Map<string, Placement> | undefined>;
  build(cell: Stored, context: Context): Promise<Built>;
}
interface Context { root: string; tree: AgentTree; store: Store; designerSlugs: Map<string, string> }

const humanize = (value: string) => value.replace(/[-_.]+/g, " ").trim().replace(/^\w/, letter => letter.toUpperCase());
const tail = (id: string) => id.slice(id.lastIndexOf(".") + 1);
const text = (value: unknown) => typeof value === "string" ? value : "";
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const label = (node: TreeNode) => node.name && node.name !== node.id ? node.name : humanize(node.id.slice(node.id.lastIndexOf(".") + 1) || node.id);
const noReport = () => {};

/** The generic tree.json IA: a top node is the layer, its children the groups; deeper nodes fold into L2. */
function treePlacements(tree: AgentTree): Map<string, Placement> | undefined {
  if (!tree.tree?.length) return undefined;
  const paths = new Map<string, Placement>();
  const walk = (layer: Placement["layer"], nodes: readonly TreeNode[], groups: Placement["groups"]) => {
    for (const node of nodes) {
      const next = [...groups, { id: node.id, label: label(node) }].slice(0, 2);
      for (const cell of node.cells ?? []) if (!paths.has(cell)) paths.set(cell, { layer, groups: next });
      walk(layer, node.children ?? [], next);
    }
  };
  for (const top of tree.tree) {
    const layer = { id: top.id, label: label(top) };
    for (const cell of top.cells ?? []) if (!paths.has(cell)) paths.set(cell, { layer, groups: [] });
    walk(layer, top.children ?? [], []);
  }
  return paths;
}

/** Links (`agent:cell@v`) the cell's frontmatter declares. */
function links(fields: Fields, store: Store, self: LibraryAgent) {
  return strings(fields.links).flatMap(value => {
    const ref = store.parseLinkRef(value);
    return ref ? [{ agent: (ref.agent ?? self) as AgentKind, cell: ref.cell, version: ref.version, text: value }] : [];
  });
}

const refTo = (agent: AgentKind, id: string, labelText: string, designerSlugs: Map<string, string>): AgentRef => agent === "designer"
  ? { label: labelText, agent, ...(designerSlugs.has(id) ? { slug: designerSlugs.get(id)! } : {}) }
  : (isLibraryAgent(agent) ? { label: labelText, agent, slug: id } : { label: labelText });

const writer: Adapter = {
  async placements(tree) { return treePlacements(tree); },
  async build(cell, context) {
    const parse = await agentModule("writer", "cells/parse.js");
    const checks: AgentCheck[] = [];
    let parsed: { locales: string[]; surface?: string; records: { locale: string; record: Fields; bindings: Fields[] }[] } | undefined;
    try { parsed = parse.parseWriterCell(cell.source, cell.path); checks.push({ label: "Writer cell format", ok: true }); }
    catch (error) { checks.push({ label: "Writer cell format", ok: false, detail: error instanceof Error ? error.message.split("\n")[0]! : "Invalid Writer cell" }); }
    const records = parsed?.records ?? [];
    const locale = parsed?.locales[0] ?? "en";
    const local = records.filter(row => row.locale === locale);
    const textRows = local.filter(row => typeof row.record.text === "string");
    const structural = local.length - textRows.length;
    const prefix = `${cell.id}.`;
    const rows: AgentSpecimenRow[] = textRows.map(row => {
      const context = text(row.record.context);
      return { label: context.startsWith(prefix) ? context.slice(prefix.length) : context, text: text(row.record.text) };
    });
    const empty = textRows.filter(row => !text(row.record.text).trim()).length;
    checks.push({ label: "Every string has text", ok: empty === 0, ...(empty ? { detail: `${empty} empty ${empty === 1 ? "string" : "strings"}` } : {}) });
    const targets = [...new Set(local.flatMap(row => row.bindings.map(binding => text(binding.target)).filter(Boolean)))].sort();
    const kinds = [...new Set(local.map(row => text(row.record.leaf)).filter(Boolean))].sort();
    const frames = [...new Set(local.map(row => text((row.record.frame as Fields | undefined)?.frameId)).filter(Boolean))];
    return {
      cards: { id: cell.id, slug: cell.id, name: humanize(tail(cell.id)), version: cell.version, status: cell.status, excerpt: rows.slice(0, 2).map(row => row.text) },
      leaf: {
        specimen: { summary: `${textRows.length} ${textRows.length === 1 ? "string" : "strings"}${structural ? ` and ${structural} structural ${structural === 1 ? "record" : "records"}` : ""} in ${locale}.`, rows },
        checks,
        contract: {
          facts: [
            { label: "Locales", value: (parsed?.locales ?? []).join(", ") || "None" },
            ...(parsed?.surface ? [{ label: "Surface", value: parsed.surface }] : []),
            { label: "Records", value: String(local.length) },
          ],
          lists: [{ label: "Record leaves", items: kinds }, { label: "Bound targets", items: targets }],
        },
        uses: [...links(cell.document.fields, context.store, "writer").map(link => refTo(link.agent, link.cell, link.text, context.designerSlugs)),
          ...[...targets, ...frames].filter((value, index, all) => all.indexOf(value) === index).map(slot => refTo("designer", slot, `designer:${slot}`, context.designerSlugs))],
      },
    };
  },
};

const director: Adapter = {
  async placements() {
    const api = await agentModule("director", "index.js");
    const catalog = api.loadCatalog() as { ia: { nodes: { id: string; name: string; children: { id: string; name: string; leaves: string[] }[] }[] } };
    const paths = new Map<string, Placement>();
    for (const node of catalog.ia.nodes) for (const child of node.children) for (const leaf of child.leaves) {
      paths.set(leaf, { layer: { id: node.id, label: node.name }, groups: [{ id: child.id, label: child.name }] });
    }
    return paths;
  },
  async build(cell, context) {
    const api = await agentModule("director", "index.js");
    const parsed = api.parseCell(cell.source, cell.path) as { ok: true; value: { direction: { key?: string; text: string }[]; because: { key?: string; text: string }[]; watch: { key?: string; text: string }[]; cites: unknown[]; feeds: string[]; functions: string[] } } | { ok: false; issues: { message: string; line: number }[] };
    const catalog = api.loadCatalog() as { cells: { id: string; names: { l3: string }; question: string; mustContain: { key: string }[] }[] };
    const entry = catalog.cells.find(row => row.id === cell.id);
    const checks: AgentCheck[] = [parsed.ok ? { label: "Director cell format", ok: true } : { label: "Director cell format", ok: false, detail: parsed.issues.map(issue => `line ${issue.line}: ${issue.message}`).join("; ") }];
    const value = parsed.ok ? parsed.value : undefined;
    const bullet = (row: { key?: string; text: string }) => row.key ? `${row.key}: ${row.text}` : row.text;
    const rows: AgentSpecimenRow[] = value ? [
      ...value.direction.map(row => ({ label: "Direction", text: bullet(row) })),
      ...value.because.map(row => ({ label: "Because", text: bullet(row) })),
      ...value.watch.map(row => ({ label: "Watch", text: bullet(row) })),
    ] : [];
    if (entry) {
      const keys = new Set(value?.direction.map(row => row.key?.toLowerCase()).filter(Boolean));
      const missing = entry.mustContain.map(row => row.key).filter(key => !keys.has(key.toLowerCase()));
      checks.push({ label: "Direction covers the catalog's required keys", ok: missing.length === 0, ...(missing.length ? { detail: `Missing ${missing.join(", ")}` } : {}) });
    } else checks.push({ label: "Cell is in the strategy catalog", ok: false });
    const cites = strings(cell.document.fields.cites);
    const feeds = value?.feeds ?? strings(cell.document.fields.feeds);
    const feedRefs = feeds.map(feed => {
      const match = /^([a-z][a-z0-9-]*):(.+)$/.exec(feed);
      return match ? refTo(match[1] as AgentKind, match[2]!, feed, context.designerSlugs) : { label: feed };
    });
    return {
      cards: { id: cell.id, slug: cell.id, name: entry?.names.l3 ?? humanize(tail(cell.id)), version: cell.version, status: cell.status, excerpt: value?.direction.slice(0, 1).map(bullet) ?? [] },
      leaf: {
        specimen: { summary: entry?.question ?? "Direction, the reasons behind it and what to watch.", rows },
        checks,
        contract: {
          facts: [{ label: "Question", value: entry?.question ?? "Not in the catalog" }, { label: "Functions", value: (value?.functions ?? []).join(", ") || "None" }],
          lists: [{ label: "Must contain", items: entry?.mustContain.map(row => row.key) ?? [] }, { label: "Cites", items: cites }, { label: "Feeds", items: feeds }],
        },
        uses: [...links(cell.document.fields, context.store, "director").map(link => refTo(link.agent, link.cell, link.text, context.designerSlugs)), ...cites.map(cite => ({ label: cite }))],
      },
      feeds: feedRefs,
    };
  },
};

/** Copy bullets in a page cell's `## Copy` section (`- key: writer:cell`). */
function boundKeys(cell: Stored): number {
  const body = (cell.document as unknown as { body: { text: string }[] }).body;
  let inCopy = false, count = 0;
  for (const row of body) {
    if (row.text.startsWith("## ")) { inCopy = row.text === "## Copy"; continue; }
    if (inCopy && /^- [^:]+: writer:/.test(row.text)) count++;
  }
  return count;
}

const publisher: Adapter = {
  async placements(tree) { return treePlacements(tree); },
  async build(cell, context) {
    const fields = cell.document.fields;
    const sections = strings(fields.sections);
    const frame = text(fields.frame);
    const keys = boundKeys(cell);
    const checks: AgentCheck[] = [];
    const missing = [...(frame ? [frame] : []), ...sections].filter(slot => !context.designerSlugs.has(slot));
    checks.push({ label: "Frame and sections are Designer library leaves", ok: missing.length === 0, ...(missing.length ? { detail: `Not in the library: ${missing.join(", ")}` } : {}) });
    checks.push({ label: "Copy keys are bound", ok: keys > 0, detail: `${keys} bound ${keys === 1 ? "key" : "keys"}` });
    const publications = context.tree.meta?.publications ?? [];
    if (context.tree.active[cell.id] === cell.version && publications.length) {
      const api = await agentModule("publisher", "content-map/cells.js");
      const root = agentRoot(context.root, "publisher");
      for (const publication of publications) {
        try {
          const map = await api.contentMapFromCells(root, publication.id) as { entries: { kind: string; source?: { sectionIds?: string[] } }[] };
          checks.push({ label: `Content map ${publication.id} compiles`, ok: true, detail: `${map.entries.length} entries` });
        } catch (error) {
          checks.push({ label: `Content map ${publication.id} compiles`, ok: false, detail: error instanceof Error ? error.message : "Content map refused" });
        }
      }
    }
    const rows: AgentSpecimenRow[] = sections.map((slot, index) => ({ label: `${index + 1}`, text: slot, ref: refTo("designer", slot, slot, context.designerSlugs) }));
    const path = text(fields.path) || (text(fields.slug) ? `/${text(fields.slug)}` : "");
    return {
      cards: {
        id: cell.id, slug: cell.id, name: humanize(tail(cell.id)), version: cell.version, status: cell.status,
        excerpt: [`${path || "No path"} · ${sections.length} ${sections.length === 1 ? "section" : "sections"}`, `${keys} bound copy ${keys === 1 ? "key" : "keys"}`],
      },
      leaf: {
        specimen: { summary: `${frame ? `Frame ${frame}, ` : ""}${sections.length} ${sections.length === 1 ? "section" : "sections"}, ${keys} bound copy ${keys === 1 ? "key" : "keys"}.`, rows },
        checks,
        contract: {
          facts: [
            { label: "Kind", value: text(fields.kind) || "page" }, { label: "Path", value: path || "None" },
            { label: "Frame", value: frame || "None" }, { label: "Title key", value: text(fields.title) || "None" },
            { label: "Bound copy keys", value: String(keys) },
          ],
          lists: [{ label: "Sections", items: sections }],
        },
        uses: [...links(fields, context.store, "publisher").map(link => refTo(link.agent, link.cell, link.text, context.designerSlugs)),
          ...(frame ? [refTo("designer", frame, frame, context.designerSlugs)] : []), ...sections.map(slot => refTo("designer", slot, slot, context.designerSlugs))],
      },
    };
  },
};

const ADAPTERS: Record<LibraryAgent, Adapter> = { director, writer, publisher };

async function readTree(root: string, agent: AgentKind): Promise<AgentTree> {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(join(agentRoot(root, agent), "tree.json"), "utf8")) as AgentTree;
}

/** Designer slot -> its `/designer/<slug>` leaf, when the workspace has a Designer library. */
function designerSlugs(root: string): Map<string, string> {
  try { return new Map(designerGallery(join(root, "clossys")).sections.flatMap(section => section.cards.map(card => [card.slot, card.slug] as const))); }
  catch { return new Map(); }
}

interface Loaded { tree: AgentTree; versions: Map<string, Stored[]>; shown: Stored[]; context: Context }

async function load(root: string, agent: LibraryAgent): Promise<Loaded | undefined> {
  if (!await hasCellTree(agentRoot(root, agent))) return undefined;
  const all = await readStudioCells(root, agent, noReport);
  const tree = await readTree(root, agent);
  const versions = new Map<string, Stored[]>();
  for (const cell of all) versions.set(cell.id, [...(versions.get(cell.id) ?? []), cell]);
  // The card shows the active version, or the newest draft when nothing is active yet.
  const shown = [...versions.entries()].map(([id, list]) => list.find(cell => cell.version === tree.active[id]) ?? list.at(-1)!);
  const store = await agentModule("director", "cell-format/index.js") as Store;
  return { tree, versions, shown, context: { root, tree, store, designerSlugs: designerSlugs(root) } };
}

const kindPlacement = (id: string): Placement => {
  const kind = id.slice(0, id.indexOf("."));
  return { layer: { id: kind, label: humanize(kind) }, groups: [] };
};

/** The gallery: L0 layers and L1-L2 groups in IA order, leaves the IA does not place last. */
export async function agentGallery(root: string, agent: LibraryAgent): Promise<AgentGallery | undefined> {
  const loaded = await load(root, agent);
  if (!loaded) return undefined;
  const adapter = ADAPTERS[agent];
  const ia = await adapter.placements(loaded.tree);
  const built = new Map<string, AgentCard>();
  for (const cell of loaded.shown) built.set(cell.id, (await adapter.build(cell, loaded.context)).cards);
  const sections: { id: string; label: string; level: 0 | 1 | 2; cards: AgentCard[] }[] = [];
  const section = (id: string, labelText: string, level: 0 | 1 | 2) => {
    let found = sections.find(entry => entry.id === id && entry.level === level);
    if (!found) { found = { id, label: labelText, level, cards: [] }; sections.push(found); }
    return found;
  };
  const order = ia ? [...ia.keys()] : [];
  const ids = [...built.keys()].sort((a, b) => {
    const ia1 = order.indexOf(a), ib = order.indexOf(b);
    return (ia1 < 0 ? Infinity : ia1) - (ib < 0 ? Infinity : ib) || a.localeCompare(b);
  });
  const unplaced: string[] = [];
  for (const id of ids) {
    const placement = ia ? ia.get(id) : kindPlacement(id);
    if (!placement) { unplaced.push(id); continue; }
    section(placement.layer.id, placement.layer.label, 0);
    if (!placement.groups.length) { section(`${placement.layer.id}-all`, placement.layer.label, 1).cards.push(built.get(id)!); continue; }
    if (placement.groups.length === 2) section(placement.groups[0]!.id, placement.groups[0]!.label, 1);
    const group = placement.groups.at(-1)!;
    section(group.id, group.label, placement.groups.length as 1 | 2).cards.push(built.get(id)!);
  }
  if (unplaced.length) {
    section("unplaced", "Not in the IA", 0);
    section("unplaced-all", "Not in the IA", 1).cards.push(...unplaced.map(id => built.get(id)!));
  }
  return { agent, grouping: ia ? "ia" : "kind", sections, count: built.size };
}

/** One leaf by slug (its cell id); undefined when the agent has no such cell. */
export async function agentLeaf(root: string, agent: LibraryAgent, slug: string): Promise<AgentLeaf | undefined> {
  const loaded = await load(root, agent);
  const cell = loaded?.shown.find(entry => entry.id === slug);
  if (!loaded || !cell) return undefined;
  const adapter = ADAPTERS[agent];
  const built = await adapter.build(cell, loaded.context);
  const ia = await adapter.placements(loaded.tree);
  const placement = ia ? ia.get(cell.id) : kindPlacement(cell.id);
  const trail = placement ? [placement.layer.label, ...placement.groups.map(group => group.label)] : ["Not in the IA"];
  const versions = loaded.versions.get(cell.id) ?? [];
  const activeVersion = loaded.tree.active[cell.id];
  const newest = versions.at(-1)!;
  const statusDetail = [
    ...(activeVersion === null || activeVersion === undefined ? ["No version is active yet."] : []),
    ...(newest.version > cell.version ? [`v${newest.version} is a newer ${newest.status} version.`] : []),
  ];
  // Common checks: the active pointer, its confirmation and each link's target.
  const checks: AgentCheck[] = [
    { label: "Active pointer names a recorded version", ok: typeof activeVersion === "number" && versions.some(entry => entry.version === activeVersion), ...(typeof activeVersion === "number" ? { detail: `v${activeVersion}` } : { detail: "No active version" }) },
    { label: "Shown version is confirmed", ok: typeof cell.document.fields.confirmed === "string" },
  ];
  const trees = new Map<AgentKind, AgentTree | undefined>();
  const treeOf = async (other: AgentKind) => {
    if (!trees.has(other)) trees.set(other, await readTree(loaded.context.root, other).catch(() => undefined));
    return trees.get(other);
  };
  for (const link of links(cell.document.fields, loaded.context.store, agent)) {
    const active = (await treeOf(link.agent))?.active[link.cell];
    checks.push({ label: `Link ${link.text} is the active version`, ok: active === link.version, ...(active !== link.version ? { detail: active ? `Active is v${active}` : "Target has no active version" } : {}) });
  }
  checks.push(...built.leaf.checks);
  // Used by: every agent's shown cells whose links point here, plus the readers this record feeds.
  // Uses gains the Director cells that declare they feed this one.
  const usedBy: AgentRef[] = [...(built.feeds ?? [])];
  const uses: AgentRef[] = [...built.leaf.uses];
  for (const other of LIBRARY_AGENTS) {
    const source = other === agent ? loaded : await load(loaded.context.root, other).catch(() => undefined);
    for (const entry of source?.shown ?? []) for (const link of links(entry.document.fields, loaded.context.store, other)) {
      if (link.agent === agent && link.cell === cell.id) usedBy.push({ label: `${other}:${entry.id}@${entry.version}`, agent: other, slug: entry.id });
    }
    if (other === "director" && agent !== "director") for (const entry of source?.shown ?? []) for (const feed of strings(entry.document.fields.feeds)) {
      if (feed === `${agent}:${cell.id}`) uses.push({ label: `director:${entry.id}@${entry.version}`, agent: "director", slug: entry.id });
    }
  }
  return {
    agent, card: built.cards, trail, statusDetail, specimen: built.leaf.specimen, checks, contract: built.leaf.contract,
    history: [...versions].reverse().map(entry => ({
      version: entry.version, status: entry.status, updated: text(entry.document.fields.updated), note: text(entry.document.fields.note), active: entry.version === activeVersion,
    })),
    uses: dedupe(uses), usedBy: dedupe(usedBy),
  };
}

function dedupe(refs: readonly AgentRef[]): AgentRef[] {
  const seen = new Set<string>();
  return refs.filter(ref => { const key = `${ref.agent ?? ""}|${ref.slug ?? ref.label}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
