import { PUBLISHER_MENU } from "../../planning/menu.js";
import type { MilestoneId, PublisherMenuItem } from "../../planning/menu.js";
import type { PublisherPlanDraft, PublisherPlanItem } from "../../planning/plan.js";
import type { PublisherPlanVersion } from "../../planning/change-set.js";
import type { RegisteredRouteRow, RouteRegistryProjection } from "../../core/route-registry.js";

import { PUBLISHER_CHANNELS } from "../../planning/channel-ids.js";
import type { PublisherChannelId } from "../../planning/channel-ids.js";
export { PUBLISHER_CHANNELS } from "../../planning/channel-ids.js";
export type { PublisherChannelId } from "../../planning/channel-ids.js";
/** Host-owned audience classification for routes without a registry projection. */
export type PublisherRouteChannels = Readonly<Record<string, "app" | "admin">>;
export interface PublisherChannelItem {
  readonly item: PublisherPlanItem;
  readonly menu: PublisherMenuItem;
  readonly milestone: MilestoneId;
  readonly packId: string;
  readonly channel: PublisherChannelId;
  readonly route?: RegisteredRouteRow;
  readonly facets: readonly "commerce"[];
}
export interface PublisherChannel {
  readonly id: PublisherChannelId;
  readonly label: string;
  readonly items: readonly PublisherChannelItem[];
}
/** Presentation projection only. It neither migrates plans nor acknowledges production. */
export function publisherItemChannel(item: PublisherPlanItem, routeChannels: PublisherRouteChannels = {}, registeredRoutes?: RouteRegistryProjection): PublisherChannelId | undefined {
  const menu = PUBLISHER_MENU.find(entry => entry.id === item.menuRef);
  if (!menu || menu.kind === "asset") return undefined;
  if (item.appRouteId && registeredRoutes) {
    const matches = registeredRoutes.rows.filter(row => row.registration.routeId === item.appRouteId && row.registration.planItemId === item.id && row.item === item);
    return matches.length === 1 && !matches[0]!.findings.length && !registeredRoutes.findings.some(finding => !finding.routeId) ? matches[0]!.registration.channel : undefined;
  }
  if (item.appRouteId && routeChannels[item.appRouteId]) return routeChannels[item.appRouteId];
  if (item.frame?.leaf === "frames.admin-shell") return "admin";
  if (menu.id === "app.ops" || menu.id === "customer.auth" || menu.id === "customer.portal") return "app";
  if (menu.id === "proof.cases" || menu.id === "proof.help") return "content";
  const configured = item.configuration;
  const recommended = menu.recommendations.find(entry => entry.lane === item.lane)?.configuration;
  const format = (configured && "format" in configured ? configured.format : undefined) ?? item.format ?? (recommended && "format" in recommended ? recommended.format : undefined);
  if (format === "email.html") return "messages";
  if (format && !format.startsWith("web.")) return "documents";
  return "site";
}
export function projectPublisherChannels(plan?: PublisherPlanDraft | PublisherPlanVersion, routeChannels: PublisherRouteChannels = {}, registeredRoutes?: RouteRegistryProjection): readonly PublisherChannel[] {
  const rows: PublisherChannelItem[] = [];
  for (const milestone of plan?.milestones ?? []) for (const pack of milestone.packs) for (const item of pack.items) {
    const menu = PUBLISHER_MENU.find(entry => entry.id === item.menuRef);
    const channel = publisherItemChannel(item, routeChannels, registeredRoutes);
    const route = registeredRoutes?.rows.find(row => row.item === item);
    if (menu && channel) rows.push({ item, menu, ...(route ? { route } : {}), milestone: milestone.id, packId: pack.id, channel, facets: menu.pack === "pack.customer" || item.lane === "Commerce" ? ["commerce"] : [] });
  }
  return PUBLISHER_CHANNELS.flatMap(channel => {
    const items = rows.filter(row => row.channel === channel.id);
    return items.length ? [{ ...channel, items }] : [];
  });
}

/** Only the page's own closed fragment is consumed; all other hrefs stay host navigation. */
export function publisherChannelFromHref(href: string): PublisherChannelId | undefined {
  const match = /^#publisher-channel=([a-z]+)$/.exec(href);
  return PUBLISHER_CHANNELS.find(channel => channel.id === match?.[1])?.id;
}

import type { PublisherPipelineItem, PublishStageStatus } from "./pipeline.js";
import { PUBLISH_STAGES } from "./pipeline.js";
import type { AppPipelineItem } from "./app/pipeline.js";
import { APP_STAGES } from "./app/inventory.js";

