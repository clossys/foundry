"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { componentSpecimenPreview, type ComponentSpecimenMember } from "./component-specimens.js";
import { PreviewOutcomeContext, type PreviewFailureReason } from "./preview-outcome.js";
import { SpecimenLayoutSection, specimenComponent, type SpecimenAxis, type SpecimenItem, type SpecimenLeafDefinition, type SpecimenLeafProps } from "./specimen-layouts.js";
import type { DesignerSpecimenContext, DesignerSpecimenNeed } from "./DesignerSpecimen.js";

export interface ComponentVariantItem { readonly leaf: string; readonly members: readonly string[]; readonly state: string }
export interface SurfaceViewportItem { readonly leaf: string; readonly width: number; readonly state: string }
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
    const width = leaf.startsWith("frames.") ? 1280 : Number(axis.id), state = leaf.startsWith("frames.") ? axis.id : "default";
    return { id: `${leaf}/${axis.id}`, label: `${leaf} ${axis.label}`, coordinates: { surface: leaf, [axes[1]!.id]: axis.id }, value: { leaf, width, state } };
  }) };
}

function ComponentItem({ item, context, need }: { item: SpecimenItem; context: DesignerSpecimenContext; need: SpecimenLeafProps["need"] }): ReactNode {
  const [failed, report] = useState<PreviewFailureReason>();
  const value = item.value as ComponentVariantItem;
  if (!value || typeof value.leaf !== "string" || !Array.isArray(value.members) || typeof value.state !== "string") return need({ leaf: "sections.specimen-variant-matrix", reason: "Invalid component specimen data." });
  const preview = componentSpecimenPreview({ ...context.componentOptions, modules: context.modules });
  const result = preview.bind(value.leaf, context.profile);
  if ("refusal" in result) return need({ leaf: value.leaf, reason: result.refusal.detail });
  const bound = result.binding;
  const selectedMembers: ComponentSpecimenMember[] = [];
  for (const id of [...value.members, ...(value.state === "default" ? [] : [value.state])]) {
    const member = bound.members.find(member => member.member === id);
    if (!member || !member.drawn && !member.interaction) return need({ leaf: value.leaf, reason: `No executable registered member binding: ${id}` });
    selectedMembers.push(member);
  }
  const intrinsic = selectedMembers.find(member => member.interaction);
  const props = Object.assign({}, ...selectedMembers.filter(member => !member.interaction).map(member => member.props));
  const source = specimenComponent(context, "components.badge");
  if ("reason" in source) return need(source);
  const Badge = source.Component;
  if (intrinsic) {
    const forced = context.componentStates?.[value.leaf];
    const descriptor = context.profile.components.components[value.leaf]!;
    if (!forced || forced.descriptor !== descriptor) return need({ leaf: value.leaf, reason: `The selected native renderer has no forced-state clone port for ${intrinsic.member}.` });
    return <><Badge data-ds-leaf="components.badge">{bound.source}</Badge>{forced.render({ members: value.members, state: intrinsic.member, props, interactive: false })}</>;
  }
  const node = componentSpecimenPreview({ ...context.componentOptions, restOnly: true, modules: context.modules, probes: { [value.leaf]: { props } } }).preview(value.leaf, context.profile);
  const semantic = specimenComponent(context, "components.semantic-content");
  if ("reason" in semantic) return need(semantic);
  const Content = semantic.Component;
  return <PreviewOutcomeContext.Provider value={report}><Badge data-ds-leaf="components.badge">{bound.source}</Badge>{failed ? <Content as="div" data-ds-specimen-need="true">{need({ leaf: value.leaf, reason: failed })}</Content> : null}<Content as="div" data-specimen-state={value.state} inert={value.state === "default" ? undefined : true}>{node}</Content></PreviewOutcomeContext.Provider>;
}

