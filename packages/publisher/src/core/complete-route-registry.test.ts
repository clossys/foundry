import { expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { projectRouteRegistry, registeredRouteBrandLink } from "./route-registry.js";
import { completeRoutes } from "./__fixtures__/complete-routes.js";
import { syntheticPlan, syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from "./__fixtures__/registered-route.js";
import { PublisherPlanStore } from "../planning/change-set.js";
import { emitCompleteRoutePage, emitRegisteredRouteAdapter, emitRegisteredRoutePage, emitRegisteredRouteRegistryModule } from "../web/registered-route-source.js";
import { projectRoutes } from "../content-map/projections.js";

it.each(["designer", "writer", "publisher"])("refuses retired %s complete registrations, including mixed registries", kind => {
  const registry = completeRoutes();
  (registry.routes as any[]).push(syntheticRoute());
  const route = registry.routes.find(row => row.composition.complete.kind === kind)!;
  const result = projectRouteRegistry(registry as any, syntheticPlan(registry.routes as any), SYNTHETIC_ROUTE_REGISTRIES);
  expect(result.findings).toContainEqual(expect.objectContaining({ routeId: route.routeId, path: "composition.complete", message: expect.stringMatching(/retired/i) }));
  expect(registeredRouteBrandLink(registry as any, route as any)).toBeUndefined();
});
it("refuses retired completeRoute through new plan commands", () => {
  const registry = completeRoutes(), route = registry.routes[0]!, plan = syntheticPlan(registry.routes as any);
  Object.assign(plan.milestones[0]!.packs[0]!.items[0]!, { completeRoute: {
    kind: route.composition.complete.kind, path: route.path, title: route.title,
    brand: route.brand, entry: route.entry, loader: route.composition.loader,
  } });
  expect(() => new PublisherPlanStore(SYNTHETIC_ROUTE_REGISTRIES).propose(plan)).toThrow(/retired/i);
});
const metadataCases = ["completeRoutes", "planItems", "registrations"].flatMap(source =>
  ["branding", "checker", "module", "adapter", "page"].map(boundary => ({ source, boundary })));
it.each(metadataCases)("keeps $source metadata immutable but refuses its $boundary executable boundary", ({ source, boundary }) => {
  const registry = completeRoutes(), route = registry.routes[0]!;
  const completeRoute = { kind: route.composition.complete.kind, path: route.path, title: route.title, brand: route.brand, entry: route.entry, loader: route.composition.loader };
  const map = { version: 1 as const, publicationId: "test", format: "web.page.responsive" as const, entries: [{ id: route.routeId, order: 0, title: route.title, path: route.path, kind: "page" as const, source: { planItemId: route.planItemId } }] };
  const options = { consumer: registry.consumer, channel: route.channel, brand: route.brand,
    ...(source === "completeRoutes" ? { completeRoutes: { [route.planItemId]: { kind: completeRoute.kind, entry: route.entry, loader: completeRoute.loader } } }
      : source === "planItems" ? { planItems: [{ id: route.planItemId, appRouteId: route.routeId, completeRoute }] }
      : { registrations: [route] }),
  };
  const before = JSON.stringify({ map, options }), projected = projectRoutes(map, options as any);
  expect(projected.routes[0]).toEqual(route);
  expect(JSON.stringify({ map, options })).toBe(before);
  if (boundary === "branding") expect(registeredRouteBrandLink(projected as any, projected.routes[0] as any)).toBeUndefined();
  else if (boundary === "checker") expect(projectRouteRegistry(projected as any, syntheticPlan([route] as any), SYNTHETIC_ROUTE_REGISTRIES).findings).toContainEqual(expect.objectContaining({ path: "composition.complete", message: expect.stringMatching(/retired/i) }));
  else expect(() => boundary === "module" ? emitRegisteredRouteRegistryModule(projected as any)
    : boundary === "adapter" ? emitRegisteredRouteAdapter(projected.routes[0] as any)
    : emitRegisteredRoutePage("src/registry.ts", projected.routes[0] as any)).toThrow(/retired/i);
});
it("removes obsolete complete page implementations and legacy public view exports", () => {
  for (const file of ["web/DesignerRoutePage.tsx", "web/writer/WriterRoutePage.tsx", "web/publisher/PublisherRoutePage.tsx", "web/complete-route-navigation.ts", "planning/complete-routes.ts"]) expect(existsSync(new URL(`../${file}`, import.meta.url)), file).toBe(false);
  for (const file of ["web/index.ts", "web/client.ts", "web/server.ts", "web/registered-route.tsx"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    expect(source).not.toMatch(/export[^;]*(?:\bPublisherPage\b|\bDesignerRoutePage\b|\bWriterRoutePage\b|\bPublisherRoutePage\b|\bwithCompleteRouteNavigation\b)/);
  }
});

it.each(["module", "adapter", "page", "kind"])("refuses retired complete %s emission", mode => {
  const registry = completeRoutes(), route = registry.routes[0]!;
  const emit = mode === "module" ? () => emitRegisteredRouteRegistryModule(registry as any)
    : mode === "adapter" ? () => emitRegisteredRouteAdapter(route as any)
    : mode === "page" ? () => emitRegisteredRoutePage("src/registry.ts", route as any)
    : () => emitCompleteRoutePage({ kind: route.composition.complete.kind, file: route.entry.file, loader: route.composition.loader });
  expect(emit).toThrow(/retired/i);
});

it.each([null, { kind: "other" }, { kind: "writer", extra: true }])("refuses malformed retired complete descriptors %j without falling back to a region binding", complete => {
  const route = syntheticRoute(), registry = { version: 1 as const, consumer: "example", routes: [route] };
  Object.assign(route.composition, { complete });
  expect(projectRouteRegistry(registry, syntheticPlan([route]), SYNTHETIC_ROUTE_REGISTRIES).findings).toContainEqual(expect.objectContaining({ path: "composition.complete", message: expect.stringMatching(/retired/i) }));
  expect(registeredRouteBrandLink(registry, route)).toBeUndefined();
  expect(() => emitRegisteredRouteAdapter(route)).toThrow(/retired/i);
});
it("does not expose retired page authorities from public entrypoints", async () => {
  const [core, registered, client, web] = await Promise.all([
    import("@clossys/publisher/core"), import("@clossys/publisher/web/registered-route"),
    import("@clossys/publisher/web/client"), import("@clossys/publisher/web"),
  ]);
  for (const name of ["completeRouteKind", "isCompleteRouteKind", "projectPlanCompleteRoutes"]) expect(core).not.toHaveProperty(name);
  for (const api of [registered, client, web]) for (const name of ["DesignerRoutePage", "WriterRoutePage", "PublisherRoutePage", "PublisherPage", "withCompleteRouteNavigation"]) expect(api).not.toHaveProperty(name);
});
