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
 * The expansion also declares the redirects the tree implies: an agent group path goes to its first
 * tab, and every slot's flat legacy path (`/<agent>/<slot id>`) goes to its leaf route.
 */
import type { ContentMap, ContentMapEntry, ContentMapNode } from "@clossys/publisher/content-map";
import type { NextRouteLeafTemplate } from "@clossys/publisher/install";
import { readIa } from "../records/slots.js";
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
const pathOf = (entry: ContentMapNode) => ("path" in entry && typeof entry.path === "string" ? entry.path : `/${(entry as { slug: string }).slug}`);

/** Read and check a record's `expand` declaration; undefined when the record does not expand. */
export function expandSpec(route: Json): ExpandSpec | undefined {
  if (route.expand === undefined) return undefined;
  const spec = route.expand;
  if (!object(spec) || typeof spec.agent !== "string" || typeof spec.namespace !== "string" || !SEGMENT.test(spec.agent) || !SEGMENT.test(spec.namespace)) {
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
    namespaceTabs(consumer, spec).forEach((row, order) => {
      const tab: ExpandedTab = { ...row, id: `${record.id}.${row.slug}`, recordId: record.id, path: `${base}/${row.slug}` };
      tabs.push(tab);
      entries.push({ id: tab.id, parentId: record.id, order, title: tab.title, kind: "page", path: tab.path, ...(record.source ? { source: record.source } : {}) } as ContentMapEntry);
      outRoutes.push({ ...own, instanceId: tab.id, path: tab.path, label: tab.title, data: { ...(own.data as Json), groups: tab.groups }, leaf });
      leafTemplates.push({ pageId: tab.id, parentId: record.id, param: "slug", leaves: tab.slots.map(slot => ({ slug: slot, title: slot })) });
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
