import type { InstanceRegistries } from "../core/instance-binding.js";
import type { CopyRef } from "@clossys/writer";
import { publisherValueRef } from "../web/publisher/value-names.js";
import type { FormatId, FormatSize, PublisherDeliveryChoice } from "../formats/contract.js";
import { getEffectiveLayoutContract, freeze } from "../layouts/resolve.js";
import type { LayoutId } from "../layouts/ids.js";
import { canonicalPlanJson } from "./digest.js";
import { PUBLISHER_MENU } from "./menu.js";
import type { PublisherDisplayNeed, PublisherMenuItem, PublisherPlanLane } from "./menu.js";
import type { PublisherPlanItem, PublisherPlanNeed } from "./plan.js";

export interface PublisherMediaSettings { readonly size: FormatSize; readonly fps?: number }
export type PublisherConfiguration =
  | { readonly kind: "web"; readonly format: "web.page.responsive"; readonly frame: { readonly leaf: `frames.${string}`; readonly config?: string }; readonly layout: { readonly leaf: LayoutId; readonly config: string }; readonly media: PublisherMediaSettings; readonly deliveries: readonly PublisherDeliveryChoice[]; readonly deploymentSurface?: string }
  | { readonly kind: "concept-only"; readonly format?: FormatId; readonly deliveries: readonly PublisherDeliveryChoice[] }
  | { readonly kind: "asset-reference"; readonly deliveries: readonly [] };
