import { projectRouteRegistry } from "../../core/route-registry.js";
import { syntheticRoute, syntheticPlan, SYNTHETIC_ROUTE_REGISTRIES } from "../../core/__fixtures__/registered-route.js";
import { describe, expect, it } from "vitest";
import { PUBLISHER_MENU } from "../../planning/menu.js";
import { createDeliveryExampleDraft, createM1ExampleDraft } from "./__fixtures__/example-plan.js";
import { publisherChannelFromHref, publisherItemChannel, projectPublisherChannels } from "./publisher-channels.js";

describe("Publisher delivery channels", () => {
  it("consumes only closed Publisher channel fragments and delegates every other href", () => {
    expect(publisherChannelFromHref("#publisher-channel=admin")).toBe("admin");
    for (const href of ["/agents/designer", "#publisher-channel=commerce", "#publisher-channel=site&next=app", "https://example.test/#publisher-channel=site"]) expect(publisherChannelFromHref(href)).toBeUndefined();
  });
  it("assigns every non-asset offer to exactly one delivery channel", () => {
    for (const menu of PUBLISHER_MENU) {
      const item = { id: menu.id, menuRef: menu.id, lane: menu.lanes[0]!, answerIds: [], openNeeds: [] };
      const channel = publisherItemChannel(item);
      expect(channel, menu.id).toBe(menu.kind === "asset" ? undefined : ({
        "conversation.email": "messages", "conversation.og": "documents", "conversation.pdf": "documents", "conversation.deck": "documents", "conversation.demo": "site",
        "customer.auth": "app", "customer.sale": "site", "customer.receipt": "messages", "customer.portal": "app",
        "app.ops": "app", "proof.cases": "content", "proof.help": "content", "proof.status": "site", "proof.video": "documents",
      } as Record<string, string>)[menu.id] ?? "site");
    }
  });

  it("keeps plan ids, milestones, provenance and exact item records without mutating the plan", () => {
    const draft = createM1ExampleDraft();
    const rows = projectPublisherChannels(draft);
    expect(rows.map(row => row.id)).toEqual(["site"]);
    const original = draft.milestones[0]!.packs[0]!.items[0]!;
    expect(rows[0]!.items[0]!.item).toBe(original);
    expect(rows[0]!.items[0]).toMatchObject({ milestone: "M1", packId: "pack.standard-website", channel: "site" });
    expect(original.answerIds).toEqual(["example.first-impression"]);
    expect(draft.status).toBe("draft");
  });

  it("hides empty channels and keeps concepts as planned items, never built evidence", () => {
    expect(projectPublisherChannels(undefined)).toEqual([]);
    const channels = projectPublisherChannels(createDeliveryExampleDraft());
    expect(channels.map(channel => channel.id)).toEqual(["messages", "documents"]);
    expect(channels.flatMap(channel => channel.items)).toHaveLength(5);
    expect(channels.flatMap(channel => channel.items).every(row => row.menu.status === "concept-only")).toBe(true);
  });

  it("uses explicit host route ownership to separate Admin without rewriting existing App references", () => {
    const item = { id: "planned.operator", menuRef: "app.ops", appRouteId: "operator", lane: "Dashboard" as const, answerIds: ["answer.1"], openNeeds: [] };
    expect(publisherItemChannel(item, { operator: "admin" })).toBe("admin");
    expect(publisherItemChannel(item)).toBe("app");
    expect(item.appRouteId).toBe("operator");
  });

  it("shows commerce as a facet across channel rows, never a channel", () => {
    const draft = createM1ExampleDraft();
    const customer = ["customer.sale", "customer.portal", "customer.receipt"].map(id => {
      const menu = PUBLISHER_MENU.find(entry => entry.id === id)!;
      return { id, menuRef: id, lane: menu.lanes[0]!, answerIds: ["answer.sale"], openNeeds: [] };
    });
    const channels = projectPublisherChannels({ ...draft, milestones: [{ id: "M3", packs: [{ id: "pack.customer", items: customer }] }] });
    expect(channels.map(channel => channel.id)).toEqual(["site", "app", "messages"]);
    expect(channels.flatMap(channel => channel.items).every(row => row.facets.includes("commerce"))).toBe(true);
  });
});

