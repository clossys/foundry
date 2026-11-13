import { describe, expect, it } from "vitest";
import { checkPublisherMenu, configurationInputNeeds, derivePublisherDeliveryState, menuConfiguration, publisherConfigurationDisplay, recommendPlanItem, validatePublisherConfiguration } from "./configuration.js";
import { withPublisherConfiguration } from "../core/index.js";
import type { PublisherConfiguration } from "./configuration.js";
import { createPublisherPlanDraft, validatePublisherPlan } from "./plan.js";
import type { PublisherPlanDraft, PublisherPlanItem } from "./plan.js";
import { PublisherPlanStore, alignedPlanItems } from "./change-set.js";
import { PUBLISHER_MENU, PUBLISHER_MENU_VERSION } from "./menu.js";
import { STANDARD_PACK_REGISTRIES as registries } from "../web/publisher/__fixtures__/standard-website.js";
import { createM1ExampleDraft } from "../web/publisher/__fixtures__/example-plan.js";
import { applyProductionSettings, productionSettingsFromPlanItem } from "../web/publisher/production-settings.js";
import { STANDARD_PACK_INSTANCES } from "../web/publisher/__fixtures__/standard-website.js";
const home = () => createM1ExampleDraft().milestones[0]!.packs[0]!.items[0]!;
function withItem(item: PublisherPlanItem): PublisherPlanDraft {
  const plan = createM1ExampleDraft();
  return { ...plan, milestones: [{ id: "M1", packs: [{ id: "pack.standard-website", items: [item] }] }] };
}
const web = (): Extract<PublisherConfiguration, { kind: "web" }> => menuConfiguration("website.home", "Landing") as Extract<PublisherConfiguration, { kind: "web" }>;

describe("configuration display references", () => {
  it("projects every closed recommendation without changing serialized configuration", () => {
    for (const menu of PUBLISHER_MENU) for (const row of menu.recommendations) {
      const before = JSON.stringify(row.configuration);
      const display = publisherConfigurationDisplay(row.configuration);
      expect(display.needsInput).toEqual([]);
      expect(Object.isFrozen(display.deliveries)).toBe(true);
      if (row.configuration.kind === "web") {
        expect(display.formatRef).toEqual({ id: "st.w5h0dvynnd" });
        expect(display.layoutRef).toBeDefined();
        expect(display.layoutConfigRef).toBeDefined();
        expect(display.breakpointRefs.every(Boolean)).toBe(true);
      }
      expect(JSON.stringify(row.configuration)).toBe(before);
    }
  });
  it("names an unmapped value without converting its machine ID into a label", () => {
    const display = publisherConfigurationDisplay({ ...web(), layout: { leaf: "layouts.stack", config: "stack.unregistered" } });
    expect(display.layoutConfigRef).toBeUndefined();
    expect(display.needsInput).toContainEqual({ path: "layout.config", parent: "publisher.layoutConfig.layouts.stack", id: "stack.unregistered" });
    expect(Object.isFrozen(display.needsInput[0])).toBe(true);
  });
});

