"use client";
import { useWholeStudio, useDesignerLayerBoardProjection } from "@clossys/designer/studio/state";
import { wholeStudioCatalogHash } from "@clossys/designer/studio/queries";
import { libraryHash, resolve, runtimeHash } from "@clossys/designer/catalog";
import { prepareRegisteredRoute } from "./registered-route-binding.js";
import type { PreparedRegisteredRoute, RegisteredRoutePageProps } from "./registered-route-binding.js";
import { liveDesignerQueries } from "./registered-route-provider-context.js";
export function StaticRegisteredRoutePage({ registry, routeId, useRuntime, renderActions }: RegisteredRoutePageProps) {
  const runtime = useRuntime(registry.routes.find(route => route.routeId === routeId)!);
  const result = prepareRegisteredRoute(registry, routeId, runtime, renderActions);
  if (result.status !== "ready") throw new Error(`Registered route ${result.status}: ${result.findings.join("; ")}`);
  return result.assembly.render(runtime.cell);
}

/** The fixed live branch reads the original hooks itself. A host projection or
 * matching session string cannot replace this provider association. */
export function DesignerRegisteredRoutePage({ registry, routeId, useRuntime, renderActions }: RegisteredRoutePageProps) {
  const whole = useWholeStudio(), actual = useDesignerLayerBoardProjection();
  const route = registry.routes.find(route => route.routeId === routeId)!;
  const runtime = useRuntime(route), query = runtime.designerQuery;
  if (!whole || !query || runtimeHash(query.input.projection) !== actual.projectionHash) throw new Error("Registered route pending: actual original Designer provider projection differs");
  if (!whole.input || libraryHash(whole.input.library) !== libraryHash(runtime.assembly.engine.library) || wholeStudioCatalogHash(whole.input.catalog) !== wholeStudioCatalogHash(runtime.assembly.engine.catalog) || resolve(whole.input).selectionHash !== resolve(runtime.assembly.engine).selectionHash) throw new Error("Registered route pending: current original Designer engine/selection unavailable");
  liveDesignerQueries.set(query, actual.projectionHash);
  let result: PreparedRegisteredRoute;
  try { result = prepareRegisteredRoute(registry, routeId, runtime, renderActions); }
  finally { liveDesignerQueries.delete(query); }
  if (result.status !== "ready") throw new Error(`Registered route ${result.status}: ${result.findings.join("; ")}`);
  return result.assembly.render(runtime.cell);
}

