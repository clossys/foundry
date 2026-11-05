"use client";

import type { ReactNode } from "react";
import { componentLeaf } from "../runtime/component-leaf.js";
import { componentSpecimenPreview, type ComponentSpecimenMember } from "./component-specimens.js";
import { SpecimenLayoutSection, specimenComponent, type SpecimenAxis, type SpecimenBreakpointReference, type SpecimenItem, type SpecimenLeafDefinition, type SpecimenLeafProps } from "./specimen-layouts.js";
import type { DesignerSpecimenContext } from "./DesignerSpecimen.js";

const Badge = componentLeaf<typeof import("../components/Badge.js").Badge>("components.badge");
const Content = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

export interface ComponentVariantItem { readonly leaf: string; readonly members: readonly string[]; readonly state: string }
export interface SurfaceViewportItem { readonly leaf: string; readonly width: number | SpecimenBreakpointReference; readonly state: string }
export interface SpecimenItemSet<Value = unknown> { readonly items: readonly SpecimenItem<Value>[]; readonly axes: readonly SpecimenAxis[] }

/** The exact resolved descriptor supplies every variant and state. Labels are never invented specimen rows. */
export function componentSpecimenItems(context: DesignerSpecimenContext, leaf: string): SpecimenItemSet<ComponentVariantItem> {
  const selected = context.profile.components.components[leaf];
  if (!selected) return { items: [], axes: [] };
  const groups = new Map<string, string[]>();
  for (const member of selected.descriptor.members) {
    const [axis, ...tail] = member.split(".");
    if (!axis || !tail.length || ["scope", "part", "anatomy"].includes(axis)) continue;
    const values = groups.get(axis) ?? []; values.push(member); groups.set(axis, values);
  }
  const variants = groups.get("variant") ?? [...groups].find(([axis]) => axis !== "state")?.[1] ?? [];
  const variantAxis = variants[0]?.split(".")[0];
  const stateValues = ["default", ...(groups.get("state") ?? [])];
  const axes: SpecimenAxis[] = [
    { id: "variant", label: "Variant", values: ["default", ...variants].map(id => ({ id, label: id === "default" ? "Default" : id.split(".").slice(1).join(".") })) },
    { id: "state", label: "State", values: stateValues.map(id => ({ id, label: id === "default" ? "Live" : id.slice("state.".length) })) },
    ...[...groups].filter(([axis]) => axis !== "state" && axis !== variantAxis).map(([id, members]) => ({ id, label: id, values: members.map(member => ({ id: member, label: member.slice(id.length + 1) })) })),
  ];
  let coordinates: Record<string, string>[] = [{}];
  for (const axis of axes) coordinates = coordinates.flatMap(previous => axis.values.map(value => ({ ...previous, [axis.id]: value.id })));
  return { axes, items: coordinates.map(coordinates => {
    const members = Object.values(coordinates).filter(value => value !== "default" && !value.startsWith("state."));
    const id = axes.map(axis => coordinates[axis.id]).join("/");
    return { id, label: id, coordinates, value: { leaf, members, state: coordinates.state! } };
  }) };
}

/** Viewport and panel-state axes use only selected source bindings, with a real default fixture first. */
export function surfaceSpecimenItems(context: DesignerSpecimenContext, leaf: string): SpecimenItemSet<SurfaceViewportItem> {
  const selected = context.profile.surfaces?.fills[leaf as `sections.${string}` | `frames.${string}`];
  if (!selected) return { items: [], axes: [] };
  const states = context.surfaces?.[leaf]?.states ?? ["default"];
  const axes: SpecimenAxis[] = [
    { id: "surface", label: "Surface", values: [{ id: leaf, label: leaf }] },
    { id: leaf.startsWith("frames.") ? "state" : "width", label: leaf.startsWith("frames.") ? "Panel state" : "Viewport", values: leaf.startsWith("frames.") ? states.map(id => ({ id, label: id })) : [{ id: "1280", label: "Desktop" }, { id: "375", label: "Mobile" }] },
  ];
  return { axes, items: axes[1]!.values.map(axis => {
    const width: SpecimenBreakpointReference = leaf.startsWith("frames.") || axis.id === "1280" ? "var(--breakpoint-desktop)" : "var(--breakpoint-mobile)", state = leaf.startsWith("frames.") ? axis.id : "default";
    return { id: `${leaf}/${axis.id}`, label: `${leaf} ${axis.label}`, coordinates: { surface: leaf, [axes[1]!.id]: axis.id }, value: { leaf, width, state } };
  }) };
}

