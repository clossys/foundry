"use client";
import { RegisteredRoutePage } from "./registered-route-pages.js";
import { plainRouteProjectionRegistry } from "../core/route-projection.js";
import type { PlainRegisteredRouteProjection } from "../core/route-projection.js";
import { prepareRegisteredRouteProjection } from "./registered-route-binding.js";
import type { RegisteredRoutePageProps, RegisteredRouteRuntime, RegisteredRouteRuntimeHook, RegisteredRouteHeaderActions } from "./registered-route-binding.js";
import type { LegacyRouteRegistration as RouteRegistration } from "../core/route-registry.js";
export { RegisteredRoutePage } from "./registered-route-pages.js";
export { RegisteredCaptureRoutePage } from "./registered-capture-route.js";
export type { RegisteredCaptureRoutePageProps } from "./registered-capture-route.js";
export { prepareRegisteredRoute, prepareRegisteredRouteFromNode, prepareRegisteredRouteProjection } from "./registered-route-binding.js";
export type { PreparedRegisteredRoute, PreparedRegisteredPage, RegisteredRoutePageProps, RegisteredRouteRuntime, RegisteredRouteRuntimeHook, RegisteredRouteHeaderActions, PlainRegisteredRouteProjection } from "./registered-route-binding.js";
export type { RegisteredRouteSerializable, RegisteredRouteServerData } from "../core/route-server-data.js";
export { materializeRegisteredRouteSourceEvidence } from "./registered-route-source-bootstrap.js";
export type { RegisteredRouteSourceBootstrap } from "../core/route-source-evidence.js";
export type { RegisteredRouteSourceMaterialization } from "./registered-route-source-bootstrap.js";

/** The emitted client page for a route with a registered server loader. `data` is the
 * loader's serializable result, received as a prop from the emitted server page; it
 * reaches the registered runtime hook. The emitted outer registered provider also
 * receives the same data before this page reads provider state. It never becomes a registry, receipt or
 * evidence by itself: source evidence still has to be minted through
 * materializeRegisteredRouteSourceEvidence. */
export function RegisteredServerDataRoutePage<Data>({ registry, routeId, data, useRuntime, renderActions }: Omit<RegisteredRoutePageProps, "useRuntime"> & { readonly data: Data; readonly useRuntime: (route: RouteRegistration, data: Data) => RegisteredRouteRuntime }) {
  const withData: RegisteredRouteRuntimeHook = route => useRuntime(route, data);
  return <RegisteredRoutePage registry={registry} routeId={routeId} useRuntime={withData} renderActions={renderActions} />;
}
export function RegisteredRouteProjectionPage({ projection, routeId, useRuntime, renderActions }: { readonly projection: PlainRegisteredRouteProjection; readonly routeId: string; readonly useRuntime: RegisteredRouteRuntimeHook; readonly renderActions?: RegisteredRouteHeaderActions }) {
  const registry = plainRouteProjectionRegistry(projection), route = registry?.routes.find(route => route.routeId === routeId);
  if (!route) throw new Error("Plain route projection identity is unavailable");
  const runtime = useRuntime(route), result = prepareRegisteredRouteProjection(projection, routeId, runtime, renderActions);
  if (result.status !== "ready") throw new Error(`Plain route projection ${result.status}: ${result.findings.join("; ")}`);
  return result.assembly.render(runtime.cell);
}

export { registeredFlowRuntimeInputs } from "./registered-route-layout.js";
export type { RegisteredFlowRuntimeInputs } from "./registered-route-layout.js";


export { RegisteredPublicationOutlet } from "./registered-publication-outlet.js";
export { registeredPublicationSnapshot } from "./registered-route-query.js";
export { createRegisteredPageSession, createRegisteredPublicationSession } from "./registered-route-query.js";
export type { RegisteredPageSession, RegisteredPageSessionOptions, RegisteredPageLoaders, RegisteredPageNavigation, RegisteredPageSearchHit, RegisteredPageItem, RegisteredPageChunk, RegisteredPageCommandGroup, RegisteredPublicationFramePorts, RegisteredPublicationFrameProps, RegisteredPublicationSnapshot, RegisteredPublicationSession, RegisteredPublicationHost, RegisteredPublicationRegions, RegisteredRegionUpdate, RegisteredFrameRouteState, RegisteredItemResult } from "./registered-route-query.js";
export type { PublicationBinding, RegionPageBinding } from "../core/instance-binding.js";
export type { RegionPageRouteRegistration, RegionPageRouteRegistry } from "../core/route-registry.js";
export { projectPageOutline } from "../content/taxonomy.js";
export type { RegisteredPageManifest, RegisteredPageOutline, PageOutlineHeading, PageOutlinePlacement, PageOutlineTarget, PageManifestNode, PageManifestL0, PageManifestL1, PageManifestL2 } from "../content/taxonomy.js";
export * from "./pages/index.js";
