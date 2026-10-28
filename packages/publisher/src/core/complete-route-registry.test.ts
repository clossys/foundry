import { expect, it } from "vitest";
import { projectRouteRegistry, registeredRouteBrandLink } from "./route-registry.js";
import { completeRoutes } from "./__fixtures__/complete-routes.js";
import { syntheticPlan, SYNTHETIC_ROUTE_REGISTRIES } from "./__fixtures__/registered-route.js";
import { PublisherPlanStore } from "../planning/change-set.js";
import { projectPlanCompleteRoutes } from "../planning/complete-routes.js";
import { emitRegisteredRouteAdapter, emitRegisteredRouteRegistryModule } from "../web/registered-route-source.js";
it("accepts all native kinds without legacy bindings, and joins the declared complete home", () => {
  const registry = completeRoutes(), plan = syntheticPlan(registry.routes);
  const result = projectRouteRegistry(registry, plan, SYNTHETIC_ROUTE_REGISTRIES);
  expect(result.findings).toEqual([]);
  expect(result.rows.map(row => row.registration.title)).toEqual(["Designer", "Writer", "Publisher"]);
  expect(result.rows.every(row => row.status === "planned" && row.frame === undefined)).toBe(true);
  expect(registeredRouteBrandLink(registry, registry.routes[1]!)).toEqual({ href: "/agents/designer", label: "Example" });
});
it.each([{ kind: "other" }, { kind: "writer", extra: true }, null])("refuses unsupported complete descriptors %j", complete => {
  const registry = completeRoutes(); Object.assign(registry.routes[1]!.composition, { complete });
  expect(projectRouteRegistry(registry, syntheticPlan(registry.routes), SYNTHETIC_ROUTE_REGISTRIES).findings).toContainEqual(expect.objectContaining({ path: "composition.complete" }));
});
it("carries completeRoute through the public plan command, registry projection and executable entry emitter", async () => {
  const source = completeRoutes(), draft = syntheticPlan(source.routes);
  const plan = { ...draft, milestones: draft.milestones.map(m => ({ ...m, packs: m.packs.map(p => ({ ...p, items: p.items.map((item, i) => {
    const route = source.routes[i]!;
    return { ...item, completeRoute: { kind: route.composition.complete.kind, title: route.title, path: route.path, brand: route.brand, entry: route.entry, loader: route.composition.loader! } };
  }) })) })) };
  const store = new PublisherPlanStore(SYNTHETIC_ROUTE_REGISTRIES);
  const aligned = await store.apply(store.propose(plan), () => true);
  const registry = projectPlanCompleteRoutes(aligned!, SYNTHETIC_ROUTE_REGISTRIES, "example");
  expect(registry).toEqual(source);
  expect(emitRegisteredRouteRegistryModule(registry)).toContain('"complete"');
  expect(emitRegisteredRouteAdapter(registry.routes[1]!)).toContain("<WriterRoutePage serverData={data.serverData} initialSession={data.initialSession}");
  expect(emitRegisteredRouteAdapter(registry.routes[0]!)).toContain("DesignerRoutePage");
  expect(emitRegisteredRouteAdapter(registry.routes[2]!)).toContain("PublisherRoutePage");
  const bad = structuredClone(plan); Object.assign(bad.milestones[0]!.packs[0]!.items[0]!.completeRoute, { kind: "other" });
  expect(() => store.propose(bad)).toThrow();
});