export interface PublisherLaneRecommendation { readonly lane: PublisherPlanLane; readonly configuration: PublisherConfiguration }
export interface PublisherRecommendation { readonly answerIds: readonly string[]; readonly configuration: PublisherConfiguration }
export interface PublisherConfigurationOverride { readonly field: string; readonly original: unknown; readonly value: unknown }
export interface PublisherRequirements {
  readonly brandAssets: readonly string[];
  /** An outline and reference requirements, never authored audience copy. */
  readonly contentRefs: readonly { readonly slot: string; readonly purpose: string; readonly length: "short" | "medium" | "long"; readonly requiredFacts: readonly string[] }[];
  readonly integrations: readonly string[];
}
export interface PublisherConfigurationDisplay {
  readonly needsInput: readonly PublisherDisplayNeed[];
  readonly formatRef?: Readonly<CopyRef>;
  readonly frameRef?: Readonly<CopyRef>;
  readonly frameConfigRef?: Readonly<CopyRef>;
  readonly layoutRef?: Readonly<CopyRef>;
  readonly layoutConfigRef?: Readonly<CopyRef>;
  readonly mediaKindRef?: Readonly<CopyRef>;
  readonly mediaUnitRef?: Readonly<CopyRef>;
  readonly breakpointRefs: readonly (Readonly<CopyRef> | undefined)[];
  readonly deliveries: readonly { readonly labelRef?: Readonly<CopyRef>; readonly fidelityRef?: Readonly<CopyRef> }[];
}
/** Only registered presentation references leave this projection, never substitute ID text. */
export function publisherConfigurationDisplay(configuration?: PublisherConfiguration): PublisherConfigurationDisplay {
  const needsInput: PublisherDisplayNeed[] = [];
  const ref = (parent: string, id: string, path: string) => {
    const value = publisherValueRef(parent, id);
    if (!value) needsInput.push({ path, parent, id });
    return value;
  };
  const web = configuration?.kind === "web" ? configuration : undefined;
  const size = web?.media.size;
  return freeze({
    formatRef: configuration && "format" in configuration && configuration.format ? ref("publisher.format", configuration.format, "format") : undefined,
    frameRef: web ? ref("publisher.frame", web.frame.leaf, "frame.leaf") : undefined,
    frameConfigRef: web?.frame.config ? ref(`publisher.frameConfig.${web.frame.leaf}`, web.frame.config, "frame.config") : undefined,
    layoutRef: web ? ref("publisher.layout", web.layout.leaf, "layout.leaf") : undefined,
    layoutConfigRef: web ? ref(`publisher.layoutConfig.${web.layout.leaf}`, web.layout.config, "layout.config") : undefined,
    mediaKindRef: size ? ref("publisher.mediaValue", size.kind, "media.size.kind") : undefined,
    mediaUnitRef: size && "unit" in size ? ref("publisher.mediaValue", size.unit, "media.size.unit") : undefined,
    breakpointRefs: size && "breakpoints" in size ? size.breakpoints.map((id, index) => ref("publisher.breakpoint", id, `media.size.breakpoints.${index}`)) : [],
    deliveries: (configuration?.deliveries ?? []).map((delivery, index) => ({ labelRef: ref("publisher.delivery", delivery.id, `deliveries.${index}.id`), fidelityRef: delivery.fidelity ? ref("publisher.slideFidelity", delivery.fidelity, `deliveries.${index}.fidelity`) : undefined })),
    needsInput,
  });
}
const equal = (a: unknown, b: unknown) => canonicalPlanJson(a) === canonicalPlanJson(b);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const fields = (value: object, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
export function menuConfiguration(menuRef: string, lane: PublisherPlanLane): PublisherConfiguration | undefined {
  return PUBLISHER_MENU.find(menu => menu.id === menuRef)?.recommendations.find(row => row.lane === lane)?.configuration;
}
/** Each override carries its exact original; neither side is reconstructed from a later menu. */
export function configurationOverrides(original: PublisherConfiguration, selected: PublisherConfiguration): readonly PublisherConfigurationOverride[] {
  const before = original as unknown as Record<string, unknown>, after = selected as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter(field => !equal(before[field] ?? null, after[field] ?? null))
    .map(field => ({ field, original: before[field] ?? null, value: after[field] ?? null }));
}
/** Fill omissions for an interview draft; explicit originals and overrides remain subject to validation. */
export function recommendPlanItem(item: PublisherPlanItem): PublisherPlanItem {
  const original = menuConfiguration(item.menuRef, item.lane);
  if (!original) return item;
  const recommendation = item.recommendation ?? { answerIds: [...item.answerIds], configuration: original };
  const configuration = item.configuration ?? original;
  return { ...item, recommendation, configuration, overrides: item.overrides ?? [] };
}
export function withPublisherConfiguration(item: PublisherPlanItem, configuration: PublisherConfiguration): PublisherPlanItem {
  const prepared = recommendPlanItem(item);
  if (!prepared.recommendation) throw new Error("Registered recommendation required");
  return { ...prepared, configuration, overrides: configurationOverrides(prepared.recommendation.configuration, configuration) };
}
export function validatePublisherConfiguration(configuration: PublisherConfiguration, registries: InstanceRegistries, recommendation = false): readonly string[] {
  const findings: string[] = [];
  try {
    if (configuration.kind === "asset-reference") return fields(configuration, ["kind", "deliveries"]) && Array.isArray(configuration.deliveries) && configuration.deliveries.length === 0 ? [] : ["Asset references have no generated configuration or delivery"];
    if (configuration.kind !== "web" && configuration.kind !== "concept-only") return ["Unknown configuration kind"];
    const format = registries.formats.find(leaf => leaf.id === configuration.format);
    if (configuration.format !== undefined && !format) findings.push("Unknown recommended format");
    if (configuration.kind === "web") {
      if (!fields(configuration, ["kind", "format", "frame", "layout", "media", "deliveries", "deploymentSurface"]) || format?.status !== "built") findings.push("Web configuration requires a built registered format");
      const frame = registries.frames.find(leaf => leaf.id === configuration.frame.leaf);
      if (!fields(configuration.frame, ["leaf", "config"]) || !frame || ["held", "deprecated"].includes(frame.status) || configuration.frame.config !== undefined && !frame.contract.configs.includes(configuration.frame.config) || !format?.frames.includes(configuration.frame.leaf)) findings.push("Unknown recommended frame/config");
      const layout = registries.layouts.find(leaf => leaf.id === configuration.layout.leaf);
      if (!fields(configuration.layout, ["leaf", "config"]) || !layout || !format?.allowedCompositions.includes(configuration.layout.leaf)) findings.push("Unknown recommended layout/config");
      else try { getEffectiveLayoutContract(layout, configuration.layout.config); } catch { findings.push("Unknown recommended layout/config"); }
      if (!equal(configuration.media, { size: format?.size, ...(format?.fps === undefined ? {} : { fps: format.fps }) })) findings.push("Media settings must equal registered format values");
      if (configuration.deploymentSurface !== undefined && !text(configuration.deploymentSurface)) findings.push("Deployment surface must be an ID string only");
      if (recommendation && configuration.deploymentSurface !== undefined) findings.push("Deployment surface is a host choice, not a menu default");
    } else if (!fields(configuration, ["kind", "format", "deliveries"]) || format?.status === "built") findings.push("Concept-only formats have no frame, layout, media configuration or renderer");
    if (!Array.isArray(configuration.deliveries) || new Set(configuration.deliveries.map(choice => choice.id)).size !== configuration.deliveries.length || format && configuration.deliveries.length === 0 || !format && configuration.deliveries.length > 0) findings.push("Choose registered deliveries for the format");
    else for (const choice of configuration.deliveries) {
      const delivery = format?.deliveries.find(delivery => delivery.id === choice.id);
      if (!fields(choice, ["id", "fidelity"]) || !delivery) findings.push("Unknown delivery for format");
      else if (delivery.fidelityChoices ? !delivery.fidelityChoices.includes(choice.fidelity!) : choice.fidelity !== undefined) findings.push("PPTX and Google Slides require an explicit editable or flat choice");
    }
  } catch { findings.push("Malformed configuration"); }
  return findings;
}
export function validateItemRecommendation(item: PublisherPlanItem, registries: InstanceRegistries): readonly string[] {
  const prepared = recommendPlanItem(item), expected = menuConfiguration(item.menuRef, item.lane), findings: string[] = [];
  if (!expected || !prepared.recommendation || !prepared.configuration) return ["Missing registered lane recommendation"];
  if (!fields(prepared.recommendation, ["answerIds", "configuration"]) || !equal(prepared.recommendation.configuration, expected) || !equal(prepared.recommendation.answerIds, item.answerIds)) findings.push("Original recommendation and causing answers must match the closed menu");
  if (prepared.configuration.kind !== expected.kind) findings.push("Selection must preserve the offered configuration kind");
  findings.push(...validatePublisherConfiguration(expected, registries, true), ...validatePublisherConfiguration(prepared.configuration, registries));
  if (!equal(prepared.overrides, configurationOverrides(expected, prepared.configuration))) findings.push("Overrides must retain each original recommendation and chosen value");
  return findings;
}
export function checkPublisherMenu(registries: InstanceRegistries, menu: readonly PublisherMenuItem[] = PUBLISHER_MENU): readonly string[] {
  return menu.flatMap(item => {
    const findings: string[] = [];
    if (item.recommendations.length !== item.lanes.length || new Set(item.recommendations.map(row => row.lane)).size !== item.lanes.length || item.lanes.some(lane => !item.recommendations.some(row => row.lane === lane))) findings.push("Every offered lane needs one recommendation");
    for (const row of item.recommendations) findings.push(...validatePublisherConfiguration(row.configuration, registries, true));
    if (!item.requirements.brandAssets.every(text) || !item.requirements.integrations.every(text) || !item.requirements.contentRefs.every(ref => text(ref.slot) && text(ref.purpose) && ["short", "medium", "long"].includes(ref.length) && ref.requiredFacts.every(text))) findings.push("Requirements need content outlines and references");
    return findings.map(finding => `${item.id}: ${finding}`);
  });
}
export interface PublisherRequirementMessages {
  /** @default "Which consumer asset reference supplies ASSET?" */
  readonly assetQuestion: (asset: string) => string;
  /** @default "Which content reference supplies PURPOSE (LENGTH)? Required facts: FACTS." */
  readonly contentQuestion: (ref: PublisherRequirements["contentRefs"][number]) => string;
  /** @default "Which host integration supplies INTEGRATION?" */
  readonly integrationQuestion: (integration: string) => string;
  /** @default "Which registered implementation supplies the required sections, frames and formats: DEPENDENCIES?" */
  readonly dependenciesQuestion: (dependencies: readonly string[]) => string;
  /** @default "Which host deployment surface ID should receive the web bundle?" */
  readonly deploymentQuestion: string;
  /** @default "Should the slides be editable native objects or flat slide images?" */
  readonly fidelityQuestion: string;
}
/** Questions stay explicit; merely recommending a reference never supplies it. */
export function configurationInputNeeds(item: PublisherPlanItem, messages?: Partial<PublisherRequirementMessages>): readonly PublisherPlanNeed[] {
  const menu = PUBLISHER_MENU.find(menu => menu.id === item.menuRef), configuration = recommendPlanItem(item).configuration;
  const needs: PublisherPlanNeed[] = [];
  const assetQuestion = messages?.assetQuestion ?? ((asset: string) => `Which consumer asset reference supplies ${asset}?`);
  const contentQuestion = messages?.contentQuestion ?? ((ref: PublisherRequirements["contentRefs"][number]) => `Which content reference supplies ${ref.purpose} (${ref.length})? Required facts: ${ref.requiredFacts.join(", ")}.`);
  const integrationQuestion = messages?.integrationQuestion ?? ((integration: string) => `Which host integration supplies ${integration}?`);
  const dependenciesQuestion = messages?.dependenciesQuestion ?? ((dependencies: readonly string[]) => `Which registered implementation supplies the required sections, frames and formats: ${dependencies.join(", ")}?`);
  /** @default 'Which host deployment surface ID should receive the web bundle?' */
  const deploymentQuestion = messages?.deploymentQuestion ?? 'Which host deployment surface ID should receive the web bundle?';
  /** @default 'Should the slides be editable native objects or flat slide images?' */
  const fidelityQuestion = messages?.fidelityQuestion ?? 'Should the slides be editable native objects or flat slide images?';
  if (menu) {
    for (const asset of menu.requirements.brandAssets) needs.push({ slot: `brandAssets.${asset}`, question: assetQuestion(asset) });
    for (const ref of menu.requirements.contentRefs) needs.push({ slot: `content.${ref.slot}`, question: contentQuestion(ref) });
    for (const integration of menu.requirements.integrations) needs.push({ slot: `integration.${integration}`, question: integrationQuestion(integration) });
    if (menu.status === "concept-only") needs.push({ slot: "dependencies", question: dependenciesQuestion([...menu.needs.sections, ...menu.needs.frames, ...menu.needs.formats]) });
  }
  if (configuration?.kind === "web" && !configuration.deploymentSurface) needs.push({ slot: "deploymentSurface", question: deploymentQuestion });
  for (const delivery of configuration?.deliveries ?? []) if ((delivery.id === "pptx" || delivery.id === "google-slides") && !delivery.fidelity) needs.push({ slot: `deliveries.${delivery.id}.fidelity`, question: fidelityQuestion });
  return needs;
}
export interface PublisherDeliveryState { readonly export: "concept-only" | "unknown"; readonly deploy: "unknown"; readonly deliveries: readonly { readonly id: string; readonly status: "concept-only" | "unknown" }[] }
/** No artifact or Builder health is supplied by this local contract. */
export function derivePublisherDeliveryState(configuration?: { readonly format?: FormatId; readonly deliveries: readonly PublisherDeliveryChoice[] }, registries?: InstanceRegistries): PublisherDeliveryState {
  const format = configuration && "format" in configuration ? registries?.formats.find(format => format.id === configuration.format) : undefined;
  const deliveries = (configuration?.deliveries ?? []).map(choice => ({ id: choice.id, status: format?.deliveries.find(delivery => delivery.id === choice.id)?.status === "concept-only" ? "concept-only" as const : "unknown" as const }));
  return freeze({ export: deliveries.length && deliveries.every(delivery => delivery.status === "concept-only") ? "concept-only" : "unknown", deploy: "unknown", deliveries });
}