/** Presentation evidence only: these rows never acknowledge production or qualify a route. */
export interface PublisherProcessStage {
  readonly name: typeof APP_STAGES[number];
  readonly status: PublishStageStatus;
  readonly reasons: readonly string[];
}
export interface PublisherProcessItem {
  readonly id: string;
  readonly row: PublisherChannelItem;
  readonly label: string;
  readonly path?: string;
  readonly parentId?: string;
  readonly parentSubrowId?: string;
  readonly frame?: string;
  readonly layout?: string;
  readonly web?: PublisherPipelineItem;
  readonly app?: AppPipelineItem;
  readonly configured: boolean;
  readonly state: PublisherPipelineItem["state"] | "proposed" | "planned";
  readonly stages: readonly PublisherProcessStage[];
  readonly column: typeof APP_STAGES[number];
  readonly findingCount: number;
}
export interface PublisherProcessLane {
  readonly id: string;
  readonly items: readonly PublisherProcessItem[];
  readonly readyCount: number;
}
/** The mounted view and registered Section projector share one lane/stage projection. */
export function projectPublisherChannelProcess(rows: readonly PublisherChannelItem[], input: {
  readonly aligned: boolean;
  readonly webItems: readonly PublisherPipelineItem[];
  readonly appItems: readonly AppPipelineItem[];
}): { readonly stages: readonly typeof APP_STAGES[number][]; readonly lanes: readonly PublisherProcessLane[] } {
  const items: PublisherProcessItem[] = [];
  for (const row of rows) {
    // A registry display row must never borrow legacy inventory execution or identity.
    const web = row.route ? undefined : input.webItems.find(item => item.binding.instanceId === row.item.instanceId);
    const app = row.route ? undefined : input.appItems.find(item => item.route.id === row.item.appRouteId);
    const children = app && app.route.kind !== "detail-tab" ? input.appItems.filter(item => item.route.parentRecordRoute === app.route.id) : [];
    for (const entry of [app, ...children]) {
      const child = entry !== app;
      const configured = input.aligned && !!(entry?.configured ?? web?.configured);
      const stageNames = row.item.appRouteId ? APP_STAGES : PUBLISH_STAGES;
      const stages: readonly PublisherProcessStage[] = row.route ? stageNames.map(name => ({ name, status: "pending", reasons: row.route!.pending })) : entry ? entry.stages.map(stage => ({ ...stage, status: configured ? stage.status : "pending", reasons: configured ? stage.reasons : ["Waiting for parent Configure"] })) : web ? web.stages.map(stage => ({ name: stage.name, status: configured ? stage.status : "pending", reasons: configured ? [...stage.findings.map(finding => `${finding.code} ${finding.path}: ${finding.message}`), ...stage.pending] : ["Waiting for Configure"] })) : stageNames.map(name => ({ name, status: "pending", reasons: [row.menu.status === "concept-only" ? "Concept only · renderer unavailable" : "Adopted source binding unavailable"] }));
      const state = !input.aligned ? "proposed" : row.route ? "needs input" : row.channel === "admin" ? "needs input" : entry?.state ?? web?.state ?? (row.menu.status === "concept-only" ? "planned" : "needs input");
      const binding = row.route?.registration.composition.binding ?? entry?.pipeline?.binding ?? web?.binding;
      const column = !configured ? "Configure" : stages.find(stage => !["Ready", "Export", "Deploy"].includes(stage.name) && stage.status !== "passed")?.name ?? "Ready";
      items.push({ id: child ? `${row.item.id}/route/${entry!.route.id}` : row.item.id, row,
        label: row.route?.registration.title ?? entry?.route.label ?? web?.binding.label ?? row.menu.label,
        path: row.route?.registration.path ?? entry?.route.path ?? web?.binding.path,
        ...(child ? { parentId: row.item.id, ...(entry!.route.parentSubrowId ? { parentSubrowId: `${row.item.id}/route/${entry!.route.parentSubrowId}` } : {}) } : {}),
        frame: child ? undefined : binding ? `${binding.frame.leaf}${binding.frame.config ? ` · ${binding.frame.config}` : ""}` : entry?.route.frame,
        layout: child ? undefined : binding?.layout ? `${binding.layout.leaf} · ${binding.layout.config}` : entry?.route.layoutConfig,
        web, app: entry, configured, state, stages, column, findingCount: row.route?.findings.length ?? entry?.findings.length ?? web?.findings.length ?? 0 });
    }
  }
  const order = items.some(item => item.stages.some(stage => stage.name === "States")) ? APP_STAGES : PUBLISH_STAGES;
  return { stages: order, lanes: [...new Set(rows.map(row => row.item.lane))].map(id => {
    const members = items.filter(item => item.row.item.lane === id);
    return { id, items: members, readyCount: members.filter(item => !item.parentId && item.state === "ready").length };
  }) };
}