// Synthetic joins are contract controls, never an actual consumer adoption.
describe("registry-owned channel projection", () => {
  it("uses registry audience and exact plan ownership instead of a legacy map or Frame", () => {
    const route = syntheticRoute(), draft = syntheticPlan([route]);
    const projection = projectRouteRegistry({ version: 1, consumer: "example", routes: [route] }, draft, SYNTHETIC_ROUTE_REGISTRIES);
    const channels = projectPublisherChannels(draft, { [route.routeId]: "app" }, projection);
    expect(projection.findings).toEqual([]);
    expect(channels.map(channel => channel.id)).toEqual(["admin"]);
    expect(channels[0]!.items[0]!.item).toBe(draft.milestones[0]!.packs[0]!.items[0]);
    expect(channels[0]!.items[0]!.route?.registration).toBe(route);
    expect(channels[0]!.items[0]!.route?.status).toBe("planned");
    expect(route.composition.binding.frame.leaf).toBe("frames.app-shell");
    const app = { ...route, channel: "app" as const };
    expect(projectPublisherChannels(draft, { [route.routeId]: "admin" }, projectRouteRegistry({ version: 1, consumer: "example", routes: [app] }, draft, SYNTHETIC_ROUTE_REGISTRIES)).map(channel => channel.id)).toEqual(["app"]);
  });
  it("does not borrow legacy audience for missing, duplicate or mismatched registry joins", () => {
    const route = syntheticRoute(), draft = syntheticPlan([route]);
    const item = draft.milestones[0]!.packs[0]!.items[0]!;
    for (const routes of [[], [route, route], [{ ...route, planItemId: "other" }], [{ ...route, channel: "unknown" }]]) {
      const projection = projectRouteRegistry({ version: 1, consumer: "example", routes: routes as never }, draft, SYNTHETIC_ROUTE_REGISTRIES);
      expect(projectPublisherChannels(draft, { [route.routeId]: "admin" }, projection)).toEqual([]);
      expect(publisherItemChannel({ ...item, frame: { leaf: "frames.admin-shell" } }, { [route.routeId]: "admin" }, projection)).toBeUndefined();
    }
  });
});

it("keeps a valid Admin join visible when an unrelated registry row is invalid", () => {
  const valid = syntheticRoute("example.valid"), invalid = { ...syntheticRoute("example.invalid"), channel: "unknown" as never };
  const plan = syntheticPlan([valid, invalid]);
  const projection = projectRouteRegistry({ version: 1, consumer: "example", routes: [valid, invalid] }, plan, SYNTHETIC_ROUTE_REGISTRIES);
  expect(projection.findings.length).toBeGreaterThan(0);
  expect(projection.rows[0]!.findings).toEqual([]);
  expect(projectPublisherChannels(plan, { [invalid.routeId]: "admin" }, projection).flatMap(channel => channel.items).map(row => row.item.id)).toEqual([valid.planItemId]);
});

import { projectPublisherChannelProcess } from "./publisher-channels.js";
import { derivePackPipeline } from "./pipeline.js";
import { deriveAppPipeline } from "./app/pipeline.js";
import { appBindingFixture } from "./app/__fixtures__/binding.js";
import { createAppExampleDraft } from "./__fixtures__/example-plan.js";
import { productionSettingsFromBinding } from "./production-settings.js";

