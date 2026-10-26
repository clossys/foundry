"use client";
import { DesignerRegisteredRoutePage, StaticRegisteredRoutePage } from "./registered-route-pages.js";
import { plainRouteProjectionRegistry } from "../core/route-projection.js";
import type { PlainRegisteredRouteProjection } from "../core/route-projection.js";
import { prepareRegisteredRouteProjection } from "./registered-route-binding.js";
import type { RegisteredRoutePageProps, RegisteredRouteRuntimeHook, RegisteredRouteHeaderActions } from "./registered-route-binding.js";
export { prepareRegisteredRoute, prepareRegisteredRouteFromNode, prepareRegisteredRouteProjection } from "./registered-route-binding.js";
export type { PreparedRegisteredRoute, RegisteredRoutePageProps, RegisteredRouteRuntime, RegisteredRouteRuntimeHook, RegisteredRouteHeaderActions, PlainRegisteredRouteProjection } from "./registered-route-binding.js";

export function RegisteredRoutePage({ registry, routeId, useRuntime, renderActions }: RegisteredRoutePageProps) {
  const route = registry.routes.find(route => route.routeId === routeId);
  if (!route) throw new Error("Registered route identity is unavailable");
  if (route.composition.binding.body?.source.kind === "derived") return <DesignerRegisteredRoutePage registry={registry} routeId={routeId} useRuntime={useRuntime} renderActions={renderActions} />;
  return <StaticRegisteredRoutePage registry={registry} routeId={routeId} useRuntime={useRuntime} renderActions={renderActions} />;
}
export function RegisteredRouteProjectionPage({ projection, routeId, useRuntime, renderActions }: { readonly projection: PlainRegisteredRouteProjection; readonly routeId: string; readonly useRuntime: RegisteredRouteRuntimeHook; readonly renderActions?: RegisteredRouteHeaderActions }) {
  const registry = plainRouteProjectionRegistry(projection), route = registry?.routes.find(route => route.routeId === routeId);
  if (!route) throw new Error("Plain route projection identity is unavailable");
  const runtime = useRuntime(route), result = prepareRegisteredRouteProjection(projection, routeId, runtime, renderActions);
  if (result.status !== "ready") throw new Error(`Plain route projection ${result.status}: ${result.findings.join("; ")}`);
  return result.assembly.render(runtime.cell);
}