describe("closed recommendations and requirements", () => {
  it("gives every offered lane one registered recommendation with honest asset and concept boundaries", () => {
    expect(PUBLISHER_MENU_VERSION).toBe(2);
    expect(checkPublisherMenu(registries)).toEqual([]);
    for (const menu of PUBLISHER_MENU) {
      expect(menu.recommendations.map(row => row.lane)).toEqual(menu.lanes);
      expect(Object.isFrozen(menu.recommendations)).toBe(true);
      expect(Object.isFrozen(menu.requirements)).toBe(true);
    }
    expect(menuConfiguration("website.about", "Document")).toMatchObject({ layout: { config: "stack.document" } });
    expect(menuConfiguration("app.ops", "Record")).toMatchObject({ frame: { leaf: "frames.app-shell" }, layout: { config: "sidebar-content.record" } });
    expect(menuConfiguration("assets.share", "Assets")).toEqual({ kind: "asset-reference", deliveries: [] });
    for (const id of ["conversation.email", "conversation.og", "conversation.pdf", "conversation.deck", "proof.video"]) {
      const item = PUBLISHER_MENU.find(menu => menu.id === id)!;
      const recommendation = item.recommendations[0]!.configuration;
      expect(recommendation.kind).toBe("concept-only");
      expect(Object.keys(recommendation).sort()).toEqual(["deliveries", "format", "kind"]);
      expect(item.requirements.contentRefs[0]).toHaveProperty("purpose");
    }
    expect(PUBLISHER_MENU.find(menu => menu.id === "website.contact")?.requirements.integrations).toContain("contact-inbox");
  });
  it.each([
    { format: "invented.format" }, { frame: { leaf: "frames.unknown" } },
    { layout: { leaf: "layouts.stack", config: "stack.default" } },
    { media: { size: { kind: "responsive", breakpoints: ["768px"] } } },
    { deliveries: [{ id: "pptx", fidelity: "flat" }] }, { deploymentSurface: { id: "fixture.web" } },
    { deliveries: [{ id: "static-site-bundle", exporter: "invented" }] },
  ])("refuses an invented selected or recommended value: %j", mutation => {
    const configuration = { ...web(), ...mutation } as PublisherConfiguration;
    expect(validatePublisherConfiguration(configuration, registries).length).toBeGreaterThan(0);
    const changed = withPublisherConfiguration(home(), configuration);
    expect(validatePublisherPlan(withItem(changed), registries).length).toBeGreaterThan(0);
    const menu = structuredClone(PUBLISHER_MENU);
    Object.assign(menu[0]!.recommendations[0]!.configuration, mutation);
    expect(checkPublisherMenu(registries, menu).length).toBeGreaterThan(0);
  });
  it("validates the original recommendation even when the selected configuration is registered", () => {
    const item = home();
    const bad = { ...item, recommendation: { ...item.recommendation!, configuration: { ...web(), frame: { leaf: "frames.unknown" } } } } as PublisherPlanItem;
    expect(validatePublisherPlan(withItem(bad), registries).some(f => f.message.includes("Original recommendation"))).toBe(true);
    expect(validatePublisherConfiguration({ kind: "concept-only", format: "deck.16x9", deliveries: [{ id: "pdf" }], media: { size: { kind: "aspect-ratio", width: 16, height: 9 } } } as never, registries)).not.toEqual([]);
  });
  it("keeps concept offers with registered web recommendations out of production", async () => {
    const menu = PUBLISHER_MENU.find(menu => menu.id === "customer.auth")!;
    const plan: PublisherPlanDraft = { schemaVersion: 1, menuVersion: 2, id: "concept-web", version: 1, status: "draft", currentMilestone: "M3", answerIds: ["answer.account"], milestones: [{ id: "M3", packs: [{ id: "pack.customer", items: [{ id: menu.id, menuRef: menu.id, lane: "Auth", answerIds: ["answer.account"], openNeeds: [] }] }] }] };
    const store = new PublisherPlanStore(registries);
    const aligned = await store.apply(store.propose(plan), () => true);
    expect(aligned.milestones[0]!.packs[0]!.items[0]!.configuration).toMatchObject({ kind: "web", format: "web.page.responsive" });
    expect(alignedPlanItems(aligned)).toEqual([]);
  });
});

