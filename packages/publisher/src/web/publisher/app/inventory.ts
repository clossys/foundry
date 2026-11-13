import { derivePublisherDeliveryState } from "../../../planning/configuration.js";
import type { InstanceRegistries } from "../../../core/instance-binding.js";
import type { ProductionSettings } from "../production-settings.js";
/** Host-owned route inventory. No consumer route catalogue ships with Publisher. */
export const APP_LANES = ["Dashboard", "Collection", "Record", "Settings", "Studio", "Status"] as const;
export const APP_STAGES = ["Configure", "Frame", "Layout", "Fills", "Content", "Checks", "States", "Ready", "Export", "Deploy"] as const;
export const APP_DETAIL_TAB_STAGES = ["Fills", "Content", "Checks", "States", "Ready"] as const;
export const APP_STATE_NAMES = ["loading", "empty", "error"] as const;
export type AppLane = typeof APP_LANES[number];
export type AppStage = typeof APP_STAGES[number];
export interface AppStateDeclaration {
  readonly declared: boolean;
  readonly scope: string;
  readonly condition: string | null;
  /** Absence in a legacy inventory is undecided, never implicit applicability. */
  readonly applicability?: "required" | "not-applicable" | "undecided";
  readonly scopeKind?: "page" | "panel" | "none";
}
export interface AppRoute {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly transport: "hash" | "next";
  readonly kind: "index" | "details" | "detail-tab" | "native-page" | "page";
  readonly lane: AppLane;
  readonly parentRecordRoute: string | null;
  readonly parentSubrowId?: string;
  readonly pathParameters: readonly string[];
  readonly frame: string;
  readonly layoutConfig: string;
  readonly fills: "unassigned";
  readonly contentRefs: "unassigned";
  readonly declaredStates: Readonly<Record<typeof APP_STATE_NAMES[number], AppStateDeclaration>>;
}
export interface AppMissingDecision {
  readonly id: string;
  readonly label: string;
  readonly lane: AppLane;
}
export interface AppInventory {
  readonly source: { readonly head: string; readonly tree: string };
  readonly routes: readonly AppRoute[];
  readonly missingDecisions?: readonly AppMissingDecision[];
  readonly nonAddressableTabs: readonly { readonly hostRouteId: string; readonly tabIds: readonly string[] }[];
}
export interface AppScopedStateDeclaration extends AppStateDeclaration {
  readonly applicability: "required" | "not-applicable" | "undecided";
  readonly scopeKind: "page" | "panel" | "none";
}
/** Host normalization target. Source evidence and implementation payloads are deliberately absent. */
export interface AppPageProjection extends Pick<AppRoute, "id" | "label" | "path" | "transport" | "lane" | "pathParameters" | "frame" | "layoutConfig"> {
  readonly declaredStates: Readonly<Record<typeof APP_STATE_NAMES[number], AppScopedStateDeclaration>>;
}
export interface AppSubrowProjection extends Pick<AppPageProjection, "id" | "label" | "path" | "transport" | "pathParameters" | "declaredStates"> {
  readonly parentPageId: string;
  readonly parentSubrowId?: string;
}
export interface AppInventoryProjection {
  readonly schemaVersion: 2;
  readonly artifactType: "app-route-inventory";
  readonly source: AppInventory["source"];
  readonly pages: readonly AppPageProjection[];
  readonly subrows: readonly AppSubrowProjection[];
  readonly missingDecisions?: readonly AppMissingDecision[];
  readonly nonAddressableTabs: readonly { readonly hostRouteId: string; readonly tabIds: readonly string[]; readonly routeIdentity: null }[];
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected inventory object");
  return value as Record<string, unknown>;
};
const string = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error("Expected nonempty inventory string");
  return value;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Expected inventory array");
  return value;
};
const choice = <T extends string>(value: unknown, choices: readonly T[]): T => {
  if (!choices.includes(value as T)) throw new Error("Unsupported inventory value");
  return value as T;
};
/** Validate and copy only presentation fields; raw source evidence never reaches browser props. */
export function projectAppInventory(input: unknown, missingDecisions: readonly AppMissingDecision[] = []): AppInventory {
  const raw = object(input), source = object(raw.source);
  if (![1, 2].includes(raw.schemaVersion as number) || raw.artifactType !== "app-route-inventory") throw new Error("Unsupported App inventory schema");
  const structured = raw.schemaVersion === 2;
  const pages = structured ? array(raw.pages).map(object) : [];
  const inputRows = structured ? [...pages.map(page => ({ ...page, kind: "page", parentRecordRoute: null, fills: "unassigned", contentRefs: "unassigned" })), ...array(raw.subrows).map(value => {
    const row = object(value), parent = pages.find(page => page.id === row.parentPageId);
    if (!parent || row.frame !== undefined || row.layoutConfig !== undefined || row.ownsFrame === true || row.ownsLayout === true) throw new Error("Subrow requires a page owner and cannot own Frame or Layout");
    return { ...row, kind: "detail-tab", lane: parent.lane, parentRecordRoute: row.parentPageId, frame: parent.frame, layoutConfig: parent.layoutConfig, fills: "unassigned", contentRefs: "unassigned" };
  })] : array(raw.routes);
  const routes = inputRows.map((value): AppRoute => {
    const r = object(value), states = object(r.declaredStates);
    const declaredStates = Object.fromEntries(APP_STATE_NAMES.map(name => {
      const state = object(states[name]);
      if (typeof state.declared !== "boolean" || (state.condition !== null && typeof state.condition !== "string")) throw new Error("Invalid state declaration");
      const applicability = state.applicability === undefined && !structured ? undefined : choice(state.applicability, ["required", "not-applicable", "undecided"]);
      const scopeKind = state.scopeKind === undefined && !structured ? undefined : choice(state.scopeKind, ["page", "panel", "none"]);
      if (state.declared && scopeKind === "none" || !state.declared && scopeKind !== undefined && scopeKind !== "none") throw new Error("State scope disagrees with declaration");
      return [name, { declared: state.declared, scope: string(state.scope), condition: state.condition, ...(applicability === undefined ? {} : { applicability }), ...(scopeKind === undefined ? {} : { scopeKind }) }];
    })) as AppRoute["declaredStates"];
    const path = string(r.path), transport = choice(r.transport, ["hash", "next"]);
    if (!path.startsWith("/") || path.startsWith("//") || (transport === "hash" && !path.startsWith("/#/"))) throw new Error("Expected origin-relative route identity");
    return { id: string(r.id), label: string(r.label), path, transport,
      kind: choice(r.kind, ["index", "details", "detail-tab", "native-page", "page"]), lane: choice(r.lane, APP_LANES),
      parentRecordRoute: r.parentRecordRoute === null ? null : string(r.parentRecordRoute),
      ...(r.parentSubrowId === undefined ? {} : { parentSubrowId: string(r.parentSubrowId) }),
      pathParameters: array(r.pathParameters).map(string), frame: string(r.frame), layoutConfig: string(r.layoutConfig),
      fills: choice(r.fills, ["unassigned"]), contentRefs: choice(r.contentRefs, ["unassigned"]), declaredStates };
  });
  if (new Set(routes.map(r => r.id)).size !== routes.length || new Set(routes.map(r => r.path)).size !== routes.length) throw new Error("Duplicate route identity");
  for (const route of routes) {
    const expectedLane = route.kind === "index" ? "Collection" : route.kind === "native-page" ? "Studio" : "Record";
    if (!structured && route.lane !== expectedLane) throw new Error("Route kind and lane disagree");
    if (route.kind === "detail-tab") {
      const parent = routes.find(r => r.id === route.parentRecordRoute);
      if (!parent || !["details", "page"].includes(parent.kind) || parent.lane !== route.lane) throw new Error("Detail tab requires its parent record route");
    } else if (route.parentRecordRoute !== null) throw new Error("Only detail tabs have a parent record route");
    if (route.parentSubrowId !== undefined) {
      const seen = new Set([route.id]);
      let ancestor: AppRoute | undefined = route;
      while (ancestor?.parentSubrowId !== undefined) {
        ancestor = routes.find(row => row.id === ancestor!.parentSubrowId);
        if (!ancestor || ancestor.kind !== "detail-tab" || ancestor.parentRecordRoute !== route.parentRecordRoute || seen.has(ancestor.id)) throw new Error("Invalid subrow ancestry");
        seen.add(ancestor.id);
      }
    }
  }
  const nonAddressableTabs = array(raw.nonAddressableTabs).map(value => {
    const r = object(value), hostRouteId = string(r.hostRouteId), tabIds = array(r.tabIds).map(string);
    if (r.routeIdentity !== null || !routes.some(route => route.id === hostRouteId && ["native-page", "page"].includes(route.kind)) || new Set(tabIds).size !== tabIds.length) throw new Error("Invalid local tab identity");
    return { hostRouteId, tabIds };
  });
  const decisions = array(structured ? raw.missingDecisions ?? [] : missingDecisions).map(value => {
    const decision = object(value);
    return { id: string(decision.id), label: string(decision.label), lane: choice(decision.lane, APP_LANES) };
  });
  if (new Set(decisions.map(decision => decision.id)).size !== decisions.length || decisions.some(decision => routes.some(route => route.id === decision.id))) throw new Error("Duplicate missing decision identity");
  return { source: { head: string(source.head), tree: string(source.tree) }, routes, nonAddressableTabs, missingDecisions: decisions };
}
export interface AppStageEvidence { readonly name: AppStage; readonly status: "pending" | "passed" | "failed" | "concept-only" | "unknown"; readonly reasons: readonly string[] }
/** Inventory is planning input, never an InstanceBinding or a static/rendered check result. */
export function deriveAppRouteStages(route: AppRoute, settings?: ProductionSettings, registries?: InstanceRegistries): readonly AppStageEvidence[] {
  return (route.kind === "detail-tab" ? APP_DETAIL_TAB_STAGES : APP_STAGES).map(name => ({ name, status: !settings ? "pending" : name === "Configure" ? "passed" : name === "Export" ? derivePublisherDeliveryState({ format: settings.format, deliveries: settings.deliveries ?? [] }, registries).export : name === "Deploy" ? "unknown" : "pending", reasons: name === "Configure" ? [settings ? "Production choices set; implementation and adoption are unverified" : "to do: apply production settings"] : !settings ? ["Waiting for parent Configure"] : name === "Frame" || name === "Layout" ? ["Planner default only; implementation and adoption proof pending"]
    : name === "Fills" ? [`Fills: ${route.fills}`] : name === "Content" ? [`ContentRefs: ${route.contentRefs}`]
    : name === "Checks" ? ["Static checks unavailable without an instance binding; LK12 rendered evidence pending"]
    : name === "States" ? ["LK14 instance validation pending; scoped source declarations only"] : ["Requires every stage to pass"] }));
}
