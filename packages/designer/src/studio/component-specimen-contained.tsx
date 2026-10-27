"use client";
import { isValidElement, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { UNSTABLE_ToastQueue as ToastQueue } from "react-aria-components";
import { ToasterSpecimenQueueProvider, type ToastRecord } from "../shell/Toaster.js";
import { componentSpecimenToast } from "./component-specimen-sample-content.js";

type Element = ReactElement<Record<string, unknown>>;

/**
 * Layout containment makes the host the containing block, and stacking context, of the fixed-positioned overlay and
 * surface the vendored Dialog draws, so they cover and centre in the specimen cell instead of the window.
 */
const dialogHost: CSSProperties = { contain: "layout", position: "relative", width: "28rem", maxWidth: "100%", height: "14rem" };

const slotted = (node: unknown, slot: string): node is Element =>
  isValidElement<Record<string, unknown>>(node) && node.props["data-slot"] === slot;

/**
 * The tree the vendored shadcn@aria `Dialog` returns, down to its own `dialog-overlay` and `dialog-content` parts.
 * The function components above them (`Dialog`, `DialogOverlay`) are called for the element they return; the parts
 * themselves (react-aria-components' ModalOverlay and Modal) are never rendered.
 */
function dialogParts(specimen: ReactNode): { readonly overlay: Element; readonly content: Element } {
  const call = (candidate: unknown) => {
    if (!isValidElement<Record<string, unknown>>(candidate) || candidate.props["data-slot"] === "dialog-overlay") return undefined;
    const type: unknown = candidate.type;
    const isClass = typeof type === "function" && (type.prototype as { isReactComponent?: unknown } | undefined)?.isReactComponent;
    return typeof type === "function" && !isClass ? (type as (props: Record<string, unknown>) => ReactNode)(candidate.props) : undefined;
  };
  let node: unknown = specimen;
  for (let depth = 0, next = call(node); depth < 4 && next !== undefined; depth++, next = call(node)) node = next;
  const content = slotted(node, "dialog-overlay") ? node.props.children : undefined;
  if (!slotted(node, "dialog-overlay") || !slotted(content, "dialog-content")) throw new Error("The vendored Dialog no longer draws its dialog-overlay and dialog-content parts.");
  return { overlay: node, content };
}

const partProps = (part: Element) => ({ "data-slot": part.props["data-slot"] as string, className: typeof part.props.className === "string" ? part.props.className : undefined });

/**
 * The vendored Dialog held open, non-modal, in the specimen cell. Its only surface is react-aria-components'
 * ModalOverlay and Modal, which lock page scroll, set every element outside them `inert` from `document.body` down,
 * and contain focus, whatever portal container they are given; neither takes a prop that turns that off. So its
 * own overlay and content parts draw as plain elements with the same slots and classes, around the Dialog primitive,
 * header and close button the vendored Dialog itself composes, inside a host that contains their fixed positioning.
 */
function ContainedDialog({ specimen }: { readonly specimen: ReactNode }) {
  const { overlay, content } = dialogParts(specimen);
  return <div data-specimen-contained-host="dialog" style={dialogHost}>
    <div {...partProps(overlay)}><div {...partProps(content)}>{content.props.children as ReactNode}</div></div>
  </div>;
}

export const containedDialog = (specimen: ReactNode): ReactNode => <ContainedDialog specimen={specimen} />;

/**
 * The Toaster drawn from a queue local to this specimen, seeded with one sample toast that never times out. The
 * app-wide queue `toast(...)` writes to is never read or written.
 */
function ContainedToaster({ children }: { readonly children: ReactNode }) {
  const [queue] = useState(() => {
    const local = new ToastQueue<ToastRecord>({ maxVisibleToasts: 1 });
    local.add({ ...componentSpecimenToast });
    return local;
  });
  return <div data-specimen-contained-host="toast"><ToasterSpecimenQueueProvider value={queue}>{children}</ToasterSpecimenQueueProvider></div>;
}

export const containedToaster = (specimen: ReactNode): ReactNode => <ContainedToaster>{specimen}</ContainedToaster>;
