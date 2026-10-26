import { describe, expect, it } from "vitest";
import { PUBLISHER_MENU, PUBLISHER_MILESTONES } from "./menu.js";
import { createPublisherPlanDraft, validatePublisherPlan } from "./plan.js";
import { projectPlanInstances } from "./change-set.js";
import type { PublisherPlanDraft } from "./plan.js";
import { STANDARD_PACK_REGISTRIES } from "../web/publisher/__fixtures__/standard-website.js";

const draft = (): PublisherPlanDraft => ({ schemaVersion: 1, menuVersion: 2, id: "example", version: 1, status: "draft", currentMilestone: "M1", answerIds: ["answer.website"], milestones: [{ id: "M1", packs: [{ id: "pack.standard-website", items: [{ id: "home", menuRef: "website.home", lane: "Landing", answerIds: ["answer.website"], openNeeds: [{ slot: "content", question: "Which content references should be bound?" }], instanceId: "standard.home", format: "web.page.responsive", layout: { leaf: "layouts.stack", config: "stack.landing" }, frame: { leaf: "frames.site-shell", config: "site" } }] }] }] });

describe("Publisher menu and draft boundaries", () => {
  it("offers a closed immutable milestone ladder, Showcase, assets and honest concepts", () => {
    expect(PUBLISHER_MILESTONES.map(m => m.id)).toEqual(["M1", "M2", "M3", "M4"]);
    expect(PUBLISHER_MENU.find(item => item.id === "website.showcase")?.lanes).toEqual(["Showcase"]);
    expect(PUBLISHER_MENU.filter(item => item.milestone === "M1").some(item => item.lanes.includes("Auth"))).toBe(false);
    expect(PUBLISHER_MENU.find(item => item.id === "assets.share")?.kind).toBe("asset");
    expect(PUBLISHER_MENU.find(item => item.id === "conversation.og")?.status).toBe("concept-only");
    expect(PUBLISHER_MENU.every(item => item.needs.sections && item.needs.frames && item.needs.formats)).toBe(true);
    expect(Object.isFrozen(PUBLISHER_MENU[0]?.needs)).toBe(true);
  });
  it("copies and freezes a valid draft without creating production instances", () => {
    const input = draft(), result = createPublisherPlanDraft(input, STANDARD_PACK_REGISTRIES);
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result.milestones[0]?.packs[0]?.items[0])).toBe(true);
    expect(projectPlanInstances(result, [{ instanceId: "standard.home" } as never])).toEqual([]);
  });
  it.each([
    ["menuRef", "unknown", "Unknown menu"], ["lane", "Invented", "lane"],
    ["format", "image.unknown", "Unknown format"], ["format", "", "Unknown format"],
    ["layout", { leaf: "layouts.stack", config: "stack.unknown" }, "layout/config"],
    ["layout", { leaf: "layouts.unknown", config: "stack.landing" }, "layout/config"],
    ["frame", { leaf: "frames.unknown" }, "frame/config"],
    ["answerIds", ["missing-answer"], "causative"], ["renderer", "invented", "fields"],
  ])("refuses mutated %s through real registries", (field, value, message) => {
    const plan = structuredClone(draft());
    Object.assign(plan.milestones[0]!.packs[0]!.items[0]!, { [field as string]: value });
    expect(validatePublisherPlan(plan, STANDARD_PACK_REGISTRIES).some(finding => finding.message.includes(message as string))).toBe(true);
    expect(() => createPublisherPlanDraft(plan, STANDARD_PACK_REGISTRIES)).toThrow("refused");
  });
  it("allows a concept format as a wish, never a production record or renderer", () => {
    const concept: PublisherPlanDraft = { ...draft(), currentMilestone: "M2", milestones: [{ id: "M2", packs: [{ id: "pack.conversation", items: [{ id: "og", menuRef: "conversation.og", lane: "Image", answerIds: ["answer.website"], openNeeds: [{ slot: "format", question: "When is the image format available?" }], format: "image.og" }] }] }] };
    expect(validatePublisherPlan(concept, STANDARD_PACK_REGISTRIES)).toEqual([]);
    Object.assign(concept.milestones[0]!.packs[0]!.items[0]!, { instanceId: "fake-instance" });
    expect(validatePublisherPlan(concept, STANDARD_PACK_REGISTRIES).some(f => f.message.includes("Concept-only"))).toBe(true);
  });
});
