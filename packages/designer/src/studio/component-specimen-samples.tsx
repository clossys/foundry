"use client";
import type { ComponentType, ReactNode } from "react";
import { componentSpecimenCollections, componentSpecimenColor, componentSpecimenField, componentSpecimenOverlays, componentSpecimenProps, componentSpecimenTable, componentSpecimenText, componentSpecimenUnavailable } from "./component-specimen-sample-content.js";
import type { SpecimenUnavailableReason } from "./preview-outcome.js";

type Renderable = ComponentType<Record<string, unknown>>;
type Namespace = Readonly<Record<string, unknown>>;

/** Designer sample content for one bound export: props for every specimen of it, and children when it draws them. */
export interface ComponentSpecimenSample {
  readonly props: Readonly<Record<string, unknown>>;
  /** Children for every specimen of it: content, or a render function for a component that takes one (`Field`). */
  readonly children?: ReactNode | ((props: Record<string, unknown>) => ReactNode);
}

/** Inputs a sample cannot carry as data: a controlled handler that has nothing to update. */
const handlers: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "./components#ResizeHandle": { onChange: () => undefined },
};

const part = (owner: unknown, name: string): Renderable | undefined => {
  const value = owner !== null && (typeof owner === "object" || typeof owner === "function") && Object.hasOwn(owner, name) ? (owner as Namespace)[name] : undefined;
  return typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value) ? value as Renderable : undefined;
};

function collection(key: string, Component: unknown, exports: Namespace): ComponentSpecimenSample | undefined {
  const sample = Object.hasOwn(componentSpecimenCollections, key) ? componentSpecimenCollections[key as keyof typeof componentSpecimenCollections] : undefined;
  if (!sample) return undefined;
  const label = "label" in sample ? { "aria-label": sample.label } : {};
  switch (key) {
    case "./components#Breadcrumb": {
      const Item = part(Component, "Item");
      return Item && { props: {}, children: sample.items.map(item => <Item key={item.id} href={"href" in item ? item.href : undefined}>{item.label}</Item>) };
    }
    case "./components#GridList": {
      const Item = part(Component, "Item");
      return Item && { props: label, children: sample.items.map(item => <Item key={item.id} id={item.id} textValue={item.label}>{item.label}</Item>) };
    }
    case "./components#Tree": {
      const Node = part(Component, "Node");
      return Node && { props: label, children: sample.items.map(item => <Node key={item.id} id={item.id} textValue={item.label} label={item.label} expandLabel={"expandLabel" in item ? item.expandLabel : item.label} />) };
    }
    case "./components#Toolbar": {
      const Button = part(exports, "Button");
      return Button && { props: label, children: sample.items.map(item => <Button key={item.id}>{item.label}</Button>) };
    }
    case "./components#NavigationTree": {
      const Item = part(exports, "NavigationTreeItem"), Content = part(exports, "NavigationTreeItemContent"), Link = part(exports, "Link");
      return Item && Content && Link && { props: label, children: sample.items.map(item => <Item key={item.id} id={item.id} textValue={item.label} href={"href" in item ? item.href : undefined}><Content><Link>{item.label}</Link></Content></Item>) };
    }
    default: return undefined;
  }
}

function table(Component: unknown): ComponentSpecimenSample | undefined {
  const [Header, Column, Body, Row, Cell] = ["Header", "Column", "Body", "Row", "Cell"].map(name => part(Component, name));
  if (!Header || !Column || !Body || !Row || !Cell) return undefined;
  const { label, columns, rows } = componentSpecimenTable;
  return { props: { "aria-label": label }, children: [
    <Header key="header">{columns.map((column, index) => <Column key={column.id} id={column.id} isRowHeader={index === 0}>{column.label}</Column>)}</Header>,
    <Body key="body">{rows.map(row => <Row key={row.id} id={row.id}>{columns.map(column => <Cell key={column.id}>{row[column.id]}</Cell>)}</Row>)}</Body>,
  ] };
}

function overlay(key: string, Component: unknown, exports: Namespace): ComponentSpecimenSample | undefined {
  const sample = Object.hasOwn(componentSpecimenOverlays, key) ? componentSpecimenOverlays[key as keyof typeof componentSpecimenOverlays] : undefined;
  const Button = part(exports, "Button");
  if (!sample || !Button) return undefined;
  const trigger = <Button>{sample.trigger}</Button>;
  if ("items" in sample) {
    const Item = part(Component, "Item");
    return Item && { props: { trigger }, children: sample.items.map(item => <Item key={item.id} id={item.id} textValue={item.label}>{item.label}</Item>) };
  }
  return { props: { trigger, ...("label" in sample ? { "aria-label": sample.label } : {}) }, children: <>{sample.content}</> };
}

function colorPicker(Component: unknown): ComponentSpecimenSample | undefined {
  const SwatchPicker = part(Component, "SwatchPicker"), Swatch = part(Component, "Swatch");
  if (!SwatchPicker || !Swatch) return undefined;
  const { label, defaultValue, swatches } = componentSpecimenColor;
  return { props: { defaultValue }, children: <SwatchPicker aria-label={label}>{swatches.map(color => <Swatch key={color} color={color} />)}</SwatchPicker> };
}

/** Why sample data cannot draw this export (`./shell#Toaster`), or undefined when it can. */
export const componentSpecimenUnavailableReason = (key: string): SpecimenUnavailableReason | undefined =>
  Object.hasOwn(componentSpecimenUnavailable, key) ? componentSpecimenUnavailable[key] : undefined;

/**
 * Designer-provided sample content for a Foundry component export (`./components#Meter`), so a data-driven
 * component draws without host data. Undefined when the export needs none or its parts are not in the
 * host's modules. A host `specimens` entry always replaces it.
 */
export function componentSpecimenSample(key: string, Component: unknown, exports: Namespace): ComponentSpecimenSample | undefined {
  if (key === "./components#Table") return table(Component);
  if (key === "./components#Field") return { props: { ...componentSpecimenField }, children: (field: Record<string, unknown>) => <input {...field} /> };
  if (key === "./components#ColorPicker") return colorPicker(Component);
  const composed = collection(key, Component, exports) ?? overlay(key, Component, exports);
  if (composed) return composed;
  const props = Object.hasOwn(componentSpecimenProps, key) ? componentSpecimenProps[key] : undefined;
  if (!props) return undefined;
  const text = Object.hasOwn(componentSpecimenText, key) ? componentSpecimenText[key] : undefined;
  return { props: { ...props, ...(Object.hasOwn(handlers, key) ? handlers[key] : {}) }, ...(text === undefined ? {} : { children: <>{text}</> }) };
}
