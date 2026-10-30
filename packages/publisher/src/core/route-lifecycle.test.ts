import { describe, expect, it } from "vitest";
import { deriveRegisteredRouteLifecycle, registeredRouteLifecycleStatus } from "./route-lifecycle.js";
import type { RegisteredRouteLifecycleEvidence } from "./route-lifecycle.js";
import { recordRegisteredRouteSourceEvidence, isCurrentRegisteredRouteSourceEvidence } from "./route-source-evidence.js";
import { syntheticRoute } from "./__fixtures__/registered-route.js";
import { routeCompositionDigest, routeRegistryDigest } from "./route-registry.js";
describe("registered lifecycle cannot be authored as green data", () => {
  it("invalidates the internal source seal when a different declared home row changes path", () => {
    // Internal seal mechanics only: this does not establish actual source or runtime clearance.
    const home = syntheticRoute("example.home"), route = { ...syntheticRoute(), brand: { homeRouteId: home.routeId, label: "Example workspace" } };
    const registry = { version: 1 as const, consumer: "example", routes: [route, home] };
    const source = recordRegisteredRouteSourceEvidence(registry, route, { kind: "git", head: "1".repeat(40), tree: "2".repeat(40) }, {});
    expect(isCurrentRegisteredRouteSourceEvidence(source, registry, route)).toBe(true);
    const changedHome = { ...home, path: "/changed", composition: { ...home.composition, binding: { ...home.composition.binding, path: "/changed" } } };
    expect(isCurrentRegisteredRouteSourceEvidence(source, { ...registry, routes: [route, changedHome] }, route)).toBe(false);
    expect(isCurrentRegisteredRouteSourceEvidence(structuredClone(source), registry, route)).toBe(false);
  });
  it("refuses forged or deserialized source/runtime receipts before trusting any status", () => {
    const route = syntheticRoute(), registry = { version: 1 as const, consumer: "example", routes: [route] }, source = { registry: routeRegistryDigest(registry), routeId: route.routeId, composition: routeCompositionDigest(route), identity: { kind: "git" as const, head: "1".repeat(40), tree: "2".repeat(40) }, files: {}, planDigest: `sha256:${"3".repeat(64)}` };
    const forged = { registry: routeRegistryDigest(registry), routeId: route.routeId, composition: routeCompositionDigest(route), source, runtime: { evidence: "claimed", snapshot: "claimed", bundle: "claimed" }, status: "reviewed" };
    expect(registeredRouteLifecycleStatus(registry, route, forged as unknown as RegisteredRouteLifecycleEvidence, undefined)).toBe("planned");
    expect(deriveRegisteredRouteLifecycle({ current: undefined, registry, route, source, assembly: { identity: source.identity } as never, runtime: {} as never, fresh: { status: "measured", findings: [], limits: [] } }).status).toBe("planned");
  });
});
