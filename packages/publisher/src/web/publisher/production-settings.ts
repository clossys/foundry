import { configurationInputNeeds, recommendPlanItem } from "../../planning/configuration.js";
import type { PublisherMediaSettings, PublisherRequirementMessages } from "../../planning/configuration.js";
import type { PublisherPlanItem, PublisherPlanNeed } from "../../planning/plan.js";
import type { PublisherDeliveryChoice } from "../../formats/contract.js";
import type { FlowInstanceBinding as InstanceBinding, InstanceFinding } from "../../core/instance-binding.js";

/** Explicit production choices, outside the closed assembly binding and its evidence. */
export interface ProductionSettings {
  readonly format: InstanceBinding["format"];
  readonly frame: Pick<InstanceBinding["frame"], "leaf" | "config">;
  readonly layout: InstanceBinding["layout"];
  readonly deliveries?: readonly PublisherDeliveryChoice[];
  readonly media?: PublisherMediaSettings;
  readonly deploymentSurface?: string;
}
/** Absence means Configure is still to do. Keys are instance or host route identities. */
export type ProductionSettingsByItem = Readonly<Record<string, ProductionSettings | undefined>>;
export interface PublisherProductionState {
  readonly instances?: ProductionSettingsByItem;
  readonly appPages?: ProductionSettingsByItem;
}
/** A question is a work state, never a fabricated check result. */
export interface PublisherInputRequest {
  readonly slot: string;
  readonly question: string;
}
export type PublisherInputRequests = Readonly<Record<string, readonly PublisherInputRequest[] | undefined>>;

export function productionSettingsFromBinding(binding: InstanceBinding): ProductionSettings {
  return { format: binding.format, frame: { leaf: binding.frame.leaf, ...(binding.frame.config === undefined ? {} : { config: binding.frame.config }) }, layout: { ...binding.layout } };
}
/** Only production selections change. Consumer fills, content and state evidence stay intact. */
export function applyProductionSettings(binding: InstanceBinding, settings?: ProductionSettings): InstanceBinding {
  if (!settings) return binding;
  const { config: _config, ...frame } = binding.frame;
  return { ...binding, format: settings.format, frame: { ...frame, ...settings.frame }, layout: { ...settings.layout } };
}
export function requiredContentQuestions(findings: readonly InstanceFinding[]): readonly PublisherInputRequest[] {
  return findings.filter(finding => finding.code === "LK10" && finding.message === "Required content ref is missing")
    .map(finding => ({ slot: finding.path, question: `Which content reference should fill required slot ${finding.path}?` }));
}

/** Recommendations prefill the form; this function does not acknowledge Configure. */
export function productionSettingsFromPlanItem(item: PublisherPlanItem | undefined, fallback: ProductionSettings): ProductionSettings {
  const configuration = item && recommendPlanItem(item).configuration;
  if (configuration?.kind !== "web") return fallback;
  const { kind: _kind, ...settings } = configuration;
  return settings;
}

/** Apply a local choice only to the needs projection, never to the aligned plan. */
export function productionConfigurationNeeds(item: PublisherPlanItem | undefined, settings?: ProductionSettings, messages?: Partial<PublisherRequirementMessages>): readonly PublisherPlanNeed[] {
  if (!item) return [];
  const configuration = recommendPlanItem(item).configuration;
  if (!settings || configuration?.kind !== "web") return configurationInputNeeds(item, messages);
  const selected = settings.format === "web.page.responsive" ? { ...configuration, ...settings, format: settings.format, deliveries: settings.deliveries ?? configuration.deliveries } : { kind: "concept-only" as const, format: settings.format, deliveries: settings.deliveries ?? [] };
  return configurationInputNeeds({ ...item, configuration: selected }, messages);
}
