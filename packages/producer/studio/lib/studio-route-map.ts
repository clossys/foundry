/**
 * The one Studio route map. Publisher compiles the publication into `generated/studio-map`: Home,
 * one group per agent, one parameterized page record per agent top group, the group-tab pages the
 * content map expands from each record and, per tab, the leaf routes of its slots. Navigation,
 * the command menu, breadcrumbs, tabs, links and the router all read the map this module returns:
 * no Studio route string is built anywhere else.
 */
import { projectBreadcrumbs, projectCommands, projectNavigation, type ContentMap, type ContentMapBreadcrumb, type ContentMapCommandGroup, type ContentMapEntry, type ContentMapNavigation, type ContentMapNode } from '@clossys/publisher/content-map';
import { studioCopy } from './studio-copy';
import { studioHomeId, studioLeaves, studioMap, studioPages, type StudioAssemblySpec, type StudioLeaf, type StudioPageRecord } from '../generated/studio-map';

const pageById = new Map(studioPages.map(page => [page.id, page]));
const entryById = new Map(studioMap.entries.map(entry => [entry.id, entry]));
const leafId = (leaf: StudioLeaf) => `${leaf.page}:${leaf.slug}`;
const order = (a: ContentMapNode, b: ContentMapNode) => a.order - b.order;

/** The compiled map plus one page entry per leaf, under its tab's record (the map stays within its depth). */
function runtimeMap(): ContentMap {
  const extra: ContentMapEntry[] = studioLeaves.flatMap((leaf, index) => {
    const tab = pageById.get(leaf.page);
    const parent = entryById.get(leaf.page)?.parentId;
    if (!tab?.leaf || parent === undefined || !leaf.title) return [];
    return [{ id: leafId(leaf), parentId: parent, order: 1000 + index, title: leaf.title, kind: 'page', path: leaf.path, source: { frameId: tab.frameId, sectionIds: [...tab.leaf.sectionIds] } } as ContentMapEntry];
  });
  return { ...studioMap, entries: [...studioMap.entries, ...extra] };
}
export const studioRuntimeMap = runtimeMap();

/** A resolved Studio path: the page record, the assembly it renders and, for a leaf, its slug. */
export type StudioRoute =
  | { state: 'page'; entry: ContentMapEntry; page: StudioPageRecord; spec: StudioAssemblySpec; key: string }
  | { state: 'leaf'; entry: ContentMapEntry; page: StudioPageRecord; spec: StudioAssemblySpec; slug: string; key: string }
  | { state: 'missing' };

/** Resolve served segments against the map; only paths the map holds resolve. */
export function resolveStudioRoute(map: ContentMap, segments: readonly string[]): StudioRoute {
  const path = `/${segments.join('/')}`;
  const leaf = studioLeaves.find(row => row.path === path);
  const entry = map.entries.find((row): row is ContentMapEntry => row.kind === 'page' && 'path' in row && row.path === path);
  if (!entry) return { state: 'missing' };
  if (leaf) {
    const page = pageById.get(leaf.page);
    return page?.leaf ? { state: 'leaf', entry, page, spec: page.leaf, slug: leaf.slug, key: entry.id } : { state: 'missing' };
  }
  const page = pageById.get(entry.id);
  return page ? { state: 'page', entry, page, spec: page, key: entry.id } : { state: 'missing' };
}

/** The pinned page navigation highlights for an entry: itself, or its nearest pinned page ancestor. */
function navigationActive(map: ContentMap, id: string): string {
  const byId = new Map(map.entries.map(row => [row.id, row]));
  let row = byId.get(id);
  while (row) {
    if (row.pin && (row.kind === 'page' || row.kind === 'section')) return row.id;
    row = row.parentId === undefined ? undefined : byId.get(row.parentId);
  }
  return studioHomeId;
}

export interface StudioShellProjection { homeHref: string; navigation: ContentMapNavigation; commands: readonly ContentMapCommandGroup[]; breadcrumbs: readonly ContentMapBreadcrumb[] }

/** The frame inputs for one entry, all projected from the map. */
export function studioShellProjection(map: ContentMap, entryId: string): StudioShellProjection {
  const home = map.entries.find(row => row.id === studioHomeId);
  return {
    homeHref: home && 'path' in home && home.path ? home.path : '/',
    navigation: projectNavigation(map, navigationActive(map, entryId)),
    // Root pages group under the publication id; Studio shows the publication by its Writer name.
    commands: projectCommands(map).map(group => group.label === map.publicationId ? { ...group, label: studioCopy('studio.studio') } : group),
    breadcrumbs: studioBreadcrumbs(map, entryId),
  };
}

/**
 * The trail of an entry, from the map: its root group, then its pages. A leaf sits under its tab's
 * record in the map (the map stays within its depth), so its trail is its tab's trail plus itself.
 */
function studioBreadcrumbs(map: ContentMap, entryId: string): readonly ContentMapBreadcrumb[] {
  const leaf = studioLeaves.find(row => leafId(row) === entryId);
  const own = leaf ? [...projectBreadcrumbs(map, leaf.page), ...projectBreadcrumbs(map, entryId).slice(-1)] : projectBreadcrumbs(map, entryId);
  const group = studioGroupOf(leaf ? leaf.page : entryId);
  if (!group || own.some(crumb => crumb.id === group.id)) return own;
  const href = studioLanding(group.id);
  return [{ id: group.id, label: group.title, ...(href ? { href } : {}) }, ...own];
}

/** The compiled child pages of an entry, in map order: a record's tabs, an agent group's records. */
export function studioChildren(id: string): (ContentMapEntry & { path: string })[] {
  return studioMap.entries.filter((row): row is ContentMapEntry & { path: string } => row.kind === 'page' && row.parentId === id && 'path' in row && typeof row.path === 'string').sort(order);
}

/** The page an entry opens on: a page without child pages is itself; otherwise its first child's. */
export function studioLanding(id: string): string | undefined {
  const entry = entryById.get(id);
  const children = studioChildren(id);
  if (children.length) return studioLanding(children[0]!.id);
  return entry && entry.kind === 'page' && 'path' in entry ? entry.path : undefined;
}

/** The top-level groups of the map, in order. */
export function studioGroups(): ContentMapNode[] {
  return studioMap.entries.filter(row => row.kind === 'group' && !row.parentId).sort(order);
}

/** The group an entry sits under (its root ancestor). */
export function studioGroupOf(id: string): ContentMapNode | undefined {
  let row = entryById.get(id);
  while (row?.parentId) row = entryById.get(row.parentId);
  return row?.kind === 'group' ? row : undefined;
}

/** The served path of a slot's leaf, through the map: the tab of the record whose leaf template reads that agent. */
export function studioLeafHref(agent: string, slug: string): string | undefined {
  return studioLeaves.find(row => row.slug === slug && pageById.get(row.page)?.leaf?.data.agent === agent)?.path;
}

/**
 * A slot's display label, through the map: the title the content-map projection gave its leaf
 * (the Writer's name for the slot). Nav, header, cards, breadcrumbs and the command menu all read
 * this one projection.
 */
export function studioLeafTitle(agent: string, slug: string): string | undefined {
  return studioLeaves.find(row => row.slug === slug && pageById.get(row.page)?.leaf?.data.agent === agent)?.title;
}

/** Every page entry the map holds, in map order: the routes a publication table lists. */
export function studioPageEntries(map: ContentMap): (ContentMapEntry & { path: string })[] {
  return map.entries.filter((row): row is ContentMapEntry & { path: string } => row.kind === 'page' && 'path' in row && typeof row.path === 'string');
}
