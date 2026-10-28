import { runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeJson } from "@clossys/designer/catalog";
import type { DesignerRouteServerData } from "@clossys/designer/studio/route";
import { completeRouteKind, isLegacyRouteRegistration, registeredRouteBrandLink } from "../core/route-identities.js";
import type { RouteRegistry } from "../core/route-registry.js";

export interface CompleteRouteNavigation {
  readonly registry: RouteRegistry;
  readonly routeId: string;
}
/** Optional only for compatibility with existing complete loaders. New registry-backed
 * loaders supply this same context to Designer, Writer and Publisher server data. */
export interface CompleteRouteServerData extends DesignerRouteServerData {
  readonly routeNavigation?: CompleteRouteNavigation;
}
export function projectRegisteredRouteNavigation({ registry, routeId }: CompleteRouteNavigation) {
  if (!registry || registry.version !== 1 || !registry.consumer?.trim() || !Array.isArray(registry.routes)) throw new TypeError("Versioned route registry required for navigation");
  const current = registry.routes.filter(route => route.routeId === routeId);
  if (current.length !== 1 || current[0]!.channel !== "admin") throw new TypeError("One current admin route required for navigation");
  const routes = registry.routes.filter(route => route.channel === "admin");
  if (new Set(routes.map(route => route.routeId)).size !== routes.length || new Set(routes.map(route => route.path)).size !== routes.length
    || routes.some(route => !route.routeId?.trim() || !route.title?.trim()
      || !/^\/(?:[^/?#\\]+\/?)*$/.test(route.path) || route.path.includes("//") || route.path.includes("%")
      || route.path !== (route.path.replace(/\/$/, "") || "/") || route.path.split("/").some((part: string) => part === "." || part === "..")
      || !registeredRouteBrandLink(registry, route)
      || (!isLegacyRouteRegistration(route) && !completeRouteKind(route)))) throw new TypeError("Unique valid admin routes required for navigation");
  return { tree: routes.map(route => ({ id: route.routeId, label: route.title, href: route.path })), activeId: routeId };
}
function record(value: RuntimeJson): value is { readonly [key: string]: RuntimeJson } {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
/** Publisher supplies data to the existing Designer frame contract. Replace only
 * tree/activeId; preserve the content reference and rehash its modified value. */
export function withCompleteRouteNavigation<T extends CompleteRouteServerData>(data: T): T {
  if (!data.routeNavigation) return data;
  const { registry } = data.routeNavigation;
  if (registry.consumer !== data.snapshot.library.source.id) throw new TypeError("Route navigation belongs to a different consumer");
  const navigation = projectRegisteredRouteNavigation(data.routeNavigation);
  const reference = data.frame.content.sidebar;
  if (!reference) throw new TypeError("Selected app-shell sidebar content required");
  const rows = data.contents.filter(row => runtimeHash(row.reference) === runtimeHash(reference));
  if (rows.length !== 1 || rows[0]!.hash !== runtimeHash(rows[0]!.value) || !record(rows[0]!.value)) throw new TypeError("Exact current sidebar content required");
  const sidebar = rows[0]!;
  const value: RuntimeJson = { ...(sidebar.value as { readonly [key: string]: RuntimeJson }), ...navigation };
  return { ...data, contents: data.contents.map(row => row === sidebar ? { ...row, value, hash: runtimeHash(value) } : row) };
}
