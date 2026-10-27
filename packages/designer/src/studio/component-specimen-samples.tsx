"use client";
import { cloneElement, useId, useRef, useState, type ComponentType, type ContextType, type FormEvent, type ReactElement, type ReactNode } from "react";
import { TooltipTriggerStateContext } from "react-aria-components";
import { Button } from "../components/Button.js";
import { componentSpecimenActions, componentSpecimenCard, componentSpecimenCollections, componentSpecimenColor, componentSpecimenField, componentSpecimenOverlays, componentSpecimenProps, componentSpecimenSourceSamples, componentSpecimenTable, componentSpecimenText, componentSpecimenToast, componentSpecimenUnavailable } from "./component-specimen-sample-content.js";
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

/**
 * A state a probe can ask a specimen to draw in. Each is forced through the component's own prop where it has
 * one ({@link componentSpecimenStateProps}); hover, focus-visible and a momentary press are pointer and keyboard
 * interactions the Foundry fills style with CSS pseudo-classes, which no prop can force.
 */
export const COMPONENT_SPECIMEN_PROBE_STATES = ["hover", "focus-visible", "pressed", "disabled", "invalid", "selected", "open", "read-only"] as const;
export type ComponentSpecimenProbeState = typeof COMPONENT_SPECIMEN_PROBE_STATES[number];

type StateProps = Partial<Record<ComponentSpecimenProbeState, Readonly<Record<string, unknown>>>>;
const disabled: StateProps = { disabled: { isDisabled: true } };
const field: StateProps = { ...disabled, invalid: { isInvalid: true }, "read-only": { isReadOnly: true } };
const toggle: StateProps = { ...disabled, selected: { isSelected: true }, "read-only": { isReadOnly: true } };

/** The component's own props that force each state, by sample key. A state absent here cannot be forced by a prop. */
const stateProps: Readonly<Record<string, StateProps>> = {
  "./components#Button": disabled,
  "./components#Link": disabled,
  "./components#Slider": disabled,
  "./components#Tabs": disabled,
  "./components#ToggleGroup": disabled,
  "./components#GridList": disabled,
  "./components#TagGroup": disabled,
  "./components#ColorPicker": {},
  "./components#Checkbox": { ...toggle, invalid: { isInvalid: true } },
  "./components#Switch": toggle,
  "./components#ToggleButton": { ...toggle, pressed: { isSelected: true } },
  "./components#TextField": field,
  "./components#SearchField": field,
  "./components#NumberField": field,
  "./components#DateField": field,
  "./components#Calendar": field,
  "./components#ComboBox": field,
  "./components#RadioGroup": field,
  "./components#Select": { ...disabled, invalid: { isInvalid: true } },
  "./components#Disclosure": { ...disabled, open: { isExpanded: true } },
  "components/button/button.tsx#Button": disabled,
  "components/slider/slider.tsx#Slider": disabled,
  "components/checkbox/checkbox.tsx#Checkbox": { ...toggle, invalid: { isInvalid: true } },
  "components/switch/switch.tsx#Switch": toggle,
  "components/toggle-button/toggle.tsx#Toggle": { ...toggle, pressed: { isSelected: true } },
};

/** The props that force `state` on the export at `key`, or undefined when the component has no prop for it. */
export const componentSpecimenStateProps = (key: string, state: ComponentSpecimenProbeState): Readonly<Record<string, unknown>> | undefined =>
  Object.hasOwn(stateProps, key) ? stateProps[key]![state] : undefined;

/** Inputs a sample cannot carry as data: a controlled handler that has nothing to update, or a submit kept in the cell. */
const handlers: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "./components#ResizeHandle": { onChange: () => undefined },
  "./components#Form": { onSubmit: (event: FormEvent) => event.preventDefault() },
};

const part = (owner: unknown, name: string): Renderable | undefined => {
  const value = owner !== null && (typeof owner === "object" || typeof owner === "function") && Object.hasOwn(owner, name) ? (owner as Namespace)[name] : undefined;
  return typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value) ? value as Renderable : undefined;
};

