"use client";

import { useEffect, useState, type ReactNode } from "react";
import { TOKENS } from "../tokens/tokens.js";
import type { DesignerSpecimenContext, DesignerSpecimenNeed } from "./DesignerSpecimen.js";
import type { SpecimenPublishedPage } from "./specimen-content-ports.js";
import type { SpecimenTokenHostParts } from "./specimen-token-host-part-types.js";
import { componentSpecimenPreview, type ComponentSpecimenBinding, type ComponentSpecimenComponent } from "./component-specimens.js";
import { componentLeaf, type GridListLeaf } from "../runtime/component-leaf.js";

const Content = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const List = componentLeaf<GridListLeaf>("components.grid-list");
const ListItem = componentLeaf<typeof import("../components/GridList.js").GridList.Item>("components.grid-list", "Item");
const GridListItem = componentLeaf<ComponentSpecimenComponent>("components.grid-list", "GridListItem");
const Table = componentLeaf<typeof import("../components/Table.js").Table>("components.table");
const NativeTableHeader = componentLeaf<typeof import("../components/Table.js").Table.Header>("components.table", "Header");
const NativeTableColumn = componentLeaf<typeof import("../components/Table.js").Table.Column>("components.table", "Column");
const NativeTableBody = componentLeaf<typeof import("../components/Table.js").Table.Body>("components.table", "Body");
const NativeTableRow = componentLeaf<typeof import("../components/Table.js").Table.Row>("components.table", "Row");
const NativeTableCell = componentLeaf<typeof import("../components/Table.js").Table.Cell>("components.table", "Cell");
const TableHeader = componentLeaf<ComponentSpecimenComponent>("components.table", "TableHeader");
const TableHead = componentLeaf<ComponentSpecimenComponent>("components.table", "TableHead");
const TableBody = componentLeaf<ComponentSpecimenComponent>("components.table", "TableBody");
const TableRow = componentLeaf<ComponentSpecimenComponent>("components.table", "TableRow");
const TableCell = componentLeaf<ComponentSpecimenComponent>("components.table", "TableCell");
const FoundryDisclosure = componentLeaf<typeof import("../components/Disclosure.js").Disclosure>("components.disclosure");
const Accordion = componentLeaf<typeof import("../components/preview-runtime/components/disclosure/accordion.js").Accordion>("components.disclosure");
const AccordionItem = componentLeaf<typeof import("../components/preview-runtime/components/disclosure/accordion.js").AccordionItem>("components.disclosure", "AccordionItem");
const AccordionTrigger = componentLeaf<typeof import("../components/preview-runtime/components/disclosure/accordion.js").AccordionTrigger>("components.disclosure", "AccordionTrigger");
const AccordionContent = componentLeaf<typeof import("../components/preview-runtime/components/disclosure/accordion.js").AccordionContent>("components.disclosure", "AccordionContent");

