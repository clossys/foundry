import { expect, it } from "vitest";
import { PublisherPlanStore } from "../../../planning/change-set.js";
import { PUBLISHER_MENU_VERSION } from "../../../planning/menu.js";
import { projectPlanAppInventory } from "./plan.js";
import { appBindingFixture } from "./__fixtures__/binding.js";

it("enrolls a page and its subrows only after the App plan is aligned", async () => {
  const f = appBindingFixture(), store = new PublisherPlanStore(f.registries);
  const draft = { schemaVersion: 1 as const, menuVersion: PUBLISHER_MENU_VERSION, id: "sample.plan", version: 1, status: "draft" as const, currentMilestone: "M1" as const, answerIds: ["sample.answer"], milestones: [{ id: "M1" as const, packs: [{ id: "pack.app" as const, items: [{ id: "sample.item", menuRef: "app.ops", lane: "Record" as const, answerIds: ["sample.answer"], openNeeds: [], appRouteId: "sample.record" }] }] }] };
  expect(projectPlanAppInventory(undefined, f.inventory)?.routes).toHaveLength(0);
  const aligned = await store.apply(store.propose(draft), () => true);
  const inventory = projectPlanAppInventory(aligned, f.inventory)!;
  expect(inventory.routes.map(route => route.id)).toEqual(["sample.record", "sample.tab", "sample.child"]);
  const subrowPlan = { ...aligned, milestones: aligned.milestones.map(milestone => ({ ...milestone, packs: milestone.packs.map(pack => ({ ...pack, items: pack.items.map(item => ({ ...item, appRouteId: "sample.tab" })) })) })) };
  expect(projectPlanAppInventory(subrowPlan, f.inventory)?.routes).toHaveLength(0);
});
