import { describe, expect, it } from "vitest";
import { DESIGNER_ADMIN_ROUTE, prepareDesignerRouteRegistration } from "./designer-route-registration.js";
import { syntheticPlan, syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from "../core/__fixtures__/registered-route.js";
import type { DesignerRouteRegistrationInput } from "./designer-route-registration.js";

/** Synthetic ownership only. These tests never manufacture a captured provider,
 * successful host apply, executable consumer fill or accepted runtime receipt. */
function input(): DesignerRouteRegistrationInput {
  const route = syntheticRoute("example.designer");
  const plan = syntheticPlan([route]);
  return { consumer: "example", routeId: route.routeId, plan, registries: SYNTHETIC_ROUTE_REGISTRIES, brand: { homeRouteId: route.routeId, label: "Example" } };
}
describe("Publisher-owned Designer registration preparation", () => {
  it("owns the real route path and Canvas/lanes versioned query without invented parameters or a flow Layout", () => {
    expect(DESIGNER_ADMIN_ROUTE.path).toBe("/agents/designer");
    expect(DESIGNER_ADMIN_ROUTE.channel).toBe("admin");
    expect(DESIGNER_ADMIN_ROUTE.frame).toEqual({ leaf: "frames.app-shell", members: { layout: "standard", stage: "full", theme: "system" } });
    expect(DESIGNER_ADMIN_ROUTE.body).toEqual({ kind: "canvas", source: { kind: "derived", query: { id: "designer.layer-boards", version: 1 } }, arrangement: "lanes" });
    expect(DESIGNER_ADMIN_ROUTE.body).not.toHaveProperty("boards");
    expect(DESIGNER_ADMIN_ROUTE.body).not.toHaveProperty("gap");
    expect(DESIGNER_ADMIN_ROUTE.runtime.export).toBe("useDesignerRegisteredRouteRuntime");
  });
  it("keeps the exact existing item, route, pack, milestone and answer identities in a real proposal", () => {
    const source = input(), before = structuredClone(source.plan);
    const result = prepareDesignerRouteRegistration(source);
    const owner = before.milestones[0]!.packs[0]!.items[0]!;
    expect(result.route).toMatchObject({ routeId: owner.appRouteId, planItemId: owner.id, path: "/agents/designer", status: "planned", owner: { packId: "pack.app", milestone: "M3", answerIds: owner.answerIds } });
    expect(result.proposal.proposedPlan).toEqual(result.plan);
    expect(result.proposal.changes).toEqual([{ op: "align-plan", planId: source.plan.id, version: 1, digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) }]);
    expect(source.plan).toEqual(before);
    expect(result.plan.status).toBe("draft");
    expect(result.plan).not.toHaveProperty("digest");
  });
  it("cannot turn absent original capture/runtime/acceptance into a strict registry, emitted page, Node input or receipt", () => {
    const result = prepareDesignerRouteRegistration(input());
    expect(result.status).toBe("planned");
    expect(result.registry).toBeUndefined();
    expect(result.nodeInput).toBeUndefined();
    expect(result.outputs).toEqual([]);
    expect(result).not.toHaveProperty("receipt");
    expect(result).not.toHaveProperty("projection");
    expect(result.needs.map(need => need.field)).toEqual(expect.arrayContaining(["plan.acceptance", "plan.configuration", "composition.binding", "composition.header", "composition.source", "composition.runtime", "styling.designer", "node"]));
    expect(result.needs.find(need => need.field === "styling.designer")!.reason).toContain("WholeStudioProvider");
  });
  it("preserves unresolved needs rather than interpreting an existing route as acceptance", () => {
    const source = input();
    const plan = { ...source.plan, milestones: source.plan.milestones.map(m => ({ ...m, packs: m.packs.map(p => ({ ...p, items: p.items.map(item => ({ ...item, openNeeds: [{ slot: "original.provider", question: "Capture the actual selected session" }] })) })) })) };
    const result = prepareDesignerRouteRegistration({ ...source, plan });
    expect(result.plan.milestones[0]!.packs[0]!.items[0]!.openNeeds).toEqual(plan.milestones[0]!.packs[0]!.items[0]!.openNeeds);
    expect(result.needs).toContainEqual({ field: "original.provider", reason: "Capture the actual selected session" });
    expect(result.route.status).toBe("planned");
  });
  it("refuses an unknown route rather than creating a plan item to make its join pass", () => {
    expect(() => prepareDesignerRouteRegistration({ ...input(), routeId: "foreign" })).toThrow("exactly one existing App Studio plan item");
  });
  it("refuses duplicate owner identities and a flow/static binding instead of coercing them into Designer Canvas", () => {
    const source = input();
    const plan = { ...source.plan, milestones: source.plan.milestones.map(m => ({ ...m, packs: m.packs.map(p => ({ ...p, items: [...p.items, { ...p.items[0]!, id: "another.item" }] })) })) };
    expect(() => prepareDesignerRouteRegistration({ ...source, plan })).toThrow("exactly one existing App Studio plan item");
    expect(() => prepareDesignerRouteRegistration({ ...source, binding: syntheticRoute().composition.binding })).toThrow("original Canvas/lanes/domain");
  });
  it("accepts only the admin standard/full/system frame selection on a Designer binding, or none", () => {
    const { layout: _layout, ...canonical } = syntheticRoute("example.designer").composition.binding as { layout?: unknown };
    const body = { kind: "canvas", source: { kind: "derived", query: { id: "designer.layer-boards", version: 1 } }, boards: [], arrangement: { kind: "lanes", groupKey: "domain" } };
    const designer = (members?: Record<string, string>) => ({ ...canonical, body, frame: { leaf: "frames.app-shell", ...(members ? { members } : {}) } }) as unknown as NonNullable<DesignerRouteRegistrationInput["binding"]>;
    expect(prepareDesignerRouteRegistration({ ...input(), binding: designer() }).route.frame.members).toEqual({ layout: "standard", stage: "full", theme: "system" });
    expect(() => prepareDesignerRouteRegistration({ ...input(), binding: designer({ theme: "system", stage: "full", layout: "standard" }) })).not.toThrow();
    for (const members of [{ layout: "immersive", stage: "full", theme: "system" }, { layout: "standard" }, { layout: "standard", stage: "full", theme: "system", density: "compact" }])
      expect(() => prepareDesignerRouteRegistration({ ...input(), binding: designer(members) })).toThrow("admin standard/full/system");
  });
});
