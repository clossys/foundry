// Generated from Foundry Publisher cells and the Studio library selection. Run npm run generate:studio-map.
import type { ContentMap, ContentMapPageAction } from '@clossys/publisher/content-map';
import projection from './studio-map.json';

/** How one assembly is laid out and fed: a data loader, and per section the data field its contract input reads. */
export interface StudioAssemblySpec { body: 'plain' | 'detail'; data: { loader: string; agent?: string }; inputs: Record<string, string>; sectionIds: readonly string[] }
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
