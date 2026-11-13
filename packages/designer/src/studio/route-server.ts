export { designerRouteServerData, checkedDesignerRouteData } from "./route-data.js";
export type { DesignerRouteServerData, NativeRouteFrameData, RouteCatalogData } from "./route-data.js";
// Initial sessions read the full build catalog, so they ship here and stay out of
// the fixed studio/queries closure that registered routes measure.
export { createWholeStudioInitialSession, checkWholeStudioInitialSession, wholeStudioCatalogHash } from "./initial-session.js";
export type { WholeStudioInitialSession, WholeStudioInitialSnapshot } from "./initial-session.js";
