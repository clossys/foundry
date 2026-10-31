/**
 * The one Studio route map. Publisher compiles the publication's pages (home, the agents group
 * and the four agent galleries) into `generated/studio-map`; each gallery page carries a leaf
 * template, and every leaf the agent's record store holds becomes one more map entry at
 * `<gallery path>/<slug>`. Navigation, the command menu, breadcrumbs and the router all read the
 * map this module returns: no Studio route string is built anywhere else.
 */
import { projectBreadcrumbs, projectCommands, projectNavigation, type ContentMap, type ContentMapBreadcrumb, type ContentMapCommandGroup, type ContentMapEntry, type ContentMapNavigation, type ContentMapNode } from '@clossys/publisher/content-map';
import { studioHomeId, studioMap, studioPages, type StudioAssemblySpec, type StudioPageRecord } from '../generated/studio-map';

/** One leaf a gallery page holds: its stable slug and its display name. */
export interface StudioLeafRow { slug: string; title: string }
/** Per gallery page id: the leaves loaded so far, or `undefined` while they load. */
export type StudioLeafIndex = Readonly<Record<string, readonly StudioLeafRow[] | undefined>>;

/** A leaf slug is one path segment the record store names; anything else never enters the map. */
const LEAF_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const leafId = (pageId: string, slug: string) => `${pageId}:${slug}`;

/** The gallery pages that assemble their leaves from a template. */
export const studioLeafPages: readonly StudioPageRecord[] = studioPages.filter(page => page.leaf);
const pageById = new Map(studioPages.map(page => [page.id, page]));

/** The compiled map plus one page entry per loaded leaf, under its gallery. */
export function studioRuntimeMap(leaves: StudioLeafIndex): ContentMap {
  const extra: ContentMapNode[] = [];
  for (const page of studioLeafPages) {
    const rows = leaves[page.id] ?? [];
    const seen = new Set<string>();
    rows.forEach((row, order) => {
      const title = row.title.trim() || row.slug;
      if (!LEAF_SLUG.test(row.slug) || seen.has(row.slug)) return;
      seen.add(row.slug);
      const entry: ContentMapEntry = {
        id: leafId(page.id, row.slug), parentId: page.id, order, title, kind: 'page',
        path: `${page.path === '/' ? '' : page.path}/${row.slug}`,
        source: { frameId: page.frameId, sectionIds: [...page.leaf!.sectionIds] },
      };
      extra.push(entry);
    });
  }
  return { ...studioMap, entries: [...studioMap.entries, ...extra] };
}

/** A resolved Studio path: the page record, the assembly it renders and, for a leaf, its slug. */
export type StudioRoute =
  | { state: 'page'; entry: ContentMapEntry; page: StudioPageRecord; spec: StudioAssemblySpec; key: string }
  | { state: 'leaf'; entry: ContentMapEntry; page: StudioPageRecord; spec: StudioAssemblySpec; slug: string; key: string }
  /** The path sits under a gallery whose leaves are still loading. */
  | { state: 'pending'; page: StudioPageRecord; key: string }
  | { state: 'missing' };

const pathOf = (segments: readonly string[]) => `/${segments.join('/')}`;

/** Resolve served segments against the map; only paths the map holds resolve. */
export function resolveStudioRoute(map: ContentMap, leaves: StudioLeafIndex, segments: readonly string[]): StudioRoute {
  const path = pathOf(segments);
  const entry = map.entries.find((row): row is ContentMapEntry => row.kind === 'page' && 'path' in row && row.path === path);
  if (entry) {
    const page = pageById.get(entry.id);
    if (page) return { state: 'page', entry, page, spec: page, key: entry.id };
    const parent = entry.parentId === undefined ? undefined : pageById.get(entry.parentId);
    if (parent?.leaf) return { state: 'leaf', entry, page: parent, spec: parent.leaf, slug: path.slice(path.lastIndexOf('/') + 1), key: entry.id };
    return { state: 'missing' };
  }
  const parentPath = pathOf(segments.slice(0, -1));
  const parent = studioLeafPages.find(page => page.path === parentPath);
  if (segments.length > 0 && parent && leaves[parent.id] === undefined) return { state: 'pending', page: parent, key: `${parent.id}:pending` };
  return { state: 'missing' };
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
    commands: projectCommands(map),
    breadcrumbs: projectBreadcrumbs(map, entryId),
  };
}

/** The served path of a map entry, for links between pages; undefined when the map has no such entry. */
export function studioHref(map: ContentMap, id: string): string | undefined {
  const row = map.entries.find(entry => entry.id === id);
  return row && row.kind !== 'group' && 'path' in row ? row.path : undefined;
}

/** The served path of a leaf, through the map. */
export const studioLeafHref = (map: ContentMap, pageId: string, slug: string) => studioHref(map, leafId(pageId, slug));

/** Every page entry the map holds, in map order: the routes a publication table lists. */
export function studioPageEntries(map: ContentMap): (ContentMapEntry & { path: string })[] {
  return map.entries.filter((row): row is ContentMapEntry & { path: string } => row.kind === 'page' && 'path' in row && typeof row.path === 'string');
}
