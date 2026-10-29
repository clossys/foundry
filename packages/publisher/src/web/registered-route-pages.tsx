"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useWholeStudio, useDesignerLayerBoardProjection } from "@clossys/designer/studio/state";
import { wholeStudioCatalogHash } from "@clossys/designer/studio/queries";
import { libraryHash, resolve, runtimeHash } from "@clossys/designer/catalog";
import { prepareRegisteredRoute } from "./registered-route-binding.js";
import type { PreparedRegisteredPage, RegisteredRoutePageProps } from "./registered-route-binding.js";
import { liveDesignerQueries } from "./registered-route-provider-context.js";
import { isRegionPageRouteRegistration } from "../core/route-identities.js";
import { normalizeRegionPageRoute } from "../core/route-registry.js";
import type { RegionPageRouteRegistry } from "../core/route-registry.js";
import type { RegisteredRouteRuntime } from "./registered-route-binding.js";
const noSubscribe = () => () => {};
const zeroRevision = () => 0;
export function StaticRegisteredRoutePage({ registry, routeId, useRuntime, renderActions, publication: suppliedPublication }: RegisteredRoutePageProps) {
  const source = registry.routes.find(route => route.routeId === routeId)!;
  const route = source && isRegionPageRouteRegistration(source) ? normalizeRegionPageRoute(registry as RegionPageRouteRegistry, source) : source;
  const runtime: RegisteredRouteRuntime = useRuntime(route);
  let failure: unknown;
  const page = runtime?.page, publication = suppliedPublication ?? page?.options.publication;
  useSyncExternalStore(page?.subscribe ?? noSubscribe, page?.revision ?? zeroRevision, zeroRevision);
  const published = useRef<string | undefined>(undefined);
  useEffect(() => { page?.activate(); void page?.start().catch(() => {}); return () => { page?.deactivate(); }; }, [page, routeId]);
  let result: PreparedRegisteredPage | undefined, node: import("react").ReactNode, regions: ReturnType<NonNullable<PreparedRegisteredPage["renderRegions"]>> | undefined;
  try {
    if (runtime && failure === undefined) {
      result = prepareRegisteredRoute(registry, routeId, runtime, renderActions);
      if (publication && result.renderRegions) regions = result.renderRegions(runtime.cell);
      else if (result.status === "ready") node = result.assembly.render(runtime.cell);
    }
  } catch (error) { failure = error; }
  const status = failure !== undefined || result?.status === "refused" ? "error" : result?.routeState?.main ?? (result?.status === "ready" || result?.status === "stream" ? "ready" : result?.status === "pending" ? "loading" : "error");
  const navigating = failure !== undefined || result?.status === "refused" ? false : result?.routeState?.navigating ?? status === "loading";
  const identity = `${routeId}:${status}:${navigating}:${result?.regionHash ?? (result?.status === "ready" ? result.assembly.snapshot.hash : status)}`;
  useEffect(() => {
    if (!publication) return;
    publication.activate(routeId);
    if (published.current === identity) return;
    published.current = identity;
    if (regions && (status === "ready" || result?.status === "stream")) publication.setPage(regions, page);
    publication.setState({ main: status, navigating }, page);
  }, [publication, routeId, identity, status, navigating]);
  if (publication) return null;
  if (failure !== undefined) throw failure;
  if (result?.status !== "ready") throw new Error(`Registered route ${result?.status ?? "refused"}: ${result && "findings" in result ? result.findings.join("; ") : "Runtime unavailable"}`);
  return node;
}

/** The fixed live branch reads the original hooks itself. A host projection or
 * matching session string cannot replace this provider association. */
export function DesignerRegisteredRoutePage({ registry, routeId, useRuntime, renderActions }: RegisteredRoutePageProps) {
  const whole = useWholeStudio(), actual = useDesignerLayerBoardProjection();
  const route = registry.routes.find(route => route.routeId === routeId)!;
  if (isRegionPageRouteRegistration(route)) throw new Error("Region pages do not mount the retired Designer provider");
  const runtime = useRuntime(route), query = runtime.designerQuery;
  if (!whole || !query || runtimeHash(query.input.projection) !== actual.projectionHash) throw new Error("Registered route pending: actual original Designer provider projection differs");
  if (!whole.input || libraryHash(whole.input.library) !== libraryHash(runtime.assembly.engine.library) || wholeStudioCatalogHash(whole.input.catalog) !== wholeStudioCatalogHash(runtime.assembly.engine.catalog) || resolve(whole.input).selectionHash !== resolve(runtime.assembly.engine).selectionHash) throw new Error("Registered route pending: current original Designer engine/selection unavailable");
  liveDesignerQueries.set(query, actual.projectionHash);
  let result: PreparedRegisteredPage;
  try { result = prepareRegisteredRoute(registry, routeId, runtime, renderActions); }
  finally { liveDesignerQueries.delete(query); }
  if (result.status !== "ready") throw new Error(`Registered route ${result.status}: ${result.findings.join("; ")}`);
  return result.assembly.render(runtime.cell);
}

