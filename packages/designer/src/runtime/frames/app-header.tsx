/**
 * frames.app-header runtime renderer: the real PageBar from JSON `info` (title and
 * labels), `trail` (breadcrumb) and `actions` content, the selected position/surface members,
 * the leased page-header title when one is supplied, and the host port (guarded navigation,
 * action commands, the `context` panel).
 */
import type { ReactNode } from "react";
import { PageBar, type PageBarAction, type PageBarCrumb, type PageBarProps } from "../../blocks/PageBar.js";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { runtimeValue, type SurfaceRendererEntry } from "../contract.js";
import { frameContent, guardedNavigate, type FrameInput, type FrameJson } from "./frame-content.js";

const read = frameContent("frames.app-header");

export function appHeaderProps(input: Pick<FrameInput, "content" | "selection" | "host" | "pageHeader">): PageBarProps {
  read.only(input, ["info", "trail", "actions"]);
  const host = input.host, info = read.record(runtimeValue(input, "info")) ?? read.fail("info content is required");
  const labels = read.record(info.labels) ?? read.fail("info.labels is required");
  const title = input.pageHeader?.data.title ?? read.required(info.title, "info.title");
  const breadcrumb: PageBarCrumb[] = read.records(runtimeValue(input, "trail")).map((crumb, index) => {
    const href = read.text(crumb.href);
    return { id: read.required(crumb.id, `trail[${index}].id`), label: read.required(crumb.label, `trail[${index}].label`), ...(href ? { href } : {}) };
  });
  const actions: PageBarAction[] = read.records(runtimeValue(input, "actions")).map((action, index) => ({
    id: read.required(action.id, `actions[${index}].id`), label: read.required(action.label, `actions[${index}].label`),
    ...(action.primary === true ? { primary: true } : {}), ...(action.isDisabled === true ? { isDisabled: true } : {}),
    ...read.destination(action, host, `actions[${index}]`),
  }) as PageBarAction);
  const description = read.text(info.description);
  const members = input.selection.members;
  const position = members.includes("position.static") ? "static" : members.includes("position.sticky") ? "sticky" : undefined;
  // Both surface.glass and fallback.opaque select the glass surface; the opaque fallback is automatic.
  const glass = members.includes("surface.glass") || members.includes("fallback.opaque");
  return {
    labels: { breadcrumb: read.required(labels.breadcrumb, "info.labels.breadcrumb"), collapsedBreadcrumb: read.required(labels.collapsedBreadcrumb, "info.labels.collapsedBreadcrumb"), pageInfo: read.required(labels.pageInfo, "info.labels.pageInfo"), pageActions: read.required(labels.pageActions, "info.labels.pageActions") },
    page: { title, ...(breadcrumb.length ? { breadcrumb } : {}), ...(description ? { description } : {}), ...(actions.length ? { actions } : {}) },
    ...(host?.panels?.context !== undefined ? { context: host.panels.context } : {}),
    ...(position ? { position } : {}), ...(glass ? { surface: "glass" as const } : {}),
    onNavigate: guardedNavigate(host),
  };
}

export function renderAppHeader(input: RuntimeRenderInput<ReactNode>): ReactNode {
  return <PageBar {...appHeaderProps(input)} />;
}

function sample(dataset: Parameters<SurfaceRendererEntry["sample"]>[0]): FrameJson {
  const [first, ...rest] = dataset.breadcrumbs.items, header = dataset.frames.appHeader;
  return {
    info: { title: rest.at(-1)?.label ?? dataset.card.title, description: dataset.card.content, labels: header.labels },
    trail: [first, ...rest.slice(0, -1)].filter(item => item !== undefined).map(item => ({ id: item.id, label: item.label, ...("href" in item ? { href: item.href } : {}) })),
    actions: [header.share, { id: "edit", label: dataset.text.action, action: "page.save", primary: true }],
  };
}

export const appHeaderRenderer: SurfaceRendererEntry = { leaf: "frames.app-header", render: renderAppHeader, sample };
