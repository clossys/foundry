import type { RuntimeAssemblyIdentity } from "@clossys/designer/catalog";
import { routeCompositionDigest, routeRegistryDigest } from "./route-registry.js";
import type { RouteRegistration, RouteRegistry } from "./route-registry.js";
export interface RegisteredRouteSourceEvidence {
  readonly routeId: string;
  readonly registry: `sha256:${string}`;
  readonly composition: `sha256:${string}`;
  readonly identity: Extract<RuntimeAssemblyIdentity, { kind: "git" }>;
  readonly files: Readonly<Record<string, `sha256:${string}`>>;
  readonly planDigest?: string;
  readonly materialization?: string;
  readonly styling?: { readonly profile: string; readonly manifest: string; readonly css: Readonly<Record<string, `sha256:${string}`>> };
}
const verified = new WeakSet<object>();
/** Internal mint called only after filesystem discovery, exact emitter linkage,
 * the unchanged source scanner, and immutable Git blob comparison all pass. */
export function recordRegisteredRouteSourceEvidence(registry: RouteRegistry, route: RouteRegistration, identity: RegisteredRouteSourceEvidence["identity"], files: RegisteredRouteSourceEvidence["files"], planDigest?: string, styling?: RegisteredRouteSourceEvidence["styling"], materialization?: string): RegisteredRouteSourceEvidence {
  const evidence = Object.freeze({ registry: routeRegistryDigest(registry), routeId: route.routeId, composition: routeCompositionDigest(route), identity: Object.freeze({ ...identity }), files: Object.freeze({ ...files }), ...(planDigest ? { planDigest } : {}), ...(materialization ? { materialization } : {}), ...(styling ? { styling: Object.freeze({ ...styling, css: Object.freeze({ ...styling.css }) }) } : {}) });
  verified.add(evidence); return evidence;
}
export function isCurrentRegisteredRouteSourceEvidence(evidence: RegisteredRouteSourceEvidence, registry: RouteRegistry, route: RouteRegistration, materialization?: string): boolean {
  return evidence.materialization === materialization && verified.has(evidence) && evidence.registry === routeRegistryDigest(registry) && evidence.routeId === route.routeId && evidence.composition === routeCompositionDigest(route);
}
