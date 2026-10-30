import { rematerializeRegisteredRouteSourceEvidence } from "../core/route-source-evidence.js";
import type { RegisteredRouteSourceRematerialization } from "../core/route-source-evidence.js";
import type { LegacyRouteRegistry as RouteRegistry } from "../core/route-registry.js";
import type { RouteRuntimeMaterialization } from "../core/route-runtime.js";
import { materializeRegisteredDesignerRoute } from "./registered-route-query.js";
import type { RegisteredRouteRuntime } from "./registered-route-binding.js";

export type RegisteredRouteSourceMaterialization = RegisteredRouteSourceRematerialization;
/** The one checked client path from a serialized route source bootstrap (plain data
 * the emitted server page passed as a prop) to source evidence. It re-runs the fixed
 * Designer query for a derived body, then verifies the bootstrap's library hash,
 * materialization id and source match before minting a client evidence identity.
 * The minted evidence satisfies only the live browser route gate; the original
 * provider/query association is still required there, and Node, lifecycle and
 * bootstrap paths keep accepting Node-verified evidence only. */
export function materializeRegisteredRouteSourceEvidence(bootstrap: unknown, registry: RouteRegistry, routeId: string, runtime: Pick<RegisteredRouteRuntime, "assembly" | "instanceLibrary" | "registries" | "designerQuery">): RegisteredRouteSourceMaterialization {
  try {
    if (!registry || "kind" in registry || "authentication" in registry) return { status: "refused", findings: ["Plain projections are not authenticated registries"] };
    const routes = registry.routes.filter(route => route.routeId === routeId);
    if (routes.length !== 1) return { status: "refused", findings: ["Exactly one registered route is required"] };
    const route = routes[0]!, engine = runtime.assembly.engine;
    let materialization: RouteRuntimeMaterialization | undefined;
    if (route.composition.binding.body?.source.kind === "derived") {
      if (!runtime.designerQuery) return { status: "pending", findings: ["Fixed Designer query/current original provider inputs unavailable"] };
      const result = materializeRegisteredDesignerRoute(route.composition.binding, engine, runtime.registries, runtime.instanceLibrary, runtime.designerQuery);
      if (result.status !== "materialized") return { status: result.status, findings: result.findings };
      materialization = result.materialization;
    } else if (runtime.designerQuery) return { status: "refused", findings: ["Static route cannot accept a Designer query"] };
    return rematerializeRegisteredRouteSourceEvidence(bootstrap, registry, route, engine, materialization);
  } catch { return { status: "refused", findings: ["Invalid route source bootstrap inputs"] }; }
}
