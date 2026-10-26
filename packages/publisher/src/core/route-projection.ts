import { runtimeHash, runtimeSnapshot, runtimeSourceFindings } from "@clossys/designer/catalog";
import type { RuntimeBodyQueryBinding } from "@clossys/designer/catalog";
import type { RouteRegistration, RouteRegistry } from "./route-registry.js";
/** Display data only. This tag conveys no source, runtime or lifecycle clearance. */
export interface PlainRegisteredRouteProjection {
  readonly kind: "publisher.route-projection";
  readonly version: 1;
  readonly authentication: "unverified";
  readonly consumer: string;
  readonly routes: readonly ({
    readonly kind: "derived-route-view";
    readonly registration: RouteRegistration;
    /** Finite provenance data, never a receipt or evidence of execution. */
    readonly derivation: Omit<RuntimeBodyQueryBinding, "inputHash" | "outputHash">;
  } | { readonly kind: "static-route-view"; readonly registration: RouteRegistration })[];
}
const keys = (value: unknown, expected: readonly string[]): boolean => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
/** Parsing a plain view never mints a source/materialization/lifecycle brand. */
export function plainRouteProjectionRegistry(value: PlainRegisteredRouteProjection): RouteRegistry | undefined {
  try { return parsePlainProjection(value); } catch { return; }
}
function parsePlainProjection(value: PlainRegisteredRouteProjection): RouteRegistry | undefined {
  if (!keys(value, ["kind", "version", "authentication", "consumer", "routes"]) || value.kind !== "publisher.route-projection" || value.version !== 1 || value.authentication !== "unverified" || typeof value.consumer !== "string" || !value.consumer.trim() || !Array.isArray(value.routes)) return;
  const ids = new Set<string>(), paths = new Set<string>();
  for (const row of value.routes) {
    if (!keys(row, row.kind === "derived-route-view" ? ["kind", "registration", "derivation"] : ["kind", "registration"]) || !["derived-route-view", "static-route-view"].includes(row.kind)) return;
    const route = row.registration;
    if (!keys(route, ["routeId", "path", "title", "channel", "brand", "entry", "planItemId", "composition"]) || typeof route.routeId !== "string" || !route.routeId.trim() || typeof route.path !== "string" || ids.has(route.routeId) || paths.has(route.path)) return;
    const composition = route.composition;
    if (!keys(route.brand, ["homeRouteId", "label"]) || !keys(route.entry, ["file", "export"]) || !keys(composition, ["binding", "source", "runtime", "header"]) || !keys(composition.source, ["file", "export"]) || !keys(composition.runtime, ["file", "export"]) || !keys(composition.header, composition.header?.actions ? ["id", "data", "actions"] : ["id", "data"]) || composition.header.actions && !keys(composition.header.actions, ["file", "export"])) return;
    if (!route.composition?.binding?.body || route.composition.binding.context.consumer !== value.consumer || route.composition.binding.path !== route.path || route.composition.binding.body.source.kind !== (row.kind === "derived-route-view" ? "derived" : "static")) return;
    if (row.kind === "derived-route-view") {
      const derivation = row.derivation;
      if (!keys(derivation, ["id", "version", "renderer", "state"]) || route.composition.binding.body.source.kind !== "derived" || runtimeHash({ id: derivation.id, version: derivation.version }) !== runtimeHash(route.composition.binding.body.source.query) || derivation.id !== "designer.layer-boards" || derivation.version !== 1 || runtimeSourceFindings(derivation.renderer).length) return;
      try { runtimeSnapshot(derivation.state); } catch { return; }
    }
    ids.add(route.routeId); paths.add(route.path);
  }
  return { version: 1, consumer: value.consumer, routes: value.routes.map(row => row.registration) };
}
