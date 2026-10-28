import type { LegacyRouteRegistration, RouteRegistration, RouteRegistry } from "./route-registry.js";
import type { InstanceBinding } from "./instance-binding.js";

/** Finite route identities shared by server validation and browser navigation.
 * This module never imports runtime lifecycle/evidence or Node implementations. */
export const COMPLETE_ROUTE_KINDS = ["designer", "writer", "publisher"] as const;
export type CompleteRouteKind = (typeof COMPLETE_ROUTE_KINDS)[number];
export function isCompleteRouteKind(value: unknown): value is CompleteRouteKind {
  return COMPLETE_ROUTE_KINDS.some(kind => kind === value);
}
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const only = (v: object, keys: readonly string[]) => Object.keys(v).every(k => keys.includes(k));
export const routeSourcePath = (v: string): boolean => text(v) && !v.includes("\\") && !v.startsWith("/") && !v.split("/").some(p => !p || p === "." || p === "..");
export function isLegacyRouteRegistration(route: RouteRegistration): route is LegacyRouteRegistration {
  return !!route?.composition && !("complete" in route.composition);
}
export function routeInstanceBinding(route: RouteRegistration | undefined): InstanceBinding | undefined {
  return route && isLegacyRouteRegistration(route) ? route.composition.binding : undefined;
}
export function completeRouteKind(route: RouteRegistration): CompleteRouteKind | undefined {
  const c = route?.composition;
  if (!c || !("complete" in c) || !c.complete || !only(c.complete, ["kind"]) || !isCompleteRouteKind(c.complete.kind)) return;
  return c.complete.kind;
}
/** Reordering rows never changes a declared home destination. */
export function registeredRouteBrandLink(registry: RouteRegistry, route: RouteRegistration): { readonly href: string; readonly label: string } | undefined {
  const brand = route.brand;
  if (!brand || !only(brand, ["homeRouteId", "label"]) || !text(brand.homeRouteId) || !text(brand.label)) return undefined;
  const home = registry.routes.filter(row => row.routeId === brand.homeRouteId);
  if (home.length !== 1) return undefined;
  const target = home[0]!;
  if (!text(target.path) || !/^\/(?:[^/?#\\]+\/?)*$/.test(target.path) || target.path.includes("//") || target.path.includes("%") || target.path.split("/").some(part => part === "." || part === "..") || target.path !== (target.path.replace(/\/$/, "") || "/") || (isLegacyRouteRegistration(target) ? target.composition?.binding?.context?.consumer !== registry.consumer || target.composition.binding.path !== target.path : !completeRouteKind(target))) return undefined;
  return { href: target.path, label: brand.label };
}
