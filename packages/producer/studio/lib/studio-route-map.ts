/**
 * The one Studio route map. Publisher compiles the publication into `generated/studio-map`: Home,
 * one group per system (Content, Build, Run), each system's overview page, the agent groups under
 * Content, one parameterized page record per agent top group, the group-tab pages the content map
 * expands from each record and, per tab, the leaf routes of its slots, plus the projected tabs,
 * landings and trails. Navigation, the command menu, breadcrumbs, tabs, links and the router all
 * read that projection through this module: no Studio route string is built anywhere else.
 */
import { projectBreadcrumbs, projectCommands, projectNavigation, type ContentMap, type ContentMapBreadcrumb, type ContentMapCommandGroup, type ContentMapEntry, type ContentMapNavigation } from '@clossys/publisher/content-map';
import { studioCopy } from './studio-copy';
import { studioAgents, studioHomeId, studioLandings, studioLeaves, studioMap, studioPages, studioTabs, studioTrails, type StudioAssemblySpec, type StudioLeaf, type StudioPageRecord, type StudioTab } from '../generated/studio-map';

const pageById = new Map(studioPages.map(page => [page.id, page]));
const entryById = new Map(studioMap.entries.map(entry => [entry.id, entry]));
const leafId = (leaf: StudioLeaf) => `${leaf.page}:${leaf.slug}`;

/** The compiled map plus one page entry per leaf, beside its tab (the map stays within its depth). */
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

/** The pinned page navigation highlights for an entry: the deepest pinned page on its projected trail. */
function navigationActive(map: ContentMap, id: string): string {
  const byId = new Map(map.entries.map(row => [row.id, row]));
  const trail = studioTrails[id] ?? [];
  for (const crumb of [...trail].reverse()) {
    const row = byId.get(crumb.id);
    if (row?.pin && (row.kind === 'page' || row.kind === 'section')) return row.id;
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

/** The trail of an entry: the one Publisher projected (groups, record, tab, leaf), else the map's own. */
function studioBreadcrumbs(map: ContentMap, entryId: string): readonly ContentMapBreadcrumb[] {
  return studioTrails[entryId] ?? projectBreadcrumbs(map, entryId);
}

/** An expanded record's tabs, in order, as Publisher projected them. */
export function studioRecordTabs(recordId: string): readonly StudioTab[] {
  return studioTabs.filter(tab => tab.record === recordId);
}

/** The served path an entry opens on, as Publisher projected it: a record opens on its first tab, a group on its first child's landing. */
export function studioLanding(id: string): string | undefined {
  return studioLandings[id];
}

/** The agent groups (the groups that hold an agent's records), in map order. */
export function studioGroups(): readonly { id: string; label: string; icon?: string }[] {
  return studioAgents;
}

/** An agent group's expanded records, in map order (each record once, from Publisher's projected tabs). */
export function studioAgentRecords(groupId: string): readonly string[] {
  return [...new Set(studioTabs.map(tab => tab.record))].filter(record => entryById.get(record)?.parentId === groupId);
}

/** The agent group an entry sits under (its nearest ancestor that is an agent group). */
export function studioGroupOf(id: string): { id: string; title: string } | undefined {
  const agents = new Map(studioAgents.map(agent => [agent.id, agent.label]));
  let row = entryById.get(id) ?? (studioLeaves.some(leaf => leafId(leaf) === id) ? entryById.get(id.split(':')[0]!) : undefined);
  while (row) {
    const label = agents.get(row.id);
    if (label !== undefined) return { id: row.id, title: label };
    row = row.parentId === undefined ? undefined : entryById.get(row.parentId);
  }
  return undefined;
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
