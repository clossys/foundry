// Generated from Foundry Publisher cells and the Studio library selection. Run npm run generate:studio-map.
import type { ContentMap, ContentMapPageAction } from '@clossys/publisher/content-map';
import projection from './studio-map.json';

/** One page module: a header toggle that opens a pinned module section, fed from a named source. */
export interface StudioManifestModule { id: string; icon: string; label: string; section: string; input: string; source: string; shortcut?: string; defaultOpen: boolean }
/** One header action; its handler is data the module frame runs. */
export interface StudioManifestAction { id: string; icon: string; label: string; shortcut?: string; cmdk: boolean; handler: { kind: 'copy-link' } | { kind: 'copy-prompt'; prompt: string } | { kind: 'scroll'; target: string } }
/** The page manifest: navigator, modules, header actions and one wiring line per interaction. */
export interface StudioPageManifest { frame: string; navigator: 'explorer' | 'outline'; modules: readonly StudioManifestModule[]; actions: readonly StudioManifestAction[]; wiring: readonly { do: string; expect: string }[] }
/** How one assembly is laid out and fed: a data loader, and per section the data field its contract input reads. */
export interface StudioAssemblySpec { body: 'plain' | 'detail'; data: { loader: string; agent?: string }; inputs: Record<string, string>; sectionIds: readonly string[]; manifest: StudioPageManifest }
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
export const studioAgents = studioMap.entries.filter(row => row.kind === 'page' && row.parentId === 'agents').sort((a, b) => a.order - b.order).map(row => ({ id: row.id, label: row.title }));
