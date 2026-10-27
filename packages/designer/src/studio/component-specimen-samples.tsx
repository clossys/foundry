"use client";
import { cloneElement, useState, type ComponentType, type ReactElement, type ReactNode } from "react";
import { Button as TriggerButton } from "react-aria-components";
import { componentSpecimenCollections, componentSpecimenColor, componentSpecimenField, componentSpecimenOverlays, componentSpecimenProps, componentSpecimenSourceSamples, componentSpecimenTable, componentSpecimenText, componentSpecimenUnavailable } from "./component-specimen-sample-content.js";
import type { SpecimenUnavailableReason } from "./preview-outcome.js";
import { containedDialog, containedToaster } from "./component-specimen-contained.js";

type Renderable = ComponentType<Record<string, unknown>>;
type Namespace = Readonly<Record<string, unknown>>;

/** Designer sample content for one bound export: props for every specimen of it, and children when it draws them. */
export interface ComponentSpecimenSample {
  readonly props: Readonly<Record<string, unknown>>;
  /** Children for every specimen of it: content, or a render function for a component that takes one (`Field`). */
  readonly children?: ReactNode | ((props: Record<string, unknown>) => ReactNode);
  /**
   * Wraps each drawn specimen of the export: an overlay surface is placed in its own module's trigger, held open
   * with React Aria's controlled `isOpen`, so it draws statically without a host interaction.
   */
  readonly host?: (specimen: ReactNode) => ReactNode;
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

/**
 * Holds an open overlay in the specimen cell: React Aria portals every overlay, so it is given this host element
 * as its portal container. Draws once mounted; a server render has no element to portal into and draws nothing.
 */
function OverlayHost({ children }: { readonly children: (container: HTMLElement) => ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  return <div ref={setContainer} data-specimen-overlay-host="">{container ? children(container) : null}</div>;
}

/** Vendored shadcn@aria compounds, drawn with the parts their own module exports. */
function sourceSample(key: string, exports: Namespace): ComponentSpecimenSample | undefined {
  const parts = (...names: string[]) => { const found = names.map(name => part(exports, name)); return found.every(Boolean) ? found as Renderable[] : undefined; };
  const s = componentSpecimenSourceSamples;
  switch (key) {
    case "components/breadcrumbs/breadcrumb.tsx#Breadcrumb": {
      const found = parts("BreadcrumbList", "BreadcrumbItem", "BreadcrumbLink"); if (!found) return undefined;
      const [List, Item, Link] = found as [Renderable, Renderable, Renderable];
      return { props: {}, children: <List>{s[key].items.map(item => <Item key={item.id} id={item.id}><Link href={"href" in item ? item.href : undefined}>{item.label}</Link></Item>)}</List> };
    }
    case "components/tabs/tabs.tsx#Tabs": {
      const found = parts("TabsList", "TabsTrigger", "TabsContent"); if (!found) return undefined;
      const [List, Trigger, Content] = found as [Renderable, Renderable, Renderable];
      return { props: {}, children: [<List key="list" aria-label={s[key].label}>{s[key].items.map(item => <Trigger key={item.id} id={item.id}>{item.label}</Trigger>)}</List>, ...s[key].items.map(item => <Content key={item.id} id={item.id}>{item.content}</Content>)] };
    }
    case "components/radio-group/radio-group.tsx#RadioGroup": {
      const found = parts("RadioGroupItem"); if (!found) return undefined;
      const [Item] = found as [Renderable];
      return { props: { "aria-label": s[key].label, defaultValue: s[key].defaultValue }, children: s[key].items.map(item => <Item key={item.id} value={item.id}>{item.label}</Item>) };
    }
    case "components/disclosure/accordion.tsx#Accordion": {
      const found = parts("AccordionItem", "AccordionTrigger", "AccordionContent"); if (!found) return undefined;
      const [Item, Trigger, Content] = found as [Renderable, Renderable, Renderable];
      return { props: {}, children: s[key].items.map(item => <Item key={item.id} id={item.id}><Trigger>{item.label}</Trigger><Content>{item.content}</Content></Item>) };
    }
    case "components/avatar/avatar.tsx#Avatar": {
      const found = parts("AvatarFallback"); if (!found) return undefined;
      const [Fallback] = found as [Renderable];
      return { props: {}, children: <Fallback>{s[key].initials}</Fallback> };
    }
    case "components/card/card.tsx#Card": {
      const found = parts("CardHeader", "CardTitle", "CardContent"); if (!found) return undefined;
      const [Header, Title, Content] = found as [Renderable, Renderable, Renderable];
      return { props: {}, children: [<Header key="header"><Title>{s[key].title}</Title></Header>, <Content key="content">{s[key].content}</Content>] };
    }
    case "components/progress-bar/progress.tsx#Progress": {
      const found = parts("ProgressTrack", "ProgressIndicator"); if (!found) return undefined;
      const [Track, Indicator] = found as [Renderable, Renderable];
      return { props: { "aria-label": s[key].label, value: s[key].value }, children: <Track><Indicator /></Track> };
    }
    case "components/popover/popover.tsx#Popover": {
      const found = parts("PopoverTrigger", "PopoverTitle", "PopoverDescription"); if (!found) return undefined;
      const [Trigger, Title, Description] = found as [Renderable, Renderable, Renderable];
      const { trigger, title, content } = s[key];
      // Non-modal, so holding it open never hides the rest of Studio or locks its scroll.
      return { props: { isNonModal: true }, children: [<Title key="title">{title}</Title>, <Description key="content">{content}</Description>], host: specimen => <OverlayHost>{container => <Trigger isOpen><TriggerButton>{trigger}</TriggerButton>{cloneElement(specimen as ReactElement<Record<string, unknown>>, { UNSTABLE_portalContainer: container })}</Trigger>}</OverlayHost> };
    }
    case "components/menu/dropdown-menu.tsx#DropdownMenu": {
      // The module's own InlineMenu is the same RAC Menu without the Popover: it draws open, in place, on the server too.
      const found = parts("InlineMenu", "DropdownMenuItem"); if (!found) return undefined;
      const [Inline, Item] = found as [Renderable, Renderable];
      const { label, items } = s[key];
      return { props: { "aria-label": label }, children: items.map(item => <Item key={item.id} id={item.id}>{item.label}</Item>), host: specimen => <Inline {...(specimen as ReactElement<Record<string, unknown>>).props} /> };
    }
    case "components/tooltip/tooltip.tsx#Tooltip": {
      const found = parts("TooltipTrigger"); if (!found) return undefined;
      const [Trigger] = found as [Renderable];
      const { trigger, content } = s[key];
      return { props: {}, children: content, host: specimen => <OverlayHost>{container => <Trigger isOpen><TriggerButton>{trigger}</TriggerButton>{cloneElement(specimen as ReactElement<Record<string, unknown>>, { UNSTABLE_portalContainer: container })}</Trigger>}</OverlayHost> };
    }
    case "components/dialog/dialog.tsx#Dialog": {
      const found = parts("DialogHeader", "DialogTitle", "DialogDescription"); if (!found) return undefined;
      const [Header, Title, Description] = found as [Renderable, Renderable, Renderable];
      return { props: {}, children: <Header><Title>{s[key].title}</Title><Description>{s[key].content}</Description></Header>, host: containedDialog };
    }
    case "components/slider/slider.tsx#Slider": return { props: { "aria-label": s[key].label, defaultValue: s[key].defaultValue } };
    default: return undefined;
  }
}

/** Why sample data cannot draw this export (`./shell#Brandmark`), or undefined when it can. */
export const componentSpecimenUnavailableReason = (key: string): SpecimenUnavailableReason | undefined =>
  Object.hasOwn(componentSpecimenUnavailable, key) ? componentSpecimenUnavailable[key] : undefined;

/**
 * Designer-provided sample content for a Foundry component export (`./components#Meter`) or a vendored
 * shadcn@aria source export (`components/tabs/tabs.tsx#Tabs`), so a data-driven
 * component draws without host data. Undefined when the export needs none or its parts are not in the
 * host's modules. A host `specimens` entry always replaces it.
 */
export function componentSpecimenSample(key: string, Component: unknown, exports: Namespace): ComponentSpecimenSample | undefined {
  if (!key.startsWith("./")) return sourceSample(key, exports);
  if (key === "./components#Table") return table(Component);
  if (key === "./components#Field") return { props: { ...componentSpecimenField }, children: (field: Record<string, unknown>) => <input {...field} /> };
  if (key === "./components#ColorPicker") return colorPicker(Component);
  if (key === "./shell#Toaster") return { props: {}, host: containedToaster };
  const composed = collection(key, Component, exports) ?? overlay(key, Component, exports);
  if (composed) return composed;
  const props = Object.hasOwn(componentSpecimenProps, key) ? componentSpecimenProps[key] : undefined;
  if (!props) return undefined;
  const text = Object.hasOwn(componentSpecimenText, key) ? componentSpecimenText[key] : undefined;
  return { props: { ...props, ...(Object.hasOwn(handlers, key) ? handlers[key] : {}) }, ...(text === undefined ? {} : { children: <>{text}</> }) };
}
