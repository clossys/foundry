import type { AnyRouteRegistration, LegacyRouteRegistration, RegionPageRouteRegistration, RegionPageRouteRegistry, RouteRegistry } from "./route-registry.js";
import type { InstanceBinding } from "./instance-binding.js";
import { canonicalPlanJson, sha256 } from "../planning/digest.js";

/** Finite route identities shared by server validation and browser navigation.
 * This module never imports runtime lifecycle/evidence or Node implementations. */
/** Legacy plan data can still be read; new pages use consumer configs. */
export type CompleteRouteKind = "designer" | "writer" | "publisher";
export function isCompleteRouteKind(value: unknown): value is CompleteRouteKind {
  return value === "designer" || value === "writer" || value === "publisher";
}
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const only = (v: object, keys: readonly string[]) => Object.keys(v).every(k => keys.includes(k));
export const routeSourcePath = (v: string): boolean => text(v) && !v.includes("\\") && !v.startsWith("/") && !v.split("/").some(p => !p || p === "." || p === "..");
export function isLegacyRouteRegistration(route: AnyRouteRegistration): route is LegacyRouteRegistration {
  return !!route?.composition && !("complete" in route.composition) && !isRegionPageRouteRegistration(route);
}
export function isRegionPageRouteRegistration(route: AnyRouteRegistration): route is RegionPageRouteRegistration {
  return !!route?.composition && "binding" in route.composition && !!route.composition.binding && typeof route.composition.binding === "object" && "publicationId" in route.composition.binding;
}
export function routeInstanceBinding(route: AnyRouteRegistration | undefined): InstanceBinding | undefined {
  return route && isLegacyRouteRegistration(route) ? route.composition.binding : undefined;
}
export function completeRouteKind(route: AnyRouteRegistration): CompleteRouteKind | undefined {
  const c = route?.composition;
  if (!c || !("complete" in c) || !c.complete || !only(c.complete, ["kind"]) || !isCompleteRouteKind(c.complete.kind)) return;
  return c.complete.kind;
}
/** Reordering rows never changes a declared home destination. */
export function registeredRouteBrandLink(registry: RouteRegistry<AnyRouteRegistration>, route: AnyRouteRegistration): { readonly href: string; readonly label: string } | undefined {
  const brand = route.brand;
  if (!brand || !only(brand, ["homeRouteId", "label"]) || !text(brand.homeRouteId) || !text(brand.label)) return undefined;
  const home = registry.routes.filter(row => row.routeId === brand.homeRouteId);
  if (home.length !== 1) return undefined;
  const target = home[0]!;
  if (!text(target.path) || !/^\/(?:[^/?#\\]+\/?)*$/.test(target.path) || target.path.includes("//") || target.path.includes("%") || target.path.split("/").some(part => part === "." || part === "..") || target.path !== (target.path.replace(/\/$/, "") || "/")
    || (isLegacyRouteRegistration(target) ? target.composition?.binding?.context?.consumer !== registry.consumer || target.composition.binding.path !== target.path
      : isRegionPageRouteRegistration(target) ? target.composition.binding.publicationId !== registry.publication?.id || registry.publication.context.consumer !== registry.consumer || target.composition.binding.path !== target.path : !completeRouteKind(target))) return undefined;
  return { href: target.path, label: brand.label };
}

/** Lower a region record using its publication's selected frame and layout.
 * This data operation is shared with the browser without loading lifecycle review. */
export function normalizeRegionPageRoute(registry: RegionPageRouteRegistry, route: RegionPageRouteRegistration): LegacyRouteRegistration {
  const page = route.composition.binding, publication = registry.publication;
  if (!publication || !text(publication.id) || !text(publication.mainSlot) || !only(publication, ["id", "frame", "layout", "mainSlot", "format", "surface", "context", "packIds", "inspector"]) || publication.context.consumer !== registry.consumer
    || !publication.frame || !publication.layout || page.publicationId !== publication.id || !only(page, ["instanceId", "label", "path", "publicationId", "regions"])
    || !text(page.instanceId) || !text(page.label) || page.path !== route.path || !page.regions || !only(page.regions, ["main", "page-module", "inspector"]) || !Array.isArray(page.regions.main)
    || page.regions["page-module"] !== undefined && (!Array.isArray(page.regions["page-module"]) || page.regions["page-module"].length > 1)) throw new TypeError("Region page requires its publication's selected frame and arrangement");
  const module = page.regions["page-module"]?.[0];
  // The persistent host mounts publication.inspector once; a page changes context.
  const frame = { ...publication.frame, slotFills: { ...publication.frame.slotFills, ...(module ? { "page-module": module } : {}) } };
  const binding: InstanceBinding = { instanceId: page.instanceId, label: page.label, path: page.path, format: publication.format, surface: publication.surface, context: publication.context,
    packIds: publication.packIds, frame, layout: publication.layout, fills: { [publication.mainSlot]: page.regions.main }, body: { kind: "flow", source: { kind: "static" }, sections: page.regions.main.map((_, index) => ({ slot: publication.mainSlot, index })) } };
  return { ...route, composition: { ...route.composition, binding } };
}
export function routeCompositionDigest(registration: AnyRouteRegistration): `sha256:${string}` { return `sha256:${sha256(canonicalPlanJson(registration))}`; }
export function routeRegistryDigest(registry: RouteRegistry): `sha256:${string}` { return `sha256:${sha256(canonicalPlanJson(registry))}`; }
