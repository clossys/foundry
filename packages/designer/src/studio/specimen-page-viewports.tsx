"use client";

import { useState, type ReactNode } from "react";
import type { SpecimenUnpublishedPage } from "./specimen-content-ports.js";
import type { DesignerSpecimenNeed } from "./DesignerSpecimen.js";
import { SpecimenLayoutSection, specimenComponent, specimenLayoutNeeds, type SpecimenAxis, type SpecimenItem, type SpecimenLeafDefinition, type SpecimenLeafProps } from "./specimen-layouts.js";

export interface PageViewportValue {
  readonly publication?: "published";
  readonly pageId: string;
  readonly viewport: { readonly id: string; readonly label: string; readonly width: number; readonly height: number };
}
/** Explicit item state; an emitted:false legacy page is never sufficient. */
export interface UnpublishedPageViewportValue extends Omit<PageViewportValue, "publication"> {
  readonly publication: "unpublished";
}
export type SpecimenPageViewportValue = PageViewportValue | UnpublishedPageViewportValue;
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function loopbackOrigin(value: string): boolean {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(value)) return false;
  try { return new URL(value).origin === value; } catch { return false; }
}
export const isPageViewportValue = (value: unknown): value is SpecimenPageViewportValue => object(value) && (value.publication === undefined || value.publication === "published" || value.publication === "unpublished") && text(value.pageId) && object(value.viewport) && text(value.viewport.id) && text(value.viewport.label) && typeof value.viewport.width === "number" && Number.isInteger(value.viewport.width) && value.viewport.width > 0 && typeof value.viewport.height === "number" && Number.isInteger(value.viewport.height) && value.viewport.height > 0;

export const isUnpublishedPageViewportValue = (value: unknown): value is UnpublishedPageViewportValue => isPageViewportValue(value) && "publication" in value && value.publication === "unpublished";
export const isSpecimenUnpublishedPage = (value: unknown): value is SpecimenUnpublishedPage => object(value) && value.publication === "unpublished" && value.emitted === false && text(value.id) && text(value.route) && /^\/(?!\/)/.test(value.route) && object(value.emptyState) && [value.emptyState.title, value.emptyState.description, value.emptyState.command, value.emptyState.context].every(text);

export const pageViewportItems = (items: readonly SpecimenItem<SpecimenPageViewportValue>[]): readonly SpecimenItem<SpecimenPageViewportValue>[] => items;
/** One emitted page becomes the caller's viewport cases, with no Studio layout work. */
export function pageViewportCases(page: { readonly id: string; readonly label: string }, viewports: readonly PageViewportValue["viewport"][], labels: { readonly page: string; readonly viewport: string }): { readonly items: readonly SpecimenItem<PageViewportValue>[]; readonly axes: readonly SpecimenAxis[] } {
  return {
    axes: [{ id: "page", label: labels.page, values: [{ id: page.id, label: page.label }] }, { id: "viewport", label: labels.viewport, values: viewports.map(viewport => ({ id: viewport.id, label: viewport.label })) }],
    items: viewports.map(viewport => ({ id: `${page.id}/${viewport.id}`, label: viewport.label, value: { pageId: page.id, viewport }, coordinates: { page: page.id, viewport: viewport.id } })),
  };
}