/** Layout is an intrinsic property of a registered specimen leaf. */
export type SpecimenLayout = "single" | "ladder" | "grid" | "matrix";
/** Preferred desktop card width; the containing cards grid owns mobile full width. */
export type SpecimenSpan = "full" | "half" | "third";
export type SpecimenLeafId = `sections.specimen-${string}`;
export interface SpecimenAxisValue { readonly id: string; readonly label: string }
export interface SpecimenAxis { readonly id: string; readonly label: string; readonly values: readonly SpecimenAxisValue[] }
/** Cell-authored data, never a React render function. Coordinates refer to the leaf's declared axes. */
export interface SpecimenItem<Value = unknown> {
  readonly id: string;
  readonly label: string;
  readonly value: Value;
  readonly coordinates?: Readonly<Record<string, string>>;
}
export interface SpecimenSurfaceRenderRequest {
  readonly leaf: string;
  readonly width: number;
  readonly state: string;
}
export interface SpecimenComponentStateRequest {
  readonly Content: typeof import("../components/SemanticContent.js").SemanticContent;
  readonly context: DesignerSpecimenContext;
  readonly leaf: string;
  readonly members: readonly string[];
  readonly state: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly interactive: boolean;
  readonly unavailable: (reason: string) => ReactNode;
}
export interface SpecimenContentRenderRequest {
  readonly leaf: "sections.section-header" | "sections.empty-state";
  readonly title: string;
  readonly level?: 3;
  readonly role?: "alert";
}
export type SpecimenBreakpointReference = "var(--breakpoint-mobile)" | "var(--breakpoint-desktop)";
export interface SpecimenNativeViewportRequest {
  readonly Content: typeof import("../components/SemanticContent.js").SemanticContent;
  readonly leaf: string;
  readonly width: number | SpecimenBreakpointReference;
  readonly expanded?: boolean;
  readonly need: (need: DesignerSpecimenNeed) => ReactNode;
  /** Applies the measured width to the section's declared renderSurface part. */
  readonly children: (width: number) => ReactNode;
}
export interface SpecimenPageViewportRequest {
  readonly page: SpecimenPublishedPage;
  readonly viewport: { readonly id: string; readonly label: string; readonly width: number; readonly height: number };
  readonly interactive: false;
  readonly fullSize: boolean;
}
export interface SpecimenNativeViewportParts {
  readonly renderSurface?: (input: SpecimenSurfaceRenderRequest) => ReactNode;
  readonly renderViewport?: (input: SpecimenNativeViewportRequest) => ReactNode;
}
/** Hosts bind these named parts to the corresponding registered specimen section. */
export interface SpecimenRenderParts extends SpecimenTokenHostParts {
  readonly "sections.specimen-variant-matrix"?: { readonly renderComponentState?: (input: SpecimenComponentStateRequest) => ReactNode };
  readonly "sections.specimen-section-viewports"?: SpecimenNativeViewportParts;
  readonly "sections.specimen-frame-viewports"?: SpecimenNativeViewportParts;
  readonly "sections.specimen-copy-in-context"?: { readonly renderContent?: (input: SpecimenContentRenderRequest) => ReactNode };
  readonly "sections.specimen-page-viewports"?: { readonly renderViewport?: (input: SpecimenPageViewportRequest) => ReactNode };
}
export interface SpecimenLabels { readonly showAllVariants: (count: number) => ReactNode }
export interface SpecimenLeafProps<Value = unknown> {
  readonly items: readonly SpecimenItem<Value>[];
  readonly axes?: readonly SpecimenAxis[];
  readonly context: DesignerSpecimenContext;
  readonly need: (need: DesignerSpecimenNeed) => ReactNode;
  readonly renderParts?: SpecimenRenderParts;
  /** Link-out hosts pass true: all items render expanded at full size. */
  readonly expanded?: boolean;
  readonly labels: SpecimenLabels;
}
export interface SpecimenLeafDefinition {
  readonly id: SpecimenLeafId;
  readonly layout: SpecimenLayout;
  readonly span: SpecimenSpan;
  readonly compatible: readonly { readonly kind: string; readonly layer?: string }[];
  readonly requirements?: readonly string[];
  validate?(props: SpecimenLeafProps): readonly DesignerSpecimenNeed[];
  /** Executable implementation owned by the leaf; Studio only dispatches its id and data. */
  render(props: SpecimenLeafProps): ReactNode;
}
/** Internal rendering section shared by the intrinsic leaf implementations, never cell input. */
export interface SpecimenSection {
  readonly id: string;
  readonly label: string;
  readonly layout: SpecimenLayout;
  readonly axes: readonly SpecimenAxis[];
  readonly items: readonly SpecimenItem[];
}

