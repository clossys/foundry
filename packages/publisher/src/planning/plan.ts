import { isCompleteRouteKind, routeSourcePath } from "../core/route-identities.js";
import type { CompleteRouteKind, RouteSourceExport, RouteRegistration } from "../core/route-registry.js";
import type { InstanceRegistries } from "../core/instance-binding.js";
import type { CopyRef } from "@clossys/writer";
import { publisherValueRef } from "../web/publisher/value-names.js";
import { getEffectiveLayoutContract, freeze } from "../layouts/resolve.js";
import type { FormatId } from "../formats/contract.js";
import { recommendPlanItem, validateItemRecommendation } from "./configuration.js";
import type { PublisherConfiguration, PublisherRecommendation, PublisherConfigurationOverride } from "./configuration.js";
import type { LayoutId } from "../layouts/ids.js";
import { MILESTONE_IDS, PUBLISHER_MENU, PUBLISHER_MENU_VERSION, PUBLISHER_PACKS } from "./menu.js";
import type { MilestoneId, PublisherDisplayNeed, PublisherPlanLane, PublisherPlanPackId } from "./menu.js";

/** Public plan/command input for a native admin page; appRouteId supplies its registry identity. */
export interface PublisherCompleteRoutePlan {
  readonly kind: CompleteRouteKind;
  readonly path: string;
  readonly title: string;
  readonly brand: RouteRegistration["brand"];
  readonly entry: RouteSourceExport;
  readonly loader: RouteSourceExport;
}
export interface PublisherPlanNeed { readonly slot: string; readonly question: string }
export interface PublisherPlanItem {
  readonly id: string;
  readonly menuRef: string;
  readonly lane: PublisherPlanLane;
  readonly answerIds: readonly string[];
  readonly openNeeds: readonly PublisherPlanNeed[];
  readonly recommendation?: PublisherRecommendation;
  readonly configuration?: PublisherConfiguration;
  readonly overrides?: readonly PublisherConfigurationOverride[];
  /** References existing host records; a plan never fabricates an implementation. */
  readonly instanceId?: string;
  readonly appRouteId?: string;
  readonly completeRoute?: PublisherCompleteRoutePlan;
  readonly assetId?: string;
  readonly format?: FormatId;
  readonly layout?: { readonly leaf: LayoutId; readonly config: string };
  readonly frame?: { readonly leaf: `frames.${string}`; readonly config?: string };
}
export interface PublisherPlanPack { readonly id: PublisherPlanPackId; readonly items: readonly PublisherPlanItem[] }
export interface PublisherPlanMilestone { readonly id: MilestoneId; readonly packs: readonly PublisherPlanPack[] }
export interface PublisherPlanDraft {
  readonly schemaVersion: 1;
  readonly menuVersion: typeof PUBLISHER_MENU_VERSION;
  readonly id: string;
  readonly version: number;
  readonly status: "draft";
  readonly currentMilestone: MilestoneId;
  readonly answerIds: readonly string[];
  readonly milestones: readonly PublisherPlanMilestone[];
}
export interface PublisherPlanFinding { readonly path: string; readonly message: string }
export interface PublisherPlanItemDisplay {
  readonly labelRef?: Readonly<CopyRef>;
  readonly laneRef?: Readonly<CopyRef>;
  readonly needsInput: readonly PublisherDisplayNeed[];
}
/** Route paths are host-supplied evidence; opaque item and route identities are never prettified. */
export function publisherPlanItemDisplay(item: PublisherPlanItem, routePath?: string): PublisherPlanItemDisplay {
  const parent = routePath === undefined ? "publisher.menuItem" : "publisher.planPage";
  const id = routePath ?? item.menuRef;
  const labelRef = publisherValueRef(parent, id);
  const laneRef = publisherValueRef("publisher.lane", item.lane);
  return freeze({ labelRef, laneRef, needsInput: [
    ...(!labelRef ? [{ path: "label", parent, id }] : []),
    ...(!laneRef ? [{ path: "lane", parent: "publisher.lane", id: item.lane }] : []),
  ] });
}
export interface PublisherPlanNeedDisplay {
  readonly slotLabelRef?: Readonly<CopyRef>;
  readonly questionRef?: Readonly<CopyRef>;
  readonly needsInput: readonly PublisherDisplayNeed[];
}
/** Authored question strings remain plan evidence; display uses a registered slot question. */
export function publisherPlanNeedDisplay(need: PublisherPlanNeed): PublisherPlanNeedDisplay {
  const parent = need.slot.startsWith("brandAssets.") ? "publisher.brandAsset" : need.slot.startsWith("content.") ? "publisher.content" : "publisher.contentKey";
  const slotLabelRef = publisherValueRef(parent, need.slot);
  const questionRef = publisherValueRef("publisher.setupQuestion", need.slot);
  return freeze({ slotLabelRef, questionRef, needsInput: [
    ...(!slotLabelRef ? [{ path: "slot", parent, id: need.slot }] : []),
    ...(!questionRef ? [{ path: "question", parent: "publisher.setupQuestion", id: need.slot }] : []),
  ] });
}
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;
const fields = (value: object, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
/** Validate a draft without evaluating checks or producing production items. */
export function validatePublisherPlan(plan: PublisherPlanDraft, registries: InstanceRegistries): readonly PublisherPlanFinding[] {
  const findings: PublisherPlanFinding[] = [];
  const add = (path: string, message: string) => findings.push({ path, message });
  try {
    if (!fields(plan, ["schemaVersion", "menuVersion", "id", "version", "status", "currentMilestone", "answerIds", "milestones"]) || plan.schemaVersion !== 1 || plan.menuVersion !== PUBLISHER_MENU_VERSION || plan.status !== "draft" || !text(plan.id) || !Number.isSafeInteger(plan.version) || plan.version < 1) add("plan", "Unsupported plan identity, version or fields");
    if (!unique(plan.answerIds) || !plan.answerIds.every(text)) add("answerIds", "Answer identities must be unique and nonempty");
    if (!unique(plan.milestones.map(m => m.id)) || !plan.milestones.some(m => m.id === plan.currentMilestone)) add("milestones", "Current milestone must occur once in the plan");
    const ids: string[] = [];
    const completePaths = new Set<string>();
    for (const milestone of plan.milestones) {
      if (!fields(milestone, ["id", "packs"]) || !(MILESTONE_IDS as readonly string[]).includes(milestone.id) || !unique(milestone.packs.map(p => p.id))) add("milestones", "Unknown milestone or duplicate pack");
      for (const pack of milestone.packs) {
        if (!fields(pack, ["id", "items"]) || !PUBLISHER_PACKS.some(p => p.id === pack.id)) add("packs", "Unknown pack");
        for (const item of pack.items) {
          const path = `items.${item.id}`;
          ids.push(item.id);
          if (!text(item.id) || !fields(item, ["id", "menuRef", "lane", "answerIds", "openNeeds", "instanceId", "appRouteId", "assetId", "format", "layout", "frame", "recommendation", "configuration", "overrides", "completeRoute"])) add(path, "Unknown item fields or identity");
          const menu = PUBLISHER_MENU.find(entry => entry.id === item.menuRef);
          if (!menu) { add(path, "Unknown menu reference"); continue; }
          if (menu.pack !== pack.id || menu.milestone !== milestone.id && menu.id !== "app.ops") add(path, "Menu placement disagrees with milestone or pack");
          if (!menu.lanes.includes(item.lane)) add(path, "Unknown or incompatible lane");
          for (const message of validateItemRecommendation(item, registries)) add(path, message);
          if (!item.answerIds.length || !unique(item.answerIds) || item.answerIds.some(id => !plan.answerIds.includes(id))) add(path, "Each item needs known causative answer identities");
          if (!item.openNeeds.every(need => fields(need, ["slot", "question"]) && text(need.slot) && text(need.question))) add(path, "Open needs require a slot and blocking question");
          if ([item.instanceId, item.appRouteId, item.assetId].filter(value => value !== undefined).length > 1 || [item.instanceId, item.appRouteId, item.assetId].some(value => value !== undefined && !text(value))) add(path, "Expected at most one nonempty host reference");
          if (menu.status === "concept-only" && (item.instanceId || item.appRouteId || item.assetId)) add(path, "Concept-only items cannot reference production records");
          if (item.instanceId && menu.kind !== "page" || item.appRouteId && menu.kind !== "app-route" || item.assetId && menu.kind !== "asset") add(path, "Host reference disagrees with menu kind");
          if (item.completeRoute !== undefined) {
            const c = item.completeRoute;
            if (completePaths.has(c.path)) add(path, "Complete route paths must be unique");
            completePaths.add(c.path);
            const ref = (value: RouteSourceExport) => !!value && fields(value, ["file", "export"]) && routeSourcePath(value.file) && /^[A-Za-z_$][\w$]*$/.test(value.export);
            if (!c || !fields(c, ["kind", "path", "title", "brand", "entry", "loader"]) || !isCompleteRouteKind(c.kind) || !item.appRouteId || menu.kind !== "app-route" || !text(c.title)
              || !/^\/(?:[^/?#\\]+\/?)*$/.test(c.path) || c.path.includes("//") || c.path.includes("%") || c.path !== (c.path.replace(/\/$/, "") || "/") || c.path.split("/").some(part => part === "." || part === "..")
              || !c.brand || !fields(c.brand, ["homeRouteId", "label"]) || !text(c.brand.homeRouteId) || !text(c.brand.label)
              || !ref(c.entry) || c.entry.export !== "default" || !c.entry.file.endsWith(".tsx") || !ref(c.loader) || !/\.[jt]sx?$/.test(c.loader.file) || c.loader.file.endsWith(".d.ts") || c.entry.file === c.loader.file)
              add(path, "Complete route requires a known kind, appRouteId, canonical path/title/brand, TSX entry and separate typed loader");
          }
          if (item.layout) {
            if (!fields(item.layout, ["leaf", "config"])) add(path, "Unknown layout fields");
            try { getEffectiveLayoutContract(registries.layouts.find(leaf => leaf.id === item.layout!.leaf)!, item.layout.config); }
            catch { add(path, "Unknown or unavailable layout/config"); }
          }
          const format = item.format !== undefined ? registries.formats.find(leaf => leaf.id === item.format) : undefined;
          if (item.format !== undefined && !format) add(path, "Unknown format");
          if (menu.status === "built" && format && format.status !== "built") add(path, "Built item cannot use a concept format");
          if (format && item.layout && !format.allowedCompositions.includes(item.layout.leaf)) add(path, "Layout is not allowed by format");
          if (item.frame) {
            const frame = registries.frames.find(leaf => leaf.id === item.frame!.leaf);
            if (!fields(item.frame, ["leaf", "config"]) || !frame || ["held", "deprecated"].includes(frame.status) || item.frame.config !== undefined && !frame.contract.configs.includes(item.frame.config)) add(path, "Unknown or unavailable frame/config");
            if (format && !format.frames.includes(item.frame.leaf)) add(path, "Frame is not allowed by format");
          }
        }
      }
    }
    if (!unique(ids)) add("items", "Item identities must be unique across milestones");
  } catch { add("plan", "Malformed plan data"); }
  return findings;
}
export function createPublisherPlanDraft(plan: PublisherPlanDraft, registries: InstanceRegistries): PublisherPlanDraft {
  const prepared: PublisherPlanDraft = { ...plan, milestones: plan.milestones.map(milestone => ({ ...milestone, packs: milestone.packs.map(pack => ({ ...pack, items: pack.items.map(recommendPlanItem) })) })) };
  if (validatePublisherPlan(prepared, registries).length) throw new Error("Publisher plan refused");
  return freeze(structuredClone(prepared));
}