type TreeItem = { readonly id: string; readonly label: string; readonly expandLabel: string; readonly children?: readonly TreeItem[] };

function collection(key: string, Component: unknown, exports: Namespace): ComponentSpecimenSample | undefined {
  const c = componentSpecimenCollections;
  switch (key) {
    case "./components#Breadcrumb": {
      const Item = part(Component, "Item");
      return Item && { props: {}, children: c[key].items.map(item => <Item key={item.id} href={"href" in item ? item.href : undefined}>{item.label}</Item>) };
    }
    case "./components#GridList": {
      const Item = part(Component, "Item");
      return Item && { props: { "aria-label": c[key].label }, children: c[key].items.map(item => <Item key={item.id} id={item.id} textValue={item.label}>{item.label}</Item>) };
    }
    case "./components#Tree": {
      const Node = part(Component, "Node");
      if (!Node) return undefined;
      const node = (item: TreeItem): ReactNode => <Node key={item.id} id={item.id} textValue={item.label} label={item.label} expandLabel={item.expandLabel}>{item.children?.map(node)}</Node>;
      return { props: { "aria-label": c[key].label, defaultExpandedKeys: c[key].defaultExpandedKeys }, children: c[key].items.map(node) };
    }
    case "./components#Toolbar": {
      const Button = part(exports, "Button");
      return Button && { props: { "aria-label": c[key].label }, children: c[key].items.map(item => <Button key={item.id}>{item.label}</Button>) };
    }
    case "./components#NavigationTree": {
      const Item = part(exports, "NavigationTreeItem"), Content = part(exports, "NavigationTreeItemContent"), Link = part(exports, "Link");
      return Item && Content && Link && { props: { "aria-label": c[key].label }, children: c[key].items.map(item => <Item key={item.id} id={item.id} textValue={item.label} href={item.href}><Content><Link>{item.label}</Link></Content></Item>) };
    }
    case "./components#RadioGroup": {
      const Radio = part(Component, "Radio");
      return Radio && { props: { label: c[key].label, defaultValue: c[key].defaultValue }, children: c[key].items.map(item => <Radio key={item.id} value={item.id}>{item.label}</Radio>) };
    }
    case "./components#Tabs": {
      const List = part(Component, "List"), Tab = part(Component, "Tab"), Panel = part(Component, "Panel");
      return List && Tab && Panel && { props: {}, children: [
        <List key="list" aria-label={c[key].label}>{c[key].items.map(item => <Tab key={item.id} id={item.id}>{item.label}</Tab>)}</List>,
        ...c[key].items.map(item => <Panel key={item.id} id={item.id}>{item.content}</Panel>),
      ] };
    }
    case "./components#TagGroup": {
      const List = part(Component, "List"), Item = part(Component, "Item");
      return List && Item && { props: { label: c[key].label }, children: <List>{c[key].items.map(item => <Item key={item.id} id={item.id} textValue={item.label}>{item.label}</Item>)}</List> };
    }
    case "./components#ToggleGroup": {
      const Item = part(exports, "ToggleGroupItem");
      return Item && { props: { "aria-label": c[key].label, selectionMode: "single", defaultSelectedKeys: c[key].defaultSelectedKeys }, children: c[key].items.map(item => <Item key={item.id} id={item.id}>{item.label}</Item>) };
    }
    case "./components#Disclosure": {
      const [first] = c[key].items;
      return { props: { title: first.label }, children: first.content };
    }
    default: return undefined;
  }
}