type LayoutProps = SpecimenLeafProps & {
  readonly id: SpecimenLeafId;
  readonly label: string;
  readonly layout: SpecimenLayout;
  readonly renderItem: (item: SpecimenItem) => ReactNode;
};
export function specimenLayoutNeeds({ id, layout, items, axes = [], context, expanded }: SpecimenLeafProps & { readonly id: SpecimenLeafId; readonly layout: SpecimenLayout }): readonly DesignerSpecimenNeed[] {
  const needs: DesignerSpecimenNeed[] = [];
  const add = (reason: string) => needs.push({ leaf: id, reason });
  if (!items.length) add("A specimen requires at least one cell-authored item.");
  if (new Set(items.map(item => item.id)).size !== items.length) add("Specimen item ids must be unique.");
  const semantic = specimenComponent(context, "components.semantic-content");
  if ("reason" in semantic) needs.push(semantic);
  if (items.length <= 1) return needs;
  if (layout === "single") add("A single-layout specimen cannot accept multiple items.");
  const list = specimenComponent(context, "components.grid-list");
  if ("reason" in list) needs.push(list);
  else if (!specimenPart(list, "Item", "GridListItem")) add("The selected grid-list has no native item part.");
  let disclosureRequired = items.length > 12;
  if (layout === "matrix") {
    if (axes.length < 2 || axes.some(axis => !axis.values.length || new Set(axis.values.map(value => value.id)).size !== axis.values.length)) add("A matrix needs two nonempty, uniquely labelled axes.");
    if (items.some(item => axes.some(axis => !axis.values.some(value => value.id === item.coordinates?.[axis.id])))) add("Every matrix item must name a registered value on each axis.");
    if (axes.length >= 2) disclosureRequired = items.some(item => axes.filter((_, index) => index !== 1).some(axis => item.coordinates?.[axis.id] !== items[0]!.coordinates?.[axis.id]));
    const table = specimenComponent(context, "components.table");
    if ("reason" in table) needs.push(table);
    else if (![["Header", "TableHeader"], ["Column", "TableHead"], ["Body", "TableBody"], ["Row", "TableRow"], ["Cell", "TableCell"]].every(([foundry, shadcn]) => specimenPart(table, foundry!, shadcn!))) add("The selected table has no complete native header, row and cell API.");
  }
  if (!expanded && disclosureRequired) {
    const disclosure = specimenComponent(context, "components.disclosure");
    if ("reason" in disclosure) needs.push(disclosure);
    else if (disclosure.source === "shadcn@aria" && !["AccordionItem", "AccordionTrigger", "AccordionContent"].every(name => component(disclosure.exports[name]))) add("The selected accordion has no native item, trigger and content API.");
  }
  return needs;
}
export function specimenComponent(context: DesignerSpecimenContext, leaf: string): ComponentSpecimenBinding | DesignerSpecimenNeed {
  const bound = componentSpecimenPreview({ modules: context.modules }).bind(leaf, context.profile);
  return "binding" in bound ? bound.binding : { leaf, reason: `${bound.refusal.code}: ${bound.refusal.detail}` };
}
const component = (value: unknown): value is ComponentSpecimenComponent => typeof value === "function" || typeof value === "object" && value !== null && "$$typeof" in value;
/** Uses the selected library's own public sub-part API; no synthesized aliases. */
export function specimenPart(binding: ComponentSpecimenBinding, foundryName: string, shadcnName: string): ComponentSpecimenComponent | undefined {
  const value = binding.source === "shadcn@aria" ? binding.exports[shadcnName] : (binding.Component as unknown as Record<string, unknown>)[foundryName];
  return component(value) ? value : undefined;
}
function useMobile(): boolean {
  const breakpoint = TOKENS["--breakpoint-mobile"]?.value;
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (!breakpoint || typeof matchMedia !== "function") return;
    const media = matchMedia(`(width < ${breakpoint})`), update = () => setMobile(media.matches);
    update(); media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [breakpoint]);
  return mobile;
}

