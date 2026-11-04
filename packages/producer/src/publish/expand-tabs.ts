/**
 * Content-map expansion for parameterized page records.
 *
 * A Publisher page record whose Route block declares `expand: { agent, namespace }` stands for one
 * agent top group (namespace). The expansion reads that agent's `ia.json` and adds, under the
 * record, one tab page per IA group of the namespace (`<record path>/<tab slug>`) and, per tab, one
 * leaf template over the tab's slots (`<tab path>/<slot id>`). Tabs and leaves are data: the record
 * names its namespace, the IA names the groups and slots, and nothing here knows an agent by name.
 *
 * Two IA shapes hold a namespace:
 * - the namespace is an IA node (`context`, `studio`): its children are the tabs;
 * - IA nodes carry the namespace as a prefix (`themes.colors`): each such node is a tab and its
 *   children are the tab's groups.
 *
 * Tabs and their leaves sit beside the record, under the record's own parent (an agent group), so a
 * system group (Content) can hold agent groups and the tree stays within the web format's three
 * levels; each tab names its record (`recordId`, route data `record`). `projectTrails` gives every
 * served entry its trail (groups, record, tab, leaf) and `landingOf` the page an entry opens on.
 *
 * The expansion also declares the redirects the tree implies: an agent group path goes to its first
 * tab, and every slot's flat legacy path (`/<agent>/<slot id>`) goes to its leaf route.
 */
import type { ContentMap, ContentMapEntry, ContentMapNode } from "@clossys/publisher/content-map";
import type { NextRouteLeafTemplate } from "@clossys/publisher/install";
import { readIa } from "../records/slots.js";
import { slotLabel } from "../records/slot-labels.js";
import type { SlotAgent } from "../records/slot-model/index.js";

type Json = Record<string, unknown>;
export interface ExpandSpec { readonly agent: string; readonly namespace: string }
/** One generated tab page: a record's IA group, its gallery groups and the slots its leaves serve. */
export interface ExpandedTab {
  readonly id: string; readonly recordId: string; readonly slug: string; readonly title: string; readonly path: string;
  /** Gallery section ids (`<l1>/<l2>`) the tab shows, in IA order. */
  readonly groups: readonly string[];
  readonly slots: readonly string[];
}
export interface Expansion {
  readonly map: ContentMap;
  readonly routes: readonly Json[];
  readonly tabs: readonly ExpandedTab[];
  readonly leafTemplates: readonly NextRouteLeafTemplate[];
}

const object = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const SEGMENT = /^[a-z0-9][a-z0-9-]*$/;
/** An IA node id: one or more dot-joined segments (`studio`, `sections.producer`). It is only looked up, never a path. */
const IA_ID = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/;
/** A tab's map order: after every sibling record (a group holds fewer than this many records), grouped by record. */
const TAB_ORDER = 1000;
const pathOf = (entry: ContentMapNode) => ("path" in entry && typeof entry.path === "string" ? entry.path : `/${(entry as { slug: string }).slug}`);

/** Read and check a record's `expand` declaration; undefined when the record does not expand. */
export function expandSpec(route: Json): ExpandSpec | undefined {
  if (route.expand === undefined) return undefined;
  const spec = route.expand;
  if (!object(spec) || typeof spec.agent !== "string" || typeof spec.namespace !== "string" || !SEGMENT.test(spec.agent) || !IA_ID.test(spec.namespace)) {
    throw new Error(`content-map expansion: ${String(route.instanceId)} declares an invalid expand block`);
  }
  return { agent: spec.agent, namespace: spec.namespace };
}

/** The tabs a namespace holds in an agent IA, in IA order. */
export function namespaceTabs(consumer: string, spec: ExpandSpec): Omit<ExpandedTab, "id" | "recordId" | "path">[] {
  const ia = readIa(consumer, spec.agent as SlotAgent);
  if (!ia) throw new Error(`content-map expansion: ${spec.agent} has no ia.json`);
  const own = ia.nodes.find(node => node.id === spec.namespace);
  const rows = own
    ? own.children.map(child => ({ id: child.id, label: child.label, groups: [`${own.id}/${child.id}`], slots: [...child.slots] }))
    : ia.nodes.filter(node => node.id.startsWith(`${spec.namespace}.`)).map(node => ({
      id: node.id, label: node.label, groups: node.children.map(child => `${node.id}/${child.id}`), slots: node.children.flatMap(child => [...child.slots]),
    }));
  if (!rows.length) throw new Error(`content-map expansion: ${spec.agent} IA has no groups under ${spec.namespace}`);
  return rows.map(row => {
    const slug = row.id.startsWith(`${spec.namespace}.`) ? row.id.slice(spec.namespace.length + 1) : row.id;
    if (!SEGMENT.test(slug)) throw new Error(`content-map expansion: ${spec.agent} group ${row.id} is not one path segment`);
    return { slug, title: row.label, groups: row.groups, slots: row.slots };
  });
}

/**
 * Expand every parameterized record of a pinned publication. `consumer` is the consumer root
 * (`<root>/clossys`); `routes` are the route pack's compiled routes.
 */
