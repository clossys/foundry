"use client";
/** Browser entry for the six registered admin pages. Source checks and artifact
 * lifecycle review remain in their server entrypoints. */
export { RegisteredRoutePage } from "./registered-route-pages.js";
export { prepareRegisteredRoute } from "./registered-route-binding.js";
export type { PreparedRegisteredRoute, PreparedRegisteredPage, RegisteredRoutePageProps, RegisteredRouteRuntime, RegisteredRouteRuntimeHook, RegisteredRouteHeaderActions } from "./registered-route-binding.js";
export { materializeRegisteredRouteSourceEvidence } from "./registered-route-source-bootstrap.js";
export type { RegisteredRouteSourceMaterialization } from "./registered-route-source-bootstrap.js";
export type { RegisteredRouteSourceBootstrap } from "../core/route-source-evidence.js";
export type { RegisteredRouteSerializable, RegisteredRouteServerData } from "../core/route-server-data.js";
export { registeredFlowRuntimeInputs } from "./registered-route-layout.js";
export type { RegisteredFlowRuntimeInputs } from "./registered-route-layout.js";
export { createRegisteredPageSession, createRegisteredPublicationSession } from "./registered-route-query.js";
export type { RegisteredPageSession, RegisteredPageSessionOptions, RegisteredPageLoaders, RegisteredPageNavigation, RegisteredPageSearchHit, RegisteredPageItem, RegisteredPageChunk, RegisteredPageCommandGroup, RegisteredPublicationFramePorts, RegisteredPublicationSession, RegisteredPublicationHost, RegisteredPublicationRegions, RegisteredRegionUpdate, RegisteredFrameRouteState, RegisteredItemResult } from "./registered-route-query.js";
export type { PublicationBinding, RegionPageBinding, ContentRef } from "../core/instance-binding.js";
export type { RegionPageRouteRegistration, RegionPageRouteRegistry } from "../core/route-registry.js";
export { projectPageOutline } from "../content/taxonomy.js";
export type { RegisteredPageManifest, RegisteredPageOutline, PageOutlineHeading, PageOutlinePlacement, PageOutlineTarget, PageManifestNode, PageManifestL0, PageManifestL1, PageManifestL2 } from "../content/taxonomy.js";
export * from "./pages/index.js";
