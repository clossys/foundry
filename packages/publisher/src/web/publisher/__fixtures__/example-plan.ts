import { PUBLISHER_MENU } from "../../../planning/menu.js";
import { createPublisherPlanDraft } from "../../../planning/plan.js";
import type { PublisherPlanDraft, PublisherPlanItem } from "../../../planning/plan.js";
import { PublisherPlanStore } from "../../../planning/change-set.js";
import type { InstanceRegistries } from "../../../core/instance-binding.js";
import type { AppInventory } from "../app/inventory.js";
import { STANDARD_PACK_INSTANCES, STANDARD_PACK_REGISTRIES } from "./standard-website.js";
const needs = [{ slot: "content", question: "Which consumer content references and brand assets should be bound?" }];
/** Interview suggestion only. Merely selecting this fixture creates no production items. */
export function createM1ExampleDraft(version = 1): PublisherPlanDraft {
  return createPublisherPlanDraft({ schemaVersion: 1, menuVersion: 2, id: "example.publisher", version, status: "draft", currentMilestone: "M1", answerIds: ["example.first-impression"], milestones: [{ id: "M1", packs: [
    { id: "pack.standard-website", items: STANDARD_PACK_INSTANCES.map(binding => ({ id: binding.instanceId, menuRef: binding.instanceId.replace("standard.", "website."), lane: binding.instanceId === "standard.home" ? "Landing" : binding.instanceId === "standard.showcase" ? "Showcase" : binding.instanceId === "standard.contact" ? "Contact" : ["standard.error", "standard.not-found"].includes(binding.instanceId) ? "Status" : "Document", answerIds: ["example.first-impression"], openNeeds: needs, instanceId: binding.instanceId, format: binding.format, ...(binding.instanceId === "standard.about" ? {} : { layout: binding.layout }) })) },
    { id: "pack.brand-assets", items: ["assets.brand", "assets.share"].map(id => ({ id, menuRef: id, lane: "Assets", answerIds: ["example.first-impression"], openNeeds: [{ slot: "asset", question: "Which consumer asset reference should be checked?" }] })) },
  ] }] }, STANDARD_PACK_REGISTRIES);
}
/** The preview's same M1 suggestion, with optional independently inventoried App entries. */
export function createPreviewM1Draft(inventory: AppInventory | null, version: number): PublisherPlanDraft {
  const example = createM1ExampleDraft(version);
  if (!inventory) return example;
  const app = createAppExampleDraft(inventory, version);
  return { ...example, answerIds: [...example.answerIds, ...app.answerIds], milestones: [{ id: "M1", packs: [...example.milestones[0]!.packs, ...app.milestones[0]!.packs] }] };
}
/** The preview's empty next-version proposal, never an aligned plan. */
export function createEmptyExampleDraft(version: number): PublisherPlanDraft {
  const next = createM1ExampleDraft(version);
  return { ...next, milestones: [{ id: "M1", packs: [] }] };
}
/** Independent App planning; never enrolls Standard website or treats inventory as adoption. */
export function createAppExampleDraft(inventory: AppInventory, version = 1): PublisherPlanDraft {
  const items: PublisherPlanItem[] = [...inventory.routes.filter(route => route.kind !== "detail-tab"), ...(inventory.missingDecisions ?? [])].map(route => ({ id: `app.${route.id}`, menuRef: "app.ops", lane: route.lane, appRouteId: route.id, answerIds: ["example.app-operations"], openNeeds: [{ slot: "implementation", question: "Which consumer implementation and content should back this inventory entry?" }] }));
  return createPublisherPlanDraft({ schemaVersion: 1, menuVersion: 2, id: "example.publisher", version, status: "draft", currentMilestone: "M1", answerIds: ["example.app-operations"], milestones: [{ id: "M1", packs: [{ id: "pack.app", items }] }] }, STANDARD_PACK_REGISTRIES);
}
/** Explicitly accepted test fixture, never a default or a real consumer approval record. */
export async function acceptedExampleStore(registries: InstanceRegistries = STANDARD_PACK_REGISTRIES): Promise<PublisherPlanStore> {
  const store = new PublisherPlanStore(registries);
  await store.apply(store.propose(createM1ExampleDraft()), () => true);
  return store;
}

/** Concept deliveries are interview wishes only; no media renderer or export is fabricated. */
export function createDeliveryExampleDraft(version = 1): PublisherPlanDraft {
  const offers = PUBLISHER_MENU.filter(menu => ["conversation.email", "conversation.og", "conversation.pdf", "conversation.deck", "proof.video"].includes(menu.id));
  return createPublisherPlanDraft({ schemaVersion: 1, menuVersion: 2, id: "example.publisher", version, status: "draft", currentMilestone: "M2", answerIds: ["example.delivery-destinations"], milestones: (["M2", "M4"] as const).map(id => ({ id, packs: [{ id: id === "M2" ? "pack.conversation" : "pack.proof", items: offers.filter(menu => menu.milestone === id).map(menu => ({ id: menu.id, menuRef: menu.id, lane: menu.lanes[0]!, answerIds: ["example.delivery-destinations"], openNeeds: [] })) }] })) }, STANDARD_PACK_REGISTRIES);
}
