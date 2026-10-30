// Generated from Foundry Publisher cells. Run npm run generate:studio-map.
import type { ContentMap, ContentMapNavigation, ContentMapCommandGroup, ContentMapBreadcrumb, ContentMapPageAction } from '@clossys/publisher/content-map';
import projection from './studio-map.json';
export type StudioPageAction = ContentMapPageAction;
export const studioMap = projection.map as ContentMap;
export const studioPageActions = projection.pageActions as Record<string, readonly StudioPageAction[]>;
export const studioRoutes = projection.routes;
export const studioNavigation = projection.navigation as Record<string, ContentMapNavigation>;
export const studioCommands = projection.commands as readonly ContentMapCommandGroup[];
export const studioBreadcrumbs = projection.breadcrumbs as Record<string, readonly ContentMapBreadcrumb[]>;
export const studioHome = (() => { const route = studioRoutes.find(row => row.instanceId === "home")!; return { id: route.instanceId, label: route.label, href: route.path }; })();
export const studioAgents = studioMap.entries.filter(row => row.kind === 'page' && row.parentId === 'agents').sort((a,b) => a.order-b.order).map(row => ({ id: row.id, label: row.title }));
export function studioRouteForPath(path: string) { return studioRoutes.find(row => row.path === path); }
export function studioRouteForSegments(segments: readonly string[]) { return studioRouteForPath('/' + segments.join('/')); }
export function studioAgentHref(agent: string) { return studioRoutes.find(row => row.instanceId === agent)?.path ?? studioHome.href; }
export function studioPublicationHref(publicationId: string, entryId?: string) { const route = studioRoutes.find(row => row.instanceId === 'apps')!; const query = new URLSearchParams({ publication: publicationId }); if (entryId) query.set('entry', entryId); return route.path + '?' + query; }