function SurfaceItem({ item, context, need, expanded }: { item: SpecimenItem; context: DesignerSpecimenContext; need: SpecimenLeafProps["need"]; expanded?: boolean }): ReactNode {
  const value = item.value as SurfaceViewportItem;
  if (!value || typeof value.leaf !== "string" || !Number.isFinite(value.width) || value.width < 1 || typeof value.state !== "string") return need({ leaf: "sections.specimen-section-viewports", reason: "Invalid surface viewport data." });
  const selected = context.profile.surfaces?.fills[value.leaf as `sections.${string}` | `frames.${string}`], surface = context.surfaces?.[value.leaf];
  if (!selected || !surface || surface.descriptorHash !== selected.descriptorHash) return need({ leaf: value.leaf, reason: "The selected surface has no matching executable fixture binding." });
  if (value.state !== "default" && !surface.states?.includes(value.state)) return need({ leaf: value.leaf, reason: `No registered fixture for panel state ${value.state}.` });
  return <NativeSpecimenViewport context={context} leaf={value.leaf} width={value.width} expanded={expanded} need={need}>{surface.render({ width: value.width, state: value.state })}</NativeSpecimenViewport>;
}

/** An isolated responsive viewport. Frame scaling is the one permitted horizontal-scroll exception. */
export function NativeSpecimenViewport({ context, leaf, width, expanded, need, children }: { context: DesignerSpecimenContext; leaf: string; width: number; expanded?: boolean; need: SpecimenLeafProps["need"]; children: ReactNode }): ReactNode {
  const [body, setBody] = useState<HTMLElement>();
  const semantic = specimenComponent(context, "components.semantic-content");
  if ("reason" in semantic) return need(semantic);
  const Content = semantic.Component;
  const load = (frame: HTMLIFrameElement) => {
    const document = frame.contentDocument; if (!document) return;
    document.head.replaceChildren(...Array.from(frame.ownerDocument.querySelectorAll('style,link[rel="stylesheet"]'), node => node.cloneNode(true)));
    for (const attr of Array.from(frame.ownerDocument.documentElement.attributes)) document.documentElement.setAttribute(attr.name, attr.value);
    document.body.className = frame.ownerDocument.body.className; document.body.style.margin = "0";
    setBody(document.body);
  };
  return <Content as="div" data-specimen-viewport={width} className={leaf.startsWith("frames.") ? "max-w-full overflow-auto" : "max-w-full overflow-hidden"}>
    <Content as="div" style={{ inlineSize: width, zoom: expanded ? 1 : width > 375 ? 0.25 : 0.5 }}>
      <iframe title={`${leaf} ${width}px specimen`} width={width} height={720} sandbox="allow-same-origin" tabIndex={-1} srcDoc="<!doctype html><html><head></head><body></body></html>" onLoad={event => load(event.currentTarget)} style={{ border: 0, display: "block", pointerEvents: "none" }} />
      {body ? createPortal(<Content as="div" inert data-ds-leaf="components.semantic-content" data-designer-specimen-frame={leaf}>{children}</Content>, body) : null}
    </Content>
  </Content>;
}

export function SpecimenVariantMatrix(props: SpecimenLeafProps): ReactNode { return <SpecimenLayoutSection {...props} id="sections.specimen-variant-matrix" label="Component variants and states" layout="matrix" renderItem={item => <ComponentItem item={item} context={props.context} need={props.need} />} />; }
export function SpecimenSectionViewports(props: SpecimenLeafProps): ReactNode { return <SpecimenLayoutSection {...props} id="sections.specimen-section-viewports" label="Section viewports" layout="matrix" renderItem={item => <SurfaceItem item={item} context={props.context} need={props.need} expanded={props.expanded} />} />; }
export function SpecimenFrameViewports(props: SpecimenLeafProps): ReactNode { return <SpecimenLayoutSection {...props} id="sections.specimen-frame-viewports" label="Frame panel states" layout="matrix" renderItem={item => <SurfaceItem item={item} context={props.context} need={props.need} expanded={props.expanded} />} />; }

export const designerViewportSpecimenLeaves: readonly SpecimenLeafDefinition[] = [
  { id: "sections.specimen-variant-matrix", layout: "matrix", compatible: [{ kind: "component", layer: "components" }], requirements: ["components.semantic-content", "components.badge", "components.grid-list", "components.table", "components.disclosure"], render: SpecimenVariantMatrix },
  { id: "sections.specimen-section-viewports", layout: "matrix", compatible: [{ kind: "section", layer: "sections" }], requirements: ["components.semantic-content", "components.grid-list", "components.table", "components.disclosure"], render: SpecimenSectionViewports },
  { id: "sections.specimen-frame-viewports", layout: "matrix", compatible: [{ kind: "frame", layer: "frames" }], requirements: ["components.semantic-content", "components.grid-list", "components.table", "components.disclosure"], render: SpecimenFrameViewports },
];