export function expandPublication(consumer: string, map: ContentMap, routes: readonly Json[]): Expansion {
  const entries: ContentMapNode[] = [...map.entries];
  const outRoutes: Json[] = [];
  const tabs: ExpandedTab[] = [];
  const leafTemplates: NextRouteLeafTemplate[] = [];
  const redirects = [...(map.redirects ?? [])];
  const byId = new Map(map.entries.map(entry => [entry.id, entry]));
  const firstTabOfGroup = new Map<string, string>();
  for (const route of routes) {
    const spec = expandSpec(route);
    const { expand: _expand, leaf, ...own } = route;
    if (!spec) { outRoutes.push(route); continue; }
    const record = byId.get(String(route.instanceId)) as ContentMapEntry | undefined;
    if (!record || record.kind !== "page") throw new Error(`content-map expansion: ${String(route.instanceId)} is not a page of the map`);
    if (!object(leaf)) throw new Error(`content-map expansion: ${record.id} expands without a leaf template`);
    outRoutes.push(own);
    const base = pathOf(record);
    // The tabs sit beside their record (under its parent group), after every sibling record, in record order.
    const parentId = record.parentId ?? record.id;
    namespaceTabs(consumer, spec).forEach((row, index) => {
      const tab: ExpandedTab = { ...row, id: `${record.id}.${row.slug}`, recordId: record.id, path: `${base}/${row.slug}` };
      tabs.push(tab);
      entries.push({ id: tab.id, parentId, order: TAB_ORDER * (record.order + 1) + index, title: tab.title, kind: "page", path: tab.path, ...(record.source ? { source: record.source } : {}) } as ContentMapEntry);
      outRoutes.push({ ...own, instanceId: tab.id, path: tab.path, label: tab.title, data: { ...(own.data as Json), groups: tab.groups, record: record.id }, leaf });
      leafTemplates.push({ pageId: tab.id, parentId, param: "slug", leaves: tab.slots.map(slot => ({ slug: slot, title: slotLabel(consumer, spec.agent, slot) })) });
      const legacyBase = record.parentId === undefined ? undefined : byId.get(record.parentId);
      if (legacyBase?.kind === "group") {
        if (!firstTabOfGroup.has(legacyBase.id)) firstTabOfGroup.set(legacyBase.id, tab.path);
        for (const slot of tab.slots) redirects.push({ from: `${pathOf(legacyBase)}/${slot}`, to: `${tab.path}/${slot}`, permanent: false });
      }
    });
  }
  for (const [groupId, first] of firstTabOfGroup) {
    const group = byId.get(groupId)!;
    if (!redirects.some(row => row.from === pathOf(group))) redirects.push({ from: pathOf(group), to: first, permanent: false });
  }
  return { map: { ...map, entries, ...(redirects.length ? { redirects } : {}) }, routes: outRoutes, tabs, leafTemplates };
}

/** One crumb of a served entry's trail: a group, the record, the tab or the leaf, with the page it opens on. */
export interface TrailCrumb { readonly id: string; readonly label: string; readonly href?: string }
/** A leaf a tab serves, as the trail names it: `<tab id>:<slug>`. */
export interface TrailLeaf { readonly page: string; readonly slug: string; readonly title: string; readonly path: string }

/** The page an entry opens on: a record with tabs opens on its first tab, a group on its first child's landing, a page on itself. */
export function landingOf(map: ContentMap, tabs: readonly Pick<ExpandedTab, "id" | "recordId" | "path">[], id: string): string | undefined {
  const entry = map.entries.find(row => row.id === id);
  if (!entry) return undefined;
  if (entry.kind === "page") return tabs.find(tab => tab.recordId === id)?.path ?? pathOf(entry);
  if (entry.kind !== "group") return undefined;
  const tabIds = new Set(tabs.map(tab => tab.id));
  const children = map.entries.filter(row => row.parentId === id && !tabIds.has(row.id)).sort((a, b) => a.order - b.order);
  for (const child of children) { const landing = landingOf(map, tabs, child.id); if (landing) return landing; }
  return undefined;
}

/**
 * Every served entry's trail, by entry id (a leaf by `<tab id>:<slug>`): its ancestor groups, then
 * the record, the tab and the leaf it opens. A tab sits beside its record in the map, so its trail
 * names the record between the group and the tab. Each crumb links to the page it opens on.
 */
export function projectTrails(map: ContentMap, tabs: readonly Pick<ExpandedTab, "id" | "recordId" | "path">[], leaves: readonly TrailLeaf[]): Record<string, readonly TrailCrumb[]> {
  const byId = new Map(map.entries.map(row => [row.id, row]));
  const recordOf = new Map(tabs.map(tab => [tab.id, tab.recordId]));
  const crumb = (row: ContentMapNode): TrailCrumb => { const href = landingOf(map, tabs, row.id); return { id: row.id, label: row.title, ...(href ? { href } : {}) }; };
  const chain = (id: string): ContentMapNode[] => {
    const rows: ContentMapNode[] = [];
    for (let row = byId.get(id); row; row = row.parentId === undefined ? undefined : byId.get(row.parentId)) rows.unshift(row);
    const record = recordOf.get(id);
    return record === undefined ? rows : [...rows.slice(0, -1), ...chain(record).slice(rows.length - 1), rows.at(-1)!];
  };
  const trails: Record<string, readonly TrailCrumb[]> = {};
  for (const row of map.entries) if (row.kind === "page") trails[row.id] = chain(row.id).map(crumb);
  for (const leaf of leaves) trails[`${leaf.page}:${leaf.slug}`] = [...(trails[leaf.page] ?? []), { id: `${leaf.page}:${leaf.slug}`, label: leaf.title, href: leaf.path }];
  return trails;
}