function ComponentItem({ item, context, need, renderParts }: { item: SpecimenItem; context: DesignerSpecimenContext; need: SpecimenLeafProps["need"]; renderParts: SpecimenLeafProps["renderParts"] }): ReactNode {
  const value = item.value as ComponentVariantItem;
  if (!value || typeof value.leaf !== "string" || !Array.isArray(value.members) || typeof value.state !== "string") return need({ leaf: "sections.specimen-variant-matrix", reason: "Invalid component specimen data." });
  const preview = componentSpecimenPreview({ ...context.componentOptions, modules: context.modules });
  const result = preview.bind(value.leaf, context.profile);
  if ("refusal" in result) return need({ leaf: value.leaf, reason: result.refusal.detail });
  const bound = result.binding;
  const selectedMembers: ComponentSpecimenMember[] = [];
  for (const id of [...value.members, ...(value.state === "default" ? [] : [value.state])]) {
    const member = bound.members.find(member => member.member === id);
    if (!member || !member.interaction && !Object.keys(member.props).length) return need({ leaf: value.leaf, reason: `No executable registered member binding: ${id}` });
    selectedMembers.push(member);
  }
  const props = Object.assign({}, ...selectedMembers.filter(member => !member.interaction).map(member => member.props));
  const source = specimenComponent(context, "components.badge");
  if ("reason" in source) return need(source);
  const semantic = specimenComponent(context, "components.semantic-content");
  if ("reason" in semantic) return need(semantic);
  const renderComponentState = renderParts?.["sections.specimen-variant-matrix"]?.renderComponentState;
  if (!renderComponentState) return need({ leaf: value.leaf, reason: "The selected specimen section has no declared component-state render part." });
  return <><Badge data-ds-leaf="components.badge">{bound.source}</Badge>{renderComponentState({ Content, context, leaf: value.leaf, members: value.members, state: value.state, props, interactive: value.state === "default", unavailable: reason => need({ leaf: value.leaf, reason }) })}</>;

}

function SurfaceItem({ item, context, need, expanded, renderParts }: { item: SpecimenItem; context: DesignerSpecimenContext; need: SpecimenLeafProps["need"]; expanded?: boolean; renderParts: SpecimenLeafProps["renderParts"] }): ReactNode {
  const value = item.value as SurfaceViewportItem;
  const tokenWidths = new Set<string>(["var(--breakpoint-mobile)", "var(--breakpoint-desktop)"]);
  const validWidth = typeof value?.width === "number" ? Number.isFinite(value.width) && value.width > 0 : typeof value?.width === "string" && tokenWidths.has(value.width);
  if (!value || typeof value.leaf !== "string" || !validWidth || typeof value.state !== "string") return need({ leaf: "sections.specimen-section-viewports", reason: "Invalid surface viewport data." });
  const selected = context.profile.surfaces?.fills[value.leaf as `sections.${string}` | `frames.${string}`], surface = context.surfaces?.[value.leaf];
  if (!selected || !surface || surface.descriptorHash !== selected.descriptorHash) return need({ leaf: value.leaf, reason: "The selected surface has no matching executable fixture binding." });
  if (value.state !== "default" && !surface.states?.includes(value.state)) return need({ leaf: value.leaf, reason: `No registered fixture for panel state ${value.state}.` });
  const section = value.leaf.startsWith("frames.") ? "sections.specimen-frame-viewports" : "sections.specimen-section-viewports";
  const parts = renderParts?.[section];
  if (!parts?.renderSurface || !parts.renderViewport) return need({ leaf: value.leaf, reason: "The selected specimen section has no declared surface and viewport render parts." });
  return parts.renderViewport({ Content, leaf: value.leaf, width: value.width, expanded, need, children: width => parts.renderSurface!({ leaf: value.leaf, width, state: value.state }) });
}

export function SpecimenVariantMatrix(props: SpecimenLeafProps): ReactNode { return <SpecimenLayoutSection {...props} id="sections.specimen-variant-matrix" label="Component variants and states" layout="matrix" renderItem={item => <ComponentItem item={item} context={props.context} need={props.need} renderParts={props.renderParts} />} />; }
export function SpecimenSectionViewports(props: SpecimenLeafProps): ReactNode { return <SpecimenLayoutSection {...props} id="sections.specimen-section-viewports" label="Section viewports" layout="matrix" renderItem={item => <SurfaceItem item={item} context={props.context} need={props.need} expanded={props.expanded} renderParts={props.renderParts} />} />; }
export function SpecimenFrameViewports(props: SpecimenLeafProps): ReactNode { return <SpecimenLayoutSection {...props} id="sections.specimen-frame-viewports" label="Frame panel states" layout="matrix" renderItem={item => <SurfaceItem item={item} context={props.context} need={props.need} expanded={props.expanded} renderParts={props.renderParts} />} />; }

export const designerViewportSpecimenLeaves: readonly SpecimenLeafDefinition[] = [
  { id: "sections.specimen-variant-matrix", layout: "matrix", span: "full", compatible: [{ kind: "component", layer: "components" }], requirements: ["components.semantic-content", "components.badge", "components.grid-list", "components.table", "components.disclosure"], render: SpecimenVariantMatrix },
  { id: "sections.specimen-section-viewports", layout: "matrix", span: "full", compatible: [{ kind: "section", layer: "sections" }], requirements: ["components.semantic-content", "components.grid-list", "components.table", "components.disclosure"], render: SpecimenSectionViewports },
  { id: "sections.specimen-frame-viewports", layout: "matrix", span: "full", compatible: [{ kind: "frame", layer: "frames" }], requirements: ["components.semantic-content", "components.grid-list", "components.table", "components.disclosure"], render: SpecimenFrameViewports },
];
