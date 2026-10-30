"use client";

import type { ReactNode } from "react";
import type { RichTextValue } from "../components/RichText.js";
import { richTextDocument } from "../components/rich-text/schema.js";
import type { DesignerSpecimenNeed } from "./DesignerSpecimen.js";
import type { ComponentSpecimenBinding, ComponentSpecimenComponent } from "./component-specimens.js";
import { SpecimenLayoutSection, specimenComponent, specimenPart, specimenLayoutNeeds, type SpecimenAxis, type SpecimenItem, type SpecimenLeafDefinition, type SpecimenLeafProps } from "./specimen-layouts.js";

export interface RichPassageValue {
  readonly passage: RichTextValue;
  /** The complete passage remains in the native disclosure; full tabs expand it. */
  readonly clamp?: { readonly lines: 12; readonly showMore: string };
}
export type CopyInContextValue = {
  readonly role: "headline" | "cta" | "nav" | "error" | "empty";
  readonly text: string;
  readonly context: string;
  readonly locale: string;
  readonly dir: "ltr" | "rtl" | "auto";
} | {
  readonly role: "body";
  readonly passage: RichTextValue;
  readonly context: string;
  readonly locale: string;
  readonly dir: "ltr" | "rtl" | "auto";
};
export interface PageViewportValue {
  readonly pageId: string;
  readonly viewport: { readonly id: string; readonly label: string; readonly width: number; readonly height: number };
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const renderable = (value: unknown): value is ComponentSpecimenComponent => typeof value === "function" || typeof value === "object" && value !== null && "$$typeof" in value;
function loopbackOrigin(value: string): boolean {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(value)) return false;
  try { return new URL(value).origin === value; } catch { return false; }
}
/** Navigation exposes real named exports, rather than the GridList compound API. */
function navigationParts(binding: ComponentSpecimenBinding) {
  const item = binding.exports[binding.source === "shadcn@aria" ? "TreeItem" : "NavigationTreeItem"];
  const content = binding.exports[binding.source === "shadcn@aria" ? "TreeItemContent" : "NavigationTreeItemContent"];
  return renderable(item) && renderable(content) ? { Item: item, ItemContent: content } : undefined;
}
const passage = (value: unknown): value is RichTextValue => {
  if (!text(value) && !(object(value) && value.type === "doc" && Array.isArray(value.content) && value.content.length > 0)) return false;
  try { return Boolean(richTextDocument(value)); } catch { return false; }
};
export const isRichPassageValue = (value: unknown): value is RichPassageValue => object(value) && passage(value.passage) && (value.clamp === undefined || object(value.clamp) && value.clamp.lines === 12 && text(value.clamp.showMore));
export const isCopyInContextValue = (value: unknown): value is CopyInContextValue => object(value) && text(value.context) && text(value.locale) && ["ltr", "rtl", "auto"].includes(String(value.dir)) && (value.role === "body" ? passage(value.passage) : ["headline", "cta", "nav", "error", "empty"].includes(String(value.role)) && text(value.text));
export const isPageViewportValue = (value: unknown): value is PageViewportValue => object(value) && text(value.pageId) && object(value.viewport) && text(value.viewport.id) && text(value.viewport.label) && typeof value.viewport.width === "number" && Number.isInteger(value.viewport.width) && value.viewport.width > 0 && typeof value.viewport.height === "number" && Number.isInteger(value.viewport.height) && value.viewport.height > 0;

