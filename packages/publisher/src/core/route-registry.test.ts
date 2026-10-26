import { describe, expect, it } from "vitest";
import { projectRouteRegistry, registeredRoutesForChannel, routeCompositionDigest, registeredRouteBrandLink, routeRegistryDigest } from "./route-registry.js";
import type { RouteRegistry, RouteRegistration } from "./route-registry.js";
import type { PublisherPlanDraft } from "../planning/plan.js";
import { PublisherPlanStore } from "../planning/change-set.js";

import { PUBLISHER_CHANNELS } from "../planning/channel-ids.js";
import { syntheticPlan, syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from "./__fixtures__/registered-route.js";
const registry = (routes: readonly RouteRegistration[]): RouteRegistry => ({ version: 1, consumer: "example", routes });
describe("registered routes are projections over Publisher records (synthetic data)", () => {
  it("adds a throwaway Admin row by joining its exact existing plan item, Frame and Section references", () => {
    const first = syntheticRoute(), extra = syntheticRoute("example.throwaway"), third = syntheticRoute("example.more"); const plan = syntheticPlan([first, extra, third]);
    const projection = projectRouteRegistry(registry([first, extra, third]), plan, SYNTHETIC_ROUTE_REGISTRIES, {}, {});
    expect(projection.findings).toEqual([]);
    const rows = registeredRoutesForChannel(projection, "admin");
    expect(rows.map(r => r.registration.routeId)).toEqual(["example.tools", "example.throwaway", "example.more"]);
    expect(rows[1]!.item).toBe(plan.milestones[0]!.packs[0]!.items[1]);
    expect(rows[1]!.frame).toBe(extra.composition.binding.frame);
    expect(rows[1]!.sections[0]!.fill).toBe(extra.composition.binding.fills.body![0]);
    expect(rows[1]!.owner).toEqual({ packId: "pack.app", milestone: "M3", answerIds: ["answer.tools"] });
    expect(rows[1]!.status).toBe("planned"); expect(rows[1]!.pending).toContain("Exact plan alignment pending");
  });
  it.each(["route", "item", "owner", "path", "consumer", "duplicate", "status", "frame"])("refuses %s identity drift rather than inventing ownership", mutation => {
    const route = structuredClone(syntheticRoute()); const plan = structuredClone(syntheticPlan([route]));
    if (mutation === "route") Object.assign(route, { routeId: "foreign.route" });
    if (mutation === "item") Object.assign(route, { planItemId: "foreign.item" });
    if (mutation === "owner") Object.assign(route.composition.binding, { packIds: ["pack.customer"] });
    if (mutation === "path") Object.assign(route, { path: "/changed" });
    if (mutation === "consumer") Object.assign(route.composition.binding.context, { consumer: "foreign" });
    if (mutation === "status") Object.assign(route, { status: "reviewed" });
    if (mutation === "frame") Object.assign(plan.milestones[0]!.packs[0]!.items[0]!, { frame: { leaf: "frames.site-shell" } });
    expect(projectRouteRegistry(registry(mutation === "duplicate" ? [route, route] : [route]), plan, SYNTHETIC_ROUTE_REGISTRIES, {}, {}).findings.length).toBeGreaterThan(0);
  });
  it("projects the declared home identity independently of row order, rejecting missing, foreign and extra brand fields", () => {
    const home = syntheticRoute("example.home"), current = { ...syntheticRoute("example.other"), brand: { homeRouteId: home.routeId, label: "Example workspace" } };
    const rows = registry([current, home]);
    expect(registeredRouteBrandLink(rows, current)).toEqual({ href: home.path, label: "Example workspace" });
    expect(registeredRouteBrandLink(registry([home, current]), current)).toEqual(registeredRouteBrandLink(rows, current));
    const changed = registry([current, { ...home, path: "/different-home", composition: { ...home.composition, binding: { ...home.composition.binding, path: "/different-home" } } }]);
    expect(routeRegistryDigest(changed)).not.toBe(routeRegistryDigest(rows));
    expect(registeredRouteBrandLink(changed, current)?.href).toBe("/different-home");
    for (const brand of [undefined, { homeRouteId: "foreign", label: "Example workspace" }, { homeRouteId: home.routeId, label: "Example workspace", href: "/guessed" }]) {
      const invalid = { ...current, brand } as RouteRegistration;
      expect(projectRouteRegistry(registry([invalid, home]), syntheticPlan([invalid, home]), SYNTHETIC_ROUTE_REGISTRIES, {}, {}).findings.some(finding => finding.path === "brand")).toBe(true);
    }
  });
  it("alignment removes only alignment pending; it cannot fabricate runtime, generation or review", async () => {
    const route = syntheticRoute(), store = new PublisherPlanStore(SYNTHETIC_ROUTE_REGISTRIES);
    const aligned = await store.apply(store.propose(syntheticPlan([route])), () => true);
    const row = projectRouteRegistry(registry([route]), aligned, SYNTHETIC_ROUTE_REGISTRIES, {}, {}).rows[0]!;
    expect(row.pending).not.toContain("Exact plan alignment pending");
    expect(row.status).toBe("planned"); expect(row.pending).toContain("Exact artifact review evidence pending");
    const stale = { ...aligned, digest: `sha256:${"0".repeat(64)}` };
    expect(projectRouteRegistry(registry([route]), stale, SYNTHETIC_ROUTE_REGISTRIES, {}, {}).findings.some(f => f.message.includes("digest"))).toBe(true);
  });
  it("binds the entire composition and retains all six channel identities and order", () => {
    const route = syntheticRoute(); expect(routeCompositionDigest(route)).not.toBe(routeCompositionDigest({ ...route, title: "Changed" }));
    expect(PUBLISHER_CHANNELS.map(c => c.label)).toEqual(["Site", "App", "Admin", "Content", "Messages", "Documents"]);
  });
});
