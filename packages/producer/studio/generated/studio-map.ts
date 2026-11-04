// Generated from pinned Foundry Publisher and Designer candidates. Run npm run generate:studio-map.
import type { ContentMap, ContentMapPageAction } from '@clossys/publisher/content-map';
import projection from './studio-map.json';

/** One page module: a header icon whose popover places a pinned module section, fed from a named source. */
export interface StudioManifestModule { id: string; icon: string; label: string; section: string; input: string; source: string; shortcut: string }
/** One header action: a header icon whose popover copies a prompt naming the page. */
export interface StudioManifestAction { id: string; icon: string; label: string; shortcut: string; handler: { kind: 'copy-prompt'; prompt: string } }
/** The page manifest: navigator, modules, header actions and one wiring line per interaction. */
export interface StudioPageManifest { navigator: 'outline'; modules: readonly StudioManifestModule[]; actions: readonly StudioManifestAction[]; wiring: readonly { do: string; expect: string }[] }
/** How one assembly is laid out and fed: a data loader, and per section the data field its contract input reads. */
export interface StudioAssemblySpec { body: 'plain' | 'detail'; data: { loader: string; agent?: string; purpose?: string; description?: string; groups?: readonly string[] }; inputs: Record<string, string>; sectionIds: readonly string[]; manifest: StudioPageManifest }
/** A Publisher page record: frame + ordered sections + bindings; `leaf` assembles every leaf beneath the page. */
export interface StudioPageRecord extends StudioAssemblySpec { id: string; path: string; title: string; frameId: string; leaf?: StudioAssemblySpec & { param: 'slug' } }

export const studioMap = projection.map as ContentMap;
export const studioPages = projection.pages as unknown as readonly StudioPageRecord[];
export const studioHomeId: string = projection.homeId;
export const studioPublicationRoot = projection.root as { kind: string; note: string };
export const studioItems = projection.items as readonly { slot: string; element: string; version: number }[];
/** A page module action, as the Publisher content map declares it. */
export type StudioPageAction = ContentMapPageAction;
export const studioPageActions = projection.pageActions as unknown as Readonly<Record<string, readonly ContentMapPageAction[]>>;
/** The route files Publisher installed under app/ (`publish --install --next`): each page, and each gallery's leaf template. */
export interface StudioInstalledRoute { instanceId: string; path: string; label: string; entry: { file: string; export: string }; leaf?: { path: string; entry: { file: string; export: string } } }
export const studioRoutes = projection.routes as readonly StudioInstalledRoute[];
/** One leaf a tab page serves: the tab's page id, the slot slug, its label and its served path. */
export interface StudioLeaf { page: string; slug: string; title: string; path: string }
export const studioLeaves = projection.leaves as readonly StudioLeaf[];
/** The top-level groups of the content map: the agents, in map order. */
export const studioAgents = studioMap.entries.filter(row => row.kind === 'group' && !row.parentId).sort((a, b) => a.order - b.order).map(row => ({ id: row.id, label: row.title }));
