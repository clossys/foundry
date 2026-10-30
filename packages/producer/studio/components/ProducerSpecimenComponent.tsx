"use client";
import { useState, type ReactNode } from "react";
import { componentSpecimenPreview, PreviewOutcomeContext, type ComponentSpecimenMember, type ComponentVariantItem, type DesignerSpecimenContext, type SpecimenItem, type SpecimenLeafProps, type ComponentSpecimenBinding, type DesignerSpecimenNeed, type PreviewFailureReason } from "@clossys/designer/studio";
import { ProducerSpecimenStateClone, type SpecimenInteraction } from "./ProducerSpecimenStateClone";

function specimenComponent(context: DesignerSpecimenContext, leaf: string): ComponentSpecimenBinding | DesignerSpecimenNeed {
  const bound = componentSpecimenPreview({ modules: context.modules }).bind(leaf, context.profile);
  return "binding" in bound ? bound.binding : { leaf, reason: `${bound.refusal.code}: ${bound.refusal.detail}` };
}

/** The existing selected component probe and native interaction capture, hosted by Studio. */
export function ProducerSpecimenComponent({ item, context, need }: { item: SpecimenItem; context: DesignerSpecimenContext; need: SpecimenLeafProps["need"] }): ReactNode {
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
    if (!member || !member.interaction && !Object.keys(member.props).length) return need({ leaf: value.leaf, reason: `No executable registered member binding: ${id}` });
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
    if (forced?.descriptor === descriptor) return <><Badge data-ds-leaf="components.badge">{bound.source}</Badge>{forced.render({ members: value.members, state: intrinsic.member, props, interactive: false })}</>;
    const state = intrinsic.member.slice("state.".length);
    if (!["hover", "focus-visible", "pressed"].includes(state)) return need({ leaf: value.leaf, reason: `No native interaction capture for ${intrinsic.member}.` });
    const semantic = specimenComponent(context, "components.semantic-content");
    if ("reason" in semantic) return need(semantic);
    const node = componentSpecimenPreview({ ...context.componentOptions, restOnly: true, modules: context.modules, probes: { [value.leaf]: { props } } }).preview(value.leaf, context.profile);
    return <><Badge data-ds-leaf="components.badge">{bound.source}</Badge><ProducerSpecimenStateClone Content={semantic.Component} state={state as SpecimenInteraction} unavailable={reason => need({ leaf: value.leaf, reason })}>{node}</ProducerSpecimenStateClone></>;
  }
  const node = componentSpecimenPreview({ ...context.componentOptions, restOnly: true, modules: context.modules, probes: { [value.leaf]: { props } } }).preview(value.leaf, context.profile);
  const semantic = specimenComponent(context, "components.semantic-content");
  if ("reason" in semantic) return need(semantic);
  const Content = semantic.Component;
  return <PreviewOutcomeContext.Provider value={report}><Badge data-ds-leaf="components.badge">{bound.source}</Badge>{failed ? <Content as="div" data-ds-specimen-need="true">{need({ leaf: value.leaf, reason: failed })}</Content> : null}<Content as="div" data-specimen-state={value.state} inert={value.state === "default" ? undefined : true}>{node}</Content></PreviewOutcomeContext.Provider>;
}