describe("channel process projection", () => {
  it("keeps Configure ahead of evidence and retains failed checks alongside needs input", () => {
    const fixture = appBindingFixture();
    const item = { id: "site.sample", menuRef: "website.home", lane: "Landing" as const, instanceId: fixture.binding.instanceId, answerIds: [], openNeeds: [] };
    const row = { item, menu: PUBLISHER_MENU.find(entry => entry.id === "website.home")!, milestone: "M1" as const, packId: "pack.standard-website", channel: "site" as const, facets: [] };
    const derive = (configured: boolean) => derivePackPipeline([fixture.binding], fixture.library, fixture.registries, undefined, configured ? { [fixture.binding.instanceId]: productionSettingsFromBinding(fixture.binding) } : {}, { [fixture.binding.instanceId]: [{ slot: "content", question: "Which source?" }] });
    const pending = projectPublisherChannelProcess([row], { aligned: true, webItems: derive(false).items, appItems: [] });
    expect(pending.lanes[0]!.items[0]).toMatchObject({ column: "Configure", configured: false, state: "to do" });
    expect(pending.lanes[0]!.items[0]!.stages.every(stage => stage.status === "pending")).toBe(true);
    const pipeline = derive(true), projected = projectPublisherChannelProcess([row], { aligned: true, webItems: pipeline.items, appItems: [] }).lanes[0]!.items[0]!;
    expect(projected.state).toBe("needs input");
    expect(projected.stages.some(stage => stage.status === "failed")).toBe(true);
    expect(projected.findingCount).toBe(pipeline.items[0]!.findings.length);
    expect(projected.stages.flatMap(stage => stage.reasons).join(" ")).toContain("LK");
    expect(pending.stages).not.toContain("States");
  });

  it("expands the admitted App page into exact scoped route IDs without manufacturing Frame owners", () => {
    const fixture = appBindingFixture(), draft = createAppExampleDraft(fixture.inventory);
    const rows = projectPublisherChannels(draft)[0]!.items;
    const app = deriveAppPipeline({ inventory: fixture.inventory, library: fixture.library, registries: fixture.registries, pageBindings: fixture.pageBindings, subrowBindings: fixture.subrowBindings, settings: fixture.settings });
    const projection = projectPublisherChannelProcess(rows, { aligned: true, webItems: [], appItems: app.items });
    expect(projection.stages).toEqual(["Configure", "Frame", "Layout", "Fills", "Content", "Checks", "States", "Ready", "Export", "Deploy"]);
    const parent = projection.lanes.flatMap(lane => lane.items).find(item => item.app?.route.id === "sample.record")!;
    const nested = projection.lanes.flatMap(lane => lane.items).find(item => item.app?.route.id === "sample.child")!;
    expect(nested).toMatchObject({ id: `${parent.id}/route/sample.child`, parentId: parent.id, parentSubrowId: `${parent.id}/route/sample.tab`, path: "/#/samples/:sampleId?tab=overview&panel=details" });
    expect(nested.frame).toBeUndefined();
    expect(nested.layout).toBeUndefined();
    expect(nested.stages.map(stage => stage.name)).toEqual(["Fills", "Content", "Checks", "States", "Ready"]);
    expect(nested.stages.find(stage => stage.name === "States")).toMatchObject({ status: "pending", reasons: expect.arrayContaining(["State declaration has a different scope; implementation proof pending"]) });
    expect(projection.lanes.find(lane => lane.id === "Record")!.items.filter(item => !item.parentId)).toHaveLength(1);
  });

  it("keeps registry routes pending even when a legacy inventory claims the same route", () => {
    const route = syntheticRoute(), draft = syntheticPlan([route]);
    const registry = projectRouteRegistry({ version: 1, consumer: "example", routes: [route] }, draft, SYNTHETIC_ROUTE_REGISTRIES);
    const row = projectPublisherChannels(draft, {}, registry)[0]!.items[0]!;
    const fixture = appBindingFixture();
    const app = deriveAppPipeline({ inventory: fixture.inventory, library: fixture.library, registries: fixture.registries, pageBindings: fixture.pageBindings, settings: fixture.settings });
    const legacy = { ...app.items[0]!, route: { ...app.items[0]!.route, id: route.routeId }, state: "ready" as const, configured: true };
    const actual = projectPublisherChannelProcess([row], { aligned: true, webItems: [], appItems: [legacy] }).lanes[0]!.items[0]!;
    expect(actual).toMatchObject({ label: route.title, path: route.path, configured: false, state: "needs input", column: "Configure" });
    expect(actual.app).toBeUndefined();
    expect(actual.stages.every(stage => stage.status === "pending")).toBe(true);
  });
});
