/** Consumer-owned publication topology, projected as finite data for existing
 * page/frame contracts. `projectRoutes` resolves registered source metadata;
 * assign `projectNavigation` to sidebar tree/activeId, `projectCommands` to
 * command.groups and `projectBreadcrumbs` to breadcrumb data. Project into the
 * selected sidebar value BEFORE computing its content hash. Omit the legacy
 * `serverData.routeNavigation` field: its compatibility projection is registry-
 * only and flat, and would overwrite the canonical map hierarchy. No projection
 * writes consumer routes or establishes runtime/adoption clearance. */
export type { ContentMap, ContentMapEntry, ContentMapSource, ContentMapAction, ContentMapConstructs, ContentMapFinding, ContentMapFindingCode, ContentMapNavigationNode, ContentMapNavigation, ContentMapCommand, ContentMapCommandGroup, ContentMapBreadcrumb, ContentMapOutlineNode, ContentMapTocEntry, ContentMapSitemapEntry, ContentMapSitemapOptions, ContentMapCompleteRoute, ContentMapRouteOptions, ContentMapRoutes } from "./contract.js";
export { CONTENT_MAP_MAX_DEPTH } from "./contract.js";
export { checkContentMap } from "./check.js";
export { projectRoutes, projectNavigation, projectCommands, projectBreadcrumbs, projectSitemap, projectOutline, projectToc } from "./projections.js";