/** Private intrinsic layout engine. The bound leaf owns this call, never the cell or Studio row. */
export function SpecimenLayoutSection(props: LayoutProps): ReactNode {
  const { id, label, layout, items, context, need, expanded, labels, renderItem } = props;
  const mobile = useMobile();
  const semantic = specimenComponent(context, "components.semantic-content");
  if ("reason" in semantic) return need(semantic);
  const fail = (reason: string) => <Content as="div" data-ds-leaf={id} data-ds-specimen-need="true">{need({ leaf: id, reason })}</Content>;
  if (!items.length) return fail("A specimen requires at least one cell-authored item.");
  if (new Set(items.map(item => item.id)).size !== items.length) return fail("Specimen item ids must be unique.");
  const itemNode = (item: SpecimenItem) => <Content as="div" key={item.id} data-ds-leaf={id} data-ds-specimen-section={id} data-ds-specimen-item={item.id} data-ds-specimen-coordinates={JSON.stringify(item.coordinates ?? {})} className="min-w-0 max-w-full">{renderItem(item)}</Content>;
  const region = (children: ReactNode) => <Content as="section" data-ds-leaf={id} data-ds-specimen-region={id} data-ds-specimen-section={id} data-ds-specimen-layout={items.length === 1 ? "single" : layout} className="flex min-w-0 w-full flex-col gap-md">{children}</Content>;
  // A singleton is the specimen itself: no collection, headings or disclosure.
  if (items.length === 1) return region(itemNode(items[0]!));
  if (layout === "single") return fail("A single-layout specimen cannot accept multiple items.");
  const list = specimenComponent(context, "components.grid-list");
  if ("reason" in list) return fail(list.reason);
  if (!specimenPart(list, "Item", "GridListItem")) return fail("The selected grid-list has no native item part.");
  const listItem = (item: Pick<SpecimenItem, "id" | "label">, children: ReactNode) => list.source === "shadcn@aria"
    ? <GridListItem key={item.id} id={item.id} textValue={item.label} className="min-w-0 flex-col items-start">{children}</GridListItem>
    : <ListItem key={item.id} id={item.id} textValue={item.label} className="min-w-0 flex-col items-start">{children}</ListItem>;
  const listOf = (entries: readonly SpecimenItem[], grid = false) => <List data-ds-leaf="components.grid-list" aria-label={label} layout={grid ? "grid" : "list"} selectionMode="none">
    {entries.map(item => listItem(item, <><Content as="h4">{item.label}</Content>{itemNode(item)}</>))}
  </List>;
  const axes = props.axes ?? [];
  let first: readonly SpecimenItem[] = items.slice(0, 12), rest: readonly SpecimenItem[] = items.slice(12);
  let draw: (entries: readonly SpecimenItem[]) => ReactNode = entries => listOf(entries, layout === "grid");
  if (layout === "matrix") {
    if (axes.length < 2 || axes.some(axis => !axis.values.length || new Set(axis.values.map(value => value.id)).size !== axis.values.length)) return fail("A matrix needs two nonempty, uniquely labelled axes.");
    if (items.some(item => axes.some(axis => !axis.values.some(value => value.id === item.coordinates?.[axis.id])))) return fail("Every matrix item must name a registered value on each axis.");
    const [row, column, ...stack] = axes as [SpecimenAxis, SpecimenAxis, ...SpecimenAxis[]];
    const groupKey = (item: SpecimenItem) => stack.map(axis => item.coordinates![axis.id]).join("/");
    const firstKey = groupKey(items[0]!), firstRow = items[0]!.coordinates![row.id];
    first = items.filter(item => groupKey(item) === firstKey && item.coordinates![row.id] === firstRow);
    const initial = new Set(first); rest = items.filter(item => !initial.has(item));
    const table = specimenComponent(context, "components.table");
    if ("reason" in table) return fail(table.reason);
    if (![["Header", "TableHeader"], ["Column", "TableHead"], ["Body", "TableBody"], ["Row", "TableRow"], ["Cell", "TableCell"]].every(([foundry, shadcn]) => specimenPart(table, foundry!, shadcn!))) return fail("The selected table has no complete native header, row and cell API.");
    draw = entries => {
      const groups = [...new Set(entries.map(groupKey))];
      return groups.map(group => {
        const grouped = entries.filter(item => groupKey(item) === group);
        const rows = row.values.filter(value => grouped.some(item => item.coordinates![row.id] === value.id));
        const groupLabel = stack.map(axis => `${axis.label}: ${axis.values.find(value => value.id === grouped[0]!.coordinates![axis.id])!.label}`).join(" · ");
        const lookup = (rowId: string, colId: string) => grouped.find(item => item.coordinates![row.id] === rowId && item.coordinates![column.id] === colId);
        const body = mobile ? <List data-ds-leaf="components.grid-list" aria-label={groupLabel || label} layout="list" selectionMode="none">{rows.map(value => listItem(value, <>
          <Content as="h4">{row.label}: {value.label}</Content>{column.values.map(col => { const item = lookup(value.id, col.id); return item ? <Content as="section" key={col.id} className="flex min-w-0 flex-col gap-sm"><Content as="h5">{column.label}: {col.label}</Content>{itemNode(item)}</Content> : null; })}
        </>))}</List> : table.source === "shadcn@aria" ? <Table data-ds-leaf="components.table" aria-label={groupLabel || label}>
          <TableHeader><TableRow><TableHead scope="col">{row.label}</TableHead>{column.values.map(col => <TableHead key={col.id} scope="col">{col.label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{rows.map(value => <TableRow key={value.id}><TableHead scope="row">{value.label}</TableHead>{column.values.map(col => { const item = lookup(value.id, col.id); return <TableCell key={col.id}>{item ? itemNode(item) : null}</TableCell>; })}</TableRow>)}</TableBody>
        </Table> : <Table data-ds-leaf="components.table" aria-label={groupLabel || label}>
          <NativeTableHeader><NativeTableColumn isRowHeader>{row.label}</NativeTableColumn>{column.values.map(col => <NativeTableColumn key={col.id}>{col.label}</NativeTableColumn>)}</NativeTableHeader>
          <NativeTableBody>{rows.map(value => <NativeTableRow id={value.id} key={value.id}><NativeTableCell textValue={value.label}>{value.label}</NativeTableCell>{column.values.map(col => { const item = lookup(value.id, col.id); return <NativeTableCell key={col.id} textValue={item?.label ?? col.label}>{item ? itemNode(item) : null}</NativeTableCell>; })}</NativeTableRow>)}</NativeTableBody>
        </Table>;
        return <Content as="section" key={group} data-specimen-matrix-group={group} data-specimen-matrix-mobile={mobile ? "true" : "false"} className="min-w-0 max-w-full">{groupLabel ? <Content as="h3">{groupLabel}</Content> : null}{body}</Content>;
      });
    };
  }
  if (expanded || !rest.length) return region(draw(items));
  const disclosure = specimenComponent(context, "components.disclosure");
  if ("reason" in disclosure) return fail(disclosure.reason);
  if (disclosure.source === "shadcn@aria") {
    const Item = disclosure.exports.AccordionItem, Trigger = disclosure.exports.AccordionTrigger, Panel = disclosure.exports.AccordionContent;
    if (!component(Item) || !component(Trigger) || !component(Panel)) return fail("The selected accordion has no native item, trigger and content API.");
    return region(<>{draw(first)}<Accordion data-ds-leaf="components.disclosure"><AccordionItem id={`${id}-all`}><AccordionTrigger>{labels.showAllVariants(items.length)}</AccordionTrigger><AccordionContent>{draw(rest)}</AccordionContent></AccordionItem></Accordion></>);
  }
  return region(<>{draw(first)}<FoundryDisclosure data-ds-leaf="components.disclosure" title={labels.showAllVariants(items.length)}>{draw(rest)}</FoundryDisclosure></>);
}
