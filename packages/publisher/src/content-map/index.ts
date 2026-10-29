/** Consumer-owned publication topology, projected as finite data for existing
 * page/frame contracts. `projectRoutes` resolves registered source metadata;
 * assign `projectNavigation` to sidebar tree/activeId, `projectCommands` to
 * command.groups and `projectBreadcrumbs` to breadcrumb data. Project into the
 * selected sidebar value BEFORE computing its content hash. Omit the legacy
 * `serverData.routeNavigation` field: its compatibility projection is registry-
 * only and flat, and would overwrite the canonical map hierarchy. No projection
 * writes consumer routes or establishes runtime/adoption clearance. */
export type { ContentMap, ContentMapEntry, ContentMapExternalEntry, ContentMapNode, ContentMapIndexing, ContentMapRedirectDeclaration, ContentMapRedirect, ContentMapStaticParams, ContentMapSource, ContentMapAction, ContentMapConstructs, ContentMapFinding, ContentMapFindingCode, ContentMapNavigationNode, ContentMapNavigation, ContentMapCommand, ContentMapCommandGroup, ContentMapBreadcrumb, ContentMapOutlineNode, ContentMapTocEntry, ContentMapSitemapEntry, ContentMapSitemapOptions, ContentMapCompleteRoute, ContentMapRouteOptions, ContentMapRoutes } from "./contract.js";
export { CONTENT_MAP_MAX_DEPTH } from "./contract.js";
export { checkContentMap } from "./check.js";
<<<<<<< HEAD
export { projectRoutes, projectNavigation, projectCommands, projectBreadcrumbs, projectSitemap, projectOutline, projectToc } from "./projections.js";

export type { CellCompileOptions, CellCompileFinding } from "./cells.js";
=======
export { projectRoutes, projectNavigation, projectCommands, projectBreadcrumbs, projectSitemap, projectOutline, projectToc, projectRedirects, projectStaticParams } from "./projections.js";
export { projectRobots } from "./robots.js";
export type { ContentMapRobotsOptions, ContentMapRobots } from "./robots.js";
export { buildSecurityTxt } from "./security.js";
export type { SecurityTxtOptions } from "./security.js";
>>>>>>> 5f5cb670d7f47f1e858236a2dacf001b9fc96f12