function table(Component: unknown): ComponentSpecimenSample | undefined {
  const [Header, Column, Body, Row, Cell] = ["Header", "Column", "Body", "Row", "Cell"].map(name => part(Component, name));
  if (!Header || !Column || !Body || !Row || !Cell) return undefined;
  const { label, columns, rows, sortDescriptor } = componentSpecimenTable;
  return { props: { "aria-label": label, sortDescriptor }, children: [
    <Header key="header">{columns.map((column, index) => <Column key={column.id} id={column.id} isRowHeader={index === 0} allowsSorting={column.allowsSorting}>{column.label}</Column>)}</Header>,
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

/** Foundry components drawn with sibling Foundry exports: a card's heading and body, an upload trigger, a form. */
function composed(key: string, exports: Namespace): ComponentSpecimenSample | undefined {
  const Button = part(exports, "Button"), Content = part(exports, "SemanticContent"), TextField = part(exports, "TextField");
  const a = componentSpecimenActions;
  switch (key) {
    case "./components#Card": return Content && { props: {}, children: [<Content key="title" as="h3">{componentSpecimenCard.title}</Content>, <Content key="body" as="p">{componentSpecimenCard.content}</Content>] };
    case "./components#FileTrigger": return Button && { props: {}, children: <Button>{a.upload}</Button> };
    case "./components#Form": return Button && TextField && { props: {}, children: [<TextField key="field" {...a.field} />, <Button key="submit" type="submit">{a.submit}</Button>] };
    case "./components#Link": return { props: { href: a.href } };
    default: return undefined;
  }
}

/**
 * Holds an open overlay in the specimen cell: React Aria portals every overlay, so it is given this host element
 * as its portal container. Draws once mounted; a server render has no element to portal into and draws nothing.
 */
function OverlayHost({ children }: { readonly children: (container: HTMLElement) => ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  return <div ref={setContainer} data-specimen-overlay-host="">{container ? children(container) : null}</div>;
}

const heldOpen: NonNullable<ContextType<typeof TooltipTriggerStateContext>> = { isOpen: true, shouldSkipAnimation: true, open: () => {}, close: () => {} };

/**
 * The vendored Tooltip held open beside the registered Foundry Button, anchored through the Tooltip's own
 * `triggerRef` and given an open trigger state through React Aria's own context. It is never placed in a
 * TooltipTrigger: while its tooltip is open, React Aria's trigger listens for Escape on the whole document in the
 * capture phase and stops it there, so a trigger held open would swallow every Escape on the page, including the one
 * that closes a dialog opened from a neighbouring cell.
 */
function HeldTooltip({ trigger, specimen }: { readonly trigger: ReactNode; readonly specimen: ReactElement<Record<string, unknown>> }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const id = useId();
  return <OverlayHost>{container => <TooltipTriggerStateContext.Provider value={heldOpen}>
    <div ref={anchorRef} data-specimen-tooltip-anchor="" className="inline-flex"><Button variant="secondary" aria-describedby={id}>{trigger}</Button></div>
    {cloneElement(specimen, { id, triggerRef: anchorRef, UNSTABLE_portalContainer: container })}
  </TooltipTriggerStateContext.Provider>}</OverlayHost>;
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
      return { props: { isNonModal: true }, children: [<Title key="title">{title}</Title>, <Description key="content">{content}</Description>], host: specimen => <OverlayHost>{container => <Trigger isOpen><Button variant="secondary">{trigger}</Button>{cloneElement(specimen as ReactElement<Record<string, unknown>>, { UNSTABLE_portalContainer: container })}</Trigger>}</OverlayHost> };
    }
    case "components/menu/dropdown-menu.tsx#DropdownMenu": {
      // The module's own InlineMenu is the same RAC Menu without the Popover: it draws open, in place, on the server too.
      const found = parts("InlineMenu", "DropdownMenuItem"); if (!found) return undefined;
      const [Inline, Item] = found as [Renderable, Renderable];
      const { label, items } = s[key];
      return { props: { "aria-label": label }, children: items.map(item => <Item key={item.id} id={item.id}>{item.label}</Item>), host: specimen => <Inline {...(specimen as ReactElement<Record<string, unknown>>).props} /> };
    }
    case "components/tooltip/tooltip.tsx#Tooltip": {
      const { trigger, content } = s[key];
      return { props: {}, children: content, host: specimen => <HeldTooltip trigger={trigger} specimen={specimen as ReactElement<Record<string, unknown>>} /> };
    }
    case "components/dialog/dialog.tsx#Dialog": {
      // The module's own DialogContent is the inner RAC Dialog without ModalOverlay/Modal: it draws open, in place.
      const found = parts("DialogContent", "DialogHeader", "DialogTitle", "DialogDescription"); if (!found) return undefined;
      const [Content, Header, Title, Description] = found as [Renderable, Renderable, Renderable, Renderable];
      return { props: {}, children: <Header><Title>{s[key].title}</Title><Description>{s[key].content}</Description></Header>, host: containedDialog(Content) };
    }
    case "components/slider/slider.tsx#Slider": return { props: { "aria-label": s[key].label, defaultValue: s[key].defaultValue } };
    case "components/table/table.tsx#Table": {
      const found = parts("TableHeader", "TableHead", "TableBody", "TableRow", "TableCell"); if (!found) return undefined;
      const [Header, Head, Body, Row, Cell] = found as [Renderable, Renderable, Renderable, Renderable, Renderable];
      const { label, columns, rows } = componentSpecimenTable;
      return { props: { "aria-label": label }, children: [
        <Header key="header">{columns.map((column, index) => <Head key={column.id} id={column.id} isRowHeader={index === 0}>{column.label}</Head>)}</Header>,
        <Body key="body">{rows.map(row => <Row key={row.id} id={row.id}>{columns.map(column => <Cell key={column.id}>{row[column.id]}</Cell>)}</Row>)}</Body>,
      ] };
    }
    // The composed wrapper calls a render-function child, so it draws its own default content from its naming props alone.
    case "components/date-picker/date-picker.tsx#DatePicker": return { props: { label: s[key].label, triggerLabel: s[key].triggerLabel, defaultValue: s[key].defaultValue } };
    case "components/keyboard/kbd.tsx#Kbd":
    case "components/badge/badge.tsx#Badge":
    case "components/button/button.tsx#Button":
    case "components/switch/switch.tsx#Switch":
    case "components/checkbox/checkbox.tsx#Checkbox":
    case "components/toggle-button/toggle.tsx#Toggle": return { props: {}, children: s[key].text };
    default: return undefined;
  }
}

/** Why sample data cannot draw this export (`./shell#Brandmark`), or undefined when it can. */
export const componentSpecimenUnavailableReason = (key: string): SpecimenUnavailableReason | undefined =>
  Object.hasOwn(componentSpecimenUnavailable, key) ? componentSpecimenUnavailable[key] : undefined;

/**
 * Designer-provided sample content for a Foundry component export (`./components#Meter`) or a vendored
 * shadcn@aria source export (`components/tabs/tabs.tsx#Tabs`), drawn from the shared specimen dataset, so a
 * data-driven component draws without host data. Undefined when the export needs none or its parts are not in
 * the host's modules. A host `specimens` entry always replaces it.
 */
export function componentSpecimenSample(key: string, Component: unknown, exports: Namespace): ComponentSpecimenSample | undefined {
  if (!key.startsWith("./")) return sourceSample(key, exports);
  if (key === "./components#Table") return table(Component);
  // override: field-host-control. Field's contract is a render prop that hands its label, description and ids to
  // a host-owned native control, so its specimen is that native control.
  if (key === "./components#Field") return { props: { ...componentSpecimenField }, children: (field: Record<string, unknown>) => <input {...field} /> };
  if (key === "./components#ColorPicker") return colorPicker(Component);
  if (key === "./shell#Toaster") return { props: { "aria-label": componentSpecimenToast.label }, host: containedToaster(componentSpecimenToast) };
  const built = collection(key, Component, exports) ?? overlay(key, Component, exports) ?? composed(key, exports);
  const props = Object.hasOwn(componentSpecimenProps, key) ? componentSpecimenProps[key] : undefined;
  const text = Object.hasOwn(componentSpecimenText, key) ? componentSpecimenText[key] : undefined;
  const handler = Object.hasOwn(handlers, key) ? handlers[key] : undefined;
  if (!built && !props && text === undefined) return undefined;
  return {
    ...built,
    props: { ...props, ...built?.props, ...handler },
    ...(built?.children !== undefined ? { children: built.children } : text === undefined ? {} : { children: <>{text}</> }),
  };
}
