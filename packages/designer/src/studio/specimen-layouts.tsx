"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { DesignerSpecimenContext, DesignerSpecimenNeed } from "./DesignerSpecimen.js";
import { componentSpecimenPreview, type ComponentSpecimenBinding, type ComponentSpecimenComponent } from "./component-specimens.js";

/** Layout is an intrinsic property of a registered specimen leaf. */
export type SpecimenLayout = "single" | "ladder" | "grid" | "matrix";
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
export interface SpecimenLabels { readonly showAllVariants: (count: number) => ReactNode }
export interface SpecimenLeafProps<Value = unknown> {
  readonly items: readonly SpecimenItem<Value>[];
  readonly axes?: readonly SpecimenAxis[];
  readonly context: DesignerSpecimenContext;
  readonly need: (need: DesignerSpecimenNeed) => ReactNode;
  /** Link-out hosts pass true: all items render expanded at full size. */
  readonly expanded?: boolean;
  readonly labels: SpecimenLabels;
}
export interface SpecimenLeafDefinition {
  readonly id: SpecimenLeafId;
  readonly layout: SpecimenLayout;
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
function useMobile(context: DesignerSpecimenContext): boolean {
  const breakpoint = Object.values(context.profile.values.members).find(member => member.slot === "tokens.breakpoint")?.css.light;
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
  const mobile = useMobile(context);
  const semantic = specimenComponent(context, "components.semantic-content");
  if ("reason" in semantic) return need(semantic);
  const Content = semantic.Component;
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
  const List = list.Component, Item = specimenPart(list, "Item", "GridListItem");
  if (!Item) return fail("The selected grid-list has no native item part.");
  const listOf = (entries: readonly SpecimenItem[], grid = false) => <List data-ds-leaf="components.grid-list" aria-label={label} layout={grid ? "grid" : "stack"} selectionMode="none">
    {entries.map(item => <Item key={item.id} id={item.id} textValue={item.label} className="min-w-0 flex-col items-start"><Content as="h4">{item.label}</Content>{itemNode(item)}</Item>)}
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
    const Table = table.Component;
    const Header = specimenPart(table, "Header", "TableHeader"), Column = specimenPart(table, "Column", "TableHead"), Body = specimenPart(table, "Body", "TableBody"), Row = specimenPart(table, "Row", "TableRow"), Cell = specimenPart(table, "Cell", "TableCell");
    if (!Header || !Column || !Body || !Row || !Cell) return fail("The selected table has no complete native header, row and cell API.");
    draw = entries => {
      const groups = [...new Set(entries.map(groupKey))];
      return groups.map(group => {
        const grouped = entries.filter(item => groupKey(item) === group);
        const rows = row.values.filter(value => grouped.some(item => item.coordinates![row.id] === value.id));
        const groupLabel = stack.map(axis => `${axis.label}: ${axis.values.find(value => value.id === grouped[0]!.coordinates![axis.id])!.label}`).join(" · ");
        const lookup = (rowId: string, colId: string) => grouped.find(item => item.coordinates![row.id] === rowId && item.coordinates![column.id] === colId);
        const body = mobile ? <List data-ds-leaf="components.grid-list" aria-label={groupLabel || label} layout="stack" selectionMode="none">{rows.map(value => <Item id={value.id} key={value.id} textValue={value.label} className="min-w-0 flex-col items-start">
          <Content as="h4">{row.label}: {value.label}</Content>{column.values.map(col => { const item = lookup(value.id, col.id); return item ? <Content as="section" key={col.id} className="flex min-w-0 flex-col gap-sm"><Content as="h5">{column.label}: {col.label}</Content>{itemNode(item)}</Content> : null; })}
        </Item>)}</List> : table.source === "shadcn@aria" ? <Table data-ds-leaf="components.table" aria-label={groupLabel || label}>
          <Header><Row><Column scope="col">{row.label}</Column>{column.values.map(col => <Column key={col.id} scope="col">{col.label}</Column>)}</Row></Header>
          <Body>{rows.map(value => <Row key={value.id}><Column scope="row">{value.label}</Column>{column.values.map(col => { const item = lookup(value.id, col.id); return <Cell key={col.id}>{item ? itemNode(item) : null}</Cell>; })}</Row>)}</Body>
        </Table> : <Table data-ds-leaf="components.table" aria-label={groupLabel || label}>
          <Header><Column isRowHeader>{row.label}</Column>{column.values.map(col => <Column key={col.id}>{col.label}</Column>)}</Header>
          <Body>{rows.map(value => <Row id={value.id} key={value.id}><Cell textValue={value.label}>{value.label}</Cell>{column.values.map(col => { const item = lookup(value.id, col.id); return <Cell key={col.id} textValue={item?.label ?? col.label}>{item ? itemNode(item) : null}</Cell>; })}</Row>)}</Body>
        </Table>;
        return <Content as="section" key={group} data-specimen-matrix-group={group} data-specimen-matrix-mobile={mobile ? "true" : "false"} className="min-w-0 max-w-full">{groupLabel ? <Content as="h3">{groupLabel}</Content> : null}{body}</Content>;
      });
    };
  }
  if (expanded || !rest.length) return region(draw(items));
  const disclosure = specimenComponent(context, "components.disclosure");
  if ("reason" in disclosure) return fail(disclosure.reason);
  const Disclosure = disclosure.Component;
  if (disclosure.source === "shadcn@aria") {
    const Item = disclosure.exports.AccordionItem, Trigger = disclosure.exports.AccordionTrigger, Panel = disclosure.exports.AccordionContent;
    if (!component(Item) || !component(Trigger) || !component(Panel)) return fail("The selected accordion has no native item, trigger and content API.");
    return region(<>{draw(first)}<Disclosure data-ds-leaf="components.disclosure"><Item id={`${id}-all`}><Trigger>{labels.showAllVariants(items.length)}</Trigger><Panel>{draw(rest)}</Panel></Item></Disclosure></>);
  }
  return region(<>{draw(first)}<Disclosure data-ds-leaf="components.disclosure" title={labels.showAllVariants(items.length)}>{draw(rest)}</Disclosure></>);
}
