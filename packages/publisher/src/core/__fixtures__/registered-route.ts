import { STANDARD_PACK_REGISTRIES } from "../../web/publisher/__fixtures__/standard-website.js";
import type { InstanceRegistries } from "../instance-binding.js";
import type { RouteRegistration } from "../route-registry.js";
import type { PublisherPlanDraft } from "../../planning/plan.js";
export const syntheticRoute = (id = "example.tools"): RouteRegistration => ({
  routeId: id, title: "Tools", path: `/tools/${id.split(".").at(-1)}`, channel: "admin", brand: { homeRouteId: id, label: "Example workspace" }, planItemId: `app.${id}`,
  entry: { file: `app/tools/${id.split(".").at(-1)}/page.tsx`, export: "default" },
  composition: {
    source: { file: `generated/${id}.tsx`, export: "default" }, runtime: { file: "runtime.ts", export: "useRuntime" },
    binding: { instanceId: id, label: "Tools", path: `/tools/${id.split(".").at(-1)}`, surface: "app", packIds: ["pack.app"], format: "web.page.responsive", context: { consumer: "example", medium: "web" }, frame: { leaf: "frames.app-shell" }, layout: { leaf: "layouts.stack", config: "stack.focus" }, body: { kind: "flow", source: { kind: "static" }, sections: [{slot:"body",index:0}] }, fills: { body: [{ section: "sections.content", content: { body: { kind: "region", ref: "tools.data" } } }] } },
    header: { id: `header.${id}`, data: { title: "Tools" } },
  },
});
export const syntheticPlan = (routes: readonly RouteRegistration[]): PublisherPlanDraft => ({ schemaVersion: 1, menuVersion: 2, id: "example", version: 1, status: "draft", currentMilestone: "M3", answerIds: ["answer.tools"], milestones: [{ id: "M3", packs: [{ id: "pack.app", items: routes.map(r => ({ id: r.planItemId, menuRef: "app.ops", lane: "Studio", appRouteId: r.routeId, answerIds: ["answer.tools"], openNeeds: [] })) }] }] });

/** SYNTHETIC support declarations exercise validation only; no consumer render clearance. */
export const SYNTHETIC_ROUTE_REGISTRIES: InstanceRegistries = { ...STANDARD_PACK_REGISTRIES,
  frames: STANDARD_PACK_REGISTRIES.frames.map(frame => ({ ...frame, contract: { ...frame.contract, stage: { accepts: ["flow", "canvas"], scroll: "region" } } })),
  sections: STANDARD_PACK_REGISTRIES.sections.map(section => ({ ...section, contract: { ...section.contract, substrates: ["flow"], substrateTests: [{ substrate: "flow", file: "SYNTHETIC.tsx", name: "SYNTHETIC declaration only" }] } })),
};