/** Transport confirmed unpublished pages through the same intrinsic viewport layout. */
export function unpublishedPageViewportCases(page: { readonly id: string; readonly label: string }, viewports: readonly PageViewportValue["viewport"][], labels: { readonly page: string; readonly viewport: string }): { readonly items: readonly SpecimenItem<UnpublishedPageViewportValue>[]; readonly axes: readonly SpecimenAxis[] } {
  const cases = pageViewportCases(page, viewports, labels);
  return { axes: cases.axes, items: cases.items.map(item => ({ ...item, value: { ...item.value, publication: "unpublished" } })) };
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
function surfaceNeed(props: SpecimenLeafProps, leaf: "sections.empty-state"): DesignerSpecimenNeed[] {
  const selected = props.context.profile.surfaces?.fills[leaf], bound = props.context.surfaces?.[leaf];
  return selected && bound?.descriptorHash === selected.descriptorHash && bound.renderContent ? [] : [{ leaf, reason: "The selected surface has no descriptor-matched native content renderer." }];
}
function deviceViewportCases(items: readonly SpecimenItem[]): boolean {
  const ids = items.flatMap(item => isPageViewportValue(item.value) ? [item.value.viewport.id] : []);
  return items.length > 1 && items.length <= 3 && ids.length === items.length
    && new Set(ids).size === ids.length && ids.every(id => ["desktop", "tablet", "mobile"].includes(id));
}
/** Publisher-only validation: no Writer passages, schemas or editor dependencies. */
export function pageViewportSpecimenNeeds(props: SpecimenLeafProps): readonly DesignerSpecimenNeed[] {
  const id = "sections.specimen-page-viewports";
  const needs = componentNeeds(props, ["components.semantic-content"]);
  needs.push(...specimenLayoutNeeds({ ...props, id, layout: "matrix" }));
  if (!props.items.length) needs.push({ leaf: id, reason: "A specimen requires at least one cell-authored item." });
  for (const item of props.items) {
    if (!text(item.id) || !text(item.label)) needs.push({ leaf: id, reason: "Every content item requires its caller-owned id and label." });
    needs.push(...componentNeeds(props, ["components.badge"]));
    const value = item.value;
    if (!isPageViewportValue(value)) { needs.push({ leaf: id, reason: `Page viewport data is unavailable: ${item.id}` }); continue; }
    const port = props.context.pagePreview, page = port?.pages.find(page => page.id === value.pageId);
    if (isUnpublishedPageViewportValue(value)) {
      if (!port || port.engine !== "producer-emitted-page@1" || !loopbackOrigin(port.origin) || !isSpecimenUnpublishedPage(page)) needs.push({ leaf: id, reason: `No confirmed native unpublished page is available: ${value.pageId}` });
      needs.push(...surfaceNeed(props, "sections.empty-state"));
    } else if (!port || port.engine !== "producer-emitted-page@1" || !loopbackOrigin(port.origin) || !page || "publication" in page || !page.emitted || !text(page.stage) || !/^\/(?!\/)/.test(page.route) || !/^\/preview\/[a-z][a-z0-9.-]*\/pages\/[a-z][a-z0-9.-]*\.html$/.test(page.previewUrl) || page.previewUrl.includes("..")) needs.push({ leaf: id, reason: `No live native emitted-page renderer is available: ${value.pageId}` });
  }
  if (new Set(props.items.flatMap(item => isPageViewportValue(item.value) ? [item.value.pageId] : [])).size > 1) needs.push({ leaf: id, reason: "A Publisher row must describe one page at its viewport cases." });
  if (deviceViewportCases(props.items) && !props.items.every(item => isUnpublishedPageViewportValue(item.value))) needs.push(...componentNeeds(props, ["components.button"]));
  return needs;
}
function PageViewportPresentation(props: SpecimenLeafProps): ReactNode {
  const [selectedId, setSelectedId] = useState<string>();
  const id = "sections.specimen-page-viewports";
  const devices = deviceViewportCases(props.items);
  const selected = props.items.find(item => item.id === selectedId) ?? props.items[0]!;
  const renderItem = (item: SpecimenItem) => {
    if (!isPageViewportValue(item.value)) return null;
    const value = item.value, port = props.context.pagePreview!, page = port.pages.find(page => page.id === value.pageId)!;
    const semantic = specimenComponent(props.context, "components.semantic-content"), badge = specimenComponent(props.context, "components.badge");
    if ("reason" in semantic) return props.need(semantic);
    if ("reason" in badge) return props.need(badge);
    const Content = semantic.Component, Badge = badge.Component;
    if (isUnpublishedPageViewportValue(value) && isSpecimenUnpublishedPage(page)) {
      const empty = page.emptyState;
      return <Content as="section" data-publication-route={page.route} data-publication-state="unpublished" data-publication-rendered="false" data-publication-context={empty.context}><Content as="p">{page.route}</Content>{props.context.surfaces!["sections.empty-state"]!.renderContent!({ title: empty.title, description: empty.description })}<Content as="p"><Content as="code">{empty.command}</Content></Content></Content>;
    }
    if ("publication" in page) return null;
    return <Content as="section" data-publication-route={page.route} data-publication-stage={page.stage}><Content as="p">{page.route}</Content><Badge>{page.stage}</Badge>{port.renderViewport({ page, viewport: value.viewport, interactive: false, fullSize: props.expanded === true })}</Content>;
  };
  if (!devices) return <SpecimenLayoutSection {...props} id={id} label={props.items[0]!.label} layout="matrix" renderItem={renderItem} />;
  const semantic = specimenComponent(props.context, "components.semantic-content");
  if ("reason" in semantic) return props.need(semantic);
  const Content = semantic.Component;
  const presentation = <SpecimenLayoutSection {...props} items={[selected]} axes={undefined} id={id} label={selected.label} layout="matrix" renderItem={renderItem} />;
  if (props.items.every(item => isUnpublishedPageViewportValue(item.value))) return presentation;
  const button = specimenComponent(props.context, "components.button");
  if ("reason" in button) return props.need(button);
  const Button = button.Component;
  return <Content as="section" data-ds-leaf={id}><Content as="div" role="group" aria-label={props.axes?.find(axis => axis.id === "viewport")?.label ?? selected.label}>{props.items.map(item => <Button key={item.id} aria-pressed={item.id === selected.id} onPress={() => setSelectedId(item.id)}>{isPageViewportValue(item.value) ? item.value.viewport.label : item.label}</Button>)}</Content>{presentation}</Content>;
}
export function SpecimenPageViewports(props: SpecimenLeafProps): ReactNode {
  const id = "sections.specimen-page-viewports", needs = pageViewportSpecimenNeeds(props);
  if (needs.length) return failure(props, id, needs.map(row => `${row.leaf}: ${row.reason}`).join("; "));
  return <PageViewportPresentation {...props} />;
}
export const pageViewportSpecimenLeaf: SpecimenLeafDefinition = {
  id: "sections.specimen-page-viewports", layout: "matrix", span: "full", compatible: [{ kind: "page" }],
  requirements: ["components.badge", "components.button", "producer-emitted-page@1"],
  validate: pageViewportSpecimenNeeds, render: SpecimenPageViewports,
};