/** Builders preserve caller-owned identities, full content, labels and coordinates. */
export const richPassageItems = (items: readonly SpecimenItem<RichPassageValue>[]): readonly SpecimenItem<RichPassageValue>[] => items;
export const copyInContextItems = (items: readonly SpecimenItem<CopyInContextValue>[]): readonly SpecimenItem<CopyInContextValue>[] => items;
export const pageViewportItems = (items: readonly SpecimenItem<PageViewportValue>[]): readonly SpecimenItem<PageViewportValue>[] => items;
/** One emitted page becomes the caller's viewport cases, with no Studio layout work. */
export function pageViewportCases(page: { readonly id: string; readonly label: string }, viewports: readonly PageViewportValue["viewport"][], labels: { readonly page: string; readonly viewport: string }): { readonly items: readonly SpecimenItem<PageViewportValue>[]; readonly axes: readonly SpecimenAxis[] } {
  return {
    axes: [{ id: "page", label: labels.page, values: [{ id: page.id, label: page.label }] }, { id: "viewport", label: labels.viewport, values: viewports.map(viewport => ({ id: viewport.id, label: viewport.label })) }],
    items: viewports.map(viewport => ({ id: `${page.id}/${viewport.id}`, label: viewport.label, value: { pageId: page.id, viewport }, coordinates: { page: page.id, viewport: viewport.id } })),
  };
}