describe("configuration provenance at Align", () => {
  it("rejects an unrecorded override and a rewritten original; explicit helper records both sides", async () => {
    const original = home(), chosen = { ...web(), layout: { leaf: "layouts.stack" as const, config: "stack.index" }, deploymentSurface: "fixture.web-preview" };
    const unrecorded = { ...original, configuration: chosen };
    expect(validatePublisherPlan(withItem(unrecorded), registries).some(f => f.message.includes("Overrides"))).toBe(true);
    const missing = { ...unrecorded, overrides: undefined };
    expect(() => createPublisherPlanDraft(withItem(missing), registries)).toThrow("refused");
    const item = withPublisherConfiguration(original, chosen);
    expect(item.overrides).toContainEqual({ field: "layout", original: { leaf: "layouts.stack", config: "stack.landing" }, value: chosen.layout });
    expect(item.overrides).toContainEqual({ field: "deploymentSurface", original: null, value: "fixture.web-preview" });
    const store = new PublisherPlanStore(registries), proposal = store.propose(withItem(item));
    expect(store.versions).toEqual([]);
    const aligned = await store.apply(proposal, () => true);
    const alignedItem = aligned.milestones[0]!.packs[0]!.items[0]!;
    expect(alignedItem.recommendation?.configuration).toEqual(original.configuration);
    expect(alignedItem.recommendation?.answerIds).toEqual(original.answerIds);
    expect(Object.isFrozen(alignedItem.overrides?.[0]?.original)).toBe(true);
    const before = JSON.stringify(aligned);
    const binding = STANDARD_PACK_INSTANCES[0]!;
    const settings = productionSettingsFromPlanItem(alignedItem, { format: binding.format, frame: binding.frame, layout: binding.layout });
    applyProductionSettings(binding, { ...settings, layout: { leaf: "layouts.stack", config: "stack.focus" } });
    expect(JSON.stringify(aligned)).toBe(before);
    const nextDraft = { ...withItem(withPublisherConfiguration(alignedItem, web())), version: 2 };
    await store.apply(store.propose(nextDraft), () => true);
    expect(JSON.stringify(store.versions[0])).toBe(before);
    expect(store.current?.milestones[0]?.packs[0]?.items[0]?.overrides).toEqual([]);
  });
  it("retains causative answers and refuses tampered original or override provenance", () => {
    const item = withPublisherConfiguration(home(), { ...web(), deploymentSurface: "fixture.web" });
    for (const mutation of [
      { recommendation: { answerIds: ["another-answer"], configuration: web() } },
      { recommendation: { answerIds: item.answerIds, configuration: { ...web(), deploymentSurface: "fixture.web" } } },
      { overrides: [{ field: "deploymentSurface", original: "hidden-default", value: "fixture.web" }] },
    ]) expect(validatePublisherPlan(withItem({ ...item, ...mutation } as PublisherPlanItem), registries).length).toBeGreaterThan(0);
  });
});

it("requires explicit slide fidelity and derives only concept-only exports or unknown deployment", () => {
  const configuration = { kind: "concept-only" as const, format: "deck.16x9" as const, deliveries: [{ id: "pptx" as const }] };
  expect(validatePublisherConfiguration(configuration, registries).join(" ")).toContain("explicit editable or flat");
  for (const fidelity of ["editable", "flat"] as const) expect(validatePublisherConfiguration({ ...configuration, deliveries: [{ id: "pptx", fidelity }, { id: "google-slides", fidelity }] }, registries)).toEqual([]);
  expect(derivePublisherDeliveryState(configuration, registries)).toMatchObject({ export: "concept-only", deploy: "unknown" });
  expect(derivePublisherDeliveryState(web(), registries)).toMatchObject({ export: "concept-only", deploy: "unknown", deliveries: [{ id: "static-site-bundle", status: "concept-only" }] });
  expect(derivePublisherDeliveryState(web())).toMatchObject({ export: "unknown", deploy: "unknown" });
  expect(derivePublisherDeliveryState()).toMatchObject({ export: "unknown", deploy: "unknown" });
});
it("exposes content and asset references as needs input with host message overrides", () => {
  const item = recommendPlanItem(home());
  expect(configurationInputNeeds(item).map(need => need.slot)).toEqual(expect.arrayContaining(["brandAssets.logo", "content.lead", "content.body", "deploymentSurface"]));
  expect(configurationInputNeeds(item, { deploymentQuestion: "Choose the host surface" })).toContainEqual({ slot: "deploymentSurface", question: "Choose the host surface" });
  const selected = withPublisherConfiguration(item, { ...web(), deploymentSurface: "fixture.web" });
  expect(configurationInputNeeds(selected).some(need => need.slot === "deploymentSurface")).toBe(false);
  expect(configurationInputNeeds(selected).some(need => need.slot.startsWith("content."))).toBe(true);
});