function failure(props: SpecimenLeafProps, id: string, reason: string): ReactNode {
  const semantic = specimenComponent(props.context, "components.semantic-content");
  if ("reason" in semantic) return props.need(semantic);
  const Content = semantic.Component;
  return <Content as="div" data-ds-leaf={id} data-ds-specimen-need="true">{props.need({ leaf: id, reason })}</Content>;
}
function componentNeeds(props: SpecimenLeafProps, ids: readonly string[]): DesignerSpecimenNeed[] {
  return ids.flatMap(id => { const result = specimenComponent(props.context, id); return "reason" in result ? [result] : []; });
}
function surfaceNeed(props: SpecimenLeafProps, leaf: "sections.section-header" | "sections.empty-state"): DesignerSpecimenNeed[] {
  const selected = props.context.profile.surfaces?.fills[leaf], bound = props.context.surfaces?.[leaf];
  return selected && bound?.descriptorHash === selected.descriptorHash && bound.renderContent ? [] : [{ leaf, reason: "The selected surface has no descriptor-matched native content renderer." }];
}
export function contentSpecimenNeeds(id: string, props: SpecimenLeafProps): readonly DesignerSpecimenNeed[] {
  const needs = componentNeeds(props, ["components.semantic-content"]);
  const definition = contentSpecimenLeaves.find(leaf => leaf.id === id);
  if (definition) needs.push(...specimenLayoutNeeds({ ...props, id: definition.id, layout: definition.layout }));
  if (!props.items.length) needs.push({ leaf: id, reason: "A specimen requires at least one cell-authored item." });
  for (const item of props.items) {
    if (!text(item.id) || !text(item.label)) needs.push({ leaf: id, reason: "Every content item requires its caller-owned id and label." });
    if (id === "sections.specimen-rich-passage") {
      if (!isRichPassageValue(item.value)) needs.push({ leaf: id, reason: `Full passage data is unavailable: ${item.id}` });
      else {
        needs.push(...componentNeeds(props, ["components.rich-text", ...(item.value.clamp && !props.expanded ? ["components.disclosure"] : [])]));
        if (item.value.clamp && !props.expanded) {
          const disclosure = specimenComponent(props.context, "components.disclosure");
          if (!("reason" in disclosure) && disclosure.source === "shadcn@aria" && (!specimenPart(disclosure, "Item", "AccordionItem") || !specimenPart(disclosure, "Trigger", "AccordionTrigger") || !specimenPart(disclosure, "Panel", "AccordionContent"))) needs.push({ leaf: id, reason: "The selected disclosure has no native item, trigger and content parts." });
        }
      }
    } else if (id === "sections.specimen-copy-in-context") {
      const value = item.value;
      if (!isCopyInContextValue(value)) { needs.push({ leaf: id, reason: `Produced copy and its native context role are unavailable: ${item.id}` }); continue; }
      if (value.role === "headline") needs.push(...surfaceNeed(props, "sections.section-header"));
      if (value.role === "error" || value.role === "empty") needs.push(...surfaceNeed(props, "sections.empty-state"));
      if (value.role === "body") needs.push(...componentNeeds(props, ["components.rich-text"]));
      if (value.role === "cta") needs.push(...componentNeeds(props, ["components.button"]));
      if (value.role === "nav") {
        const nav = specimenComponent(props.context, "components.navigation-tree");
        if ("reason" in nav) needs.push(nav);
        else if (!navigationParts(nav)) needs.push({ leaf: id, reason: "The selected navigation tree has no native item and content parts." });
      }
    } else if (id === "sections.specimen-page-viewports") {
      needs.push(...componentNeeds(props, ["components.badge"]));
      const value = item.value;
      if (!isPageViewportValue(value)) { needs.push({ leaf: id, reason: `Page viewport data is unavailable: ${item.id}` }); continue; }
      const port = props.context.pagePreview, page = port?.pages.find(page => page.id === value.pageId);
      if (!port || port.engine !== "producer-emitted-page@1" || !loopbackOrigin(port.origin) || !page?.emitted || !text(page.stage) || !/^\/(?!\/)/.test(page.route) || !/^\/preview\/[a-z][a-z0-9.-]*\/pages\/[a-z][a-z0-9.-]*\.html$/.test(page.previewUrl) || page.previewUrl.includes("..")) needs.push({ leaf: id, reason: `No live native emitted-page renderer is available: ${value.pageId}` });
    }
  }
  if (id === "sections.specimen-page-viewports" && new Set(props.items.flatMap(item => isPageViewportValue(item.value) ? [item.value.pageId] : [])).size > 1) needs.push({ leaf: id, reason: "A Publisher row must describe one emitted page at its viewport cases." });
  return needs;
}
function richNode(props: SpecimenLeafProps, value: RichPassageValue, label: string): ReactNode {
  const rich = specimenComponent(props.context, "components.rich-text");
  if ("reason" in rich) return props.need(rich);
  const RichText = rich.Component, full = <RichText value={value.passage} readOnly aria-label={label} />;
  if (!value.clamp || props.expanded) return full;
  const semantic = specimenComponent(props.context, "components.semantic-content"), disclosure = specimenComponent(props.context, "components.disclosure");
  if ("reason" in semantic) return props.need(semantic);
  if ("reason" in disclosure) return props.need(disclosure);
  const Content = semantic.Component, Disclosure = disclosure.Component;
  const preview = <Content as="div" aria-hidden="true" style={{ display: "-webkit-box", WebkitLineClamp: 12, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{full}</Content>;
  if (disclosure.source === "shadcn@aria") {
    const Item = specimenPart(disclosure, "Item", "AccordionItem"), Trigger = specimenPart(disclosure, "Trigger", "AccordionTrigger"), Panel = specimenPart(disclosure, "Panel", "AccordionContent");
    if (!Item || !Trigger || !Panel) return failure(props, "sections.specimen-rich-passage", "The selected disclosure has no native item, trigger and content parts.");
    return <>{preview}<Disclosure><Item id={label}><Trigger>{value.clamp.showMore}</Trigger><Panel>{full}</Panel></Item></Disclosure></>;
  }
  return <>{preview}<Disclosure title={value.clamp.showMore}>{full}</Disclosure></>;
}
export function SpecimenRichPassage(props: SpecimenLeafProps): ReactNode {
  const id = "sections.specimen-rich-passage", needs = contentSpecimenNeeds(id, props);
  if (needs.length) return failure(props, id, needs.map(row => `${row.leaf}: ${row.reason}`).join("; "));
  return <SpecimenLayoutSection {...props} id={id} label={props.items[0]!.label} layout="ladder" renderItem={item => isRichPassageValue(item.value) ? richNode(props, item.value, item.label) : null} />;
}
function copyNode(props: SpecimenLeafProps, item: SpecimenItem, value: CopyInContextValue): ReactNode {
  const semantic = specimenComponent(props.context, "components.semantic-content");
  if ("reason" in semantic) return props.need(semantic);
  const Content = semantic.Component;
  let specimen: ReactNode;
  if (value.role === "body") specimen = richNode(props, { passage: value.passage }, item.label);
  else if (value.role === "headline" || value.role === "error" || value.role === "empty") {
    const slot = value.role === "headline" ? "sections.section-header" : "sections.empty-state";
    specimen = props.context.surfaces![slot]!.renderContent!({ title: value.text, ...(value.role === "headline" ? { level: 3 } : value.role === "error" ? { role: "alert" } : {}) });
  } else {
    const selected = specimenComponent(props.context, value.role === "cta" ? "components.button" : "components.navigation-tree");
    if ("reason" in selected) return props.need(selected);
    const Root = selected.Component;
    if (value.role === "cta") specimen = <Root>{value.text}</Root>;
    else {
      const parts = navigationParts(selected);
      if (!parts) return failure(props, "sections.specimen-copy-in-context", "Native navigation parts are unavailable.");
      const { Item, ItemContent } = parts;
      specimen = <Root data-ds-leaf="components.navigation-tree" aria-label={value.context}><Item id={item.id} textValue={value.text}><ItemContent>{value.text}</ItemContent></Item></Root>;
    }
  }
  return <Content as="div" lang={value.locale} dir={value.dir} data-copy-role={value.role} data-copy-context={value.context}>{specimen}</Content>;
}
export function SpecimenCopyInContext(props: SpecimenLeafProps): ReactNode {
  const id = "sections.specimen-copy-in-context", needs = contentSpecimenNeeds(id, props);
  if (needs.length) return failure(props, id, needs.map(row => `${row.leaf}: ${row.reason}`).join("; "));
  return <SpecimenLayoutSection {...props} id={id} label={props.items[0]!.label} layout="matrix" renderItem={item => isCopyInContextValue(item.value) ? copyNode(props, item, item.value) : null} />;
}
export function SpecimenPageViewports(props: SpecimenLeafProps): ReactNode {
  const id = "sections.specimen-page-viewports", needs = contentSpecimenNeeds(id, props);
  if (needs.length) return failure(props, id, needs.map(row => `${row.leaf}: ${row.reason}`).join("; "));
  return <SpecimenLayoutSection {...props} id={id} label={props.items[0]!.label} layout="matrix" renderItem={item => {
    if (!isPageViewportValue(item.value)) return null;
    const value = item.value, port = props.context.pagePreview!, page = port.pages.find(page => page.id === value.pageId)!;
    const semantic = specimenComponent(props.context, "components.semantic-content"), badge = specimenComponent(props.context, "components.badge");
    if ("reason" in semantic) return props.need(semantic);
    if ("reason" in badge) return props.need(badge);
    const Content = semantic.Component, Badge = badge.Component;
    return <Content as="section" data-publication-route={page.route} data-publication-stage={page.stage}><Content as="p">{page.route}</Content><Badge>{page.stage}</Badge>{port.renderViewport({ page, viewport: value.viewport, interactive: false, fullSize: props.expanded === true })}</Content>;
  }} />;
}
export const contentSpecimenLeaves: readonly SpecimenLeafDefinition[] = [
  { id: "sections.specimen-rich-passage", layout: "ladder", compatible: [{ kind: "passage" }], requirements: ["components.rich-text"], validate: props => contentSpecimenNeeds("sections.specimen-rich-passage", props), render: SpecimenRichPassage },
  { id: "sections.specimen-copy-in-context", layout: "matrix", compatible: [{ kind: "copy" }], requirements: ["components.rich-text", "components.button", "components.navigation-tree", "sections.section-header", "sections.empty-state"], validate: props => contentSpecimenNeeds("sections.specimen-copy-in-context", props), render: SpecimenCopyInContext },
  { id: "sections.specimen-page-viewports", layout: "matrix", compatible: [{ kind: "page" }], requirements: ["components.badge", "producer-emitted-page@1"], validate: props => contentSpecimenNeeds("sections.specimen-page-viewports", props), render: SpecimenPageViewports },
];
