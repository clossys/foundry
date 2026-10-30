import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import type { DialogProps } from "../components/Dialog.js";

import { cx } from "../components/internal/cx.js";
import { X } from "../icons/X.js";
import { TOKENS } from "../tokens/tokens.js";
import { Panel } from "./Panel.js";

import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const Button = componentLeaf<typeof import("../components/Button.js").Button>("components.button");
const Dialog = componentLeaf<typeof import("../components/Dialog.js").Dialog>("components.dialog");
const Sheet = componentLeaf<typeof import("../components/sheet/index.js").Sheet>("components.sheet");
const SheetTrigger = componentLeaf<typeof import("../components/sheet/index.js").SheetTrigger>("components.sheet", "SheetTrigger");
const SheetTitle = componentLeaf<typeof import("../components/sheet/index.js").SheetTitle>("components.sheet", "SheetTitle");
const SheetClose = componentLeaf<typeof import("../components/sheet/index.js").SheetClose>("components.sheet", "SheetClose");
const Icon = componentLeaf<typeof import("../components/Icon.js").Icon>("components.icon");

const TABLET_QUERY = `(min-width: ${TOKENS["--breakpoint-tablet"]!.value})`;

export interface DrawerProps extends Omit<DialogProps, "children" | "size" | "isDismissable" | "overlayClassName" | "modalClassName" | "modalStyle"> {
  heading: ReactNode;
  /** Frame navigation uses the entire viewport width. */
  fullViewport?: boolean;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Optional measured layout for the existing close control; omitted preserves its header placement. */
  closeButtonStyle?: Pick<CSSProperties, "position" | "insetBlockStart" | "insetInlineStart" | "insetInlineEnd" | "direction">;
  /** Logical viewport edge. @default "start" */
  placement?: "start" | "end" | "bottom";
  /** Route identity supplied by the host; any change dismisses an open drawer. */
  navigationKey?: string;
  /** Close on entering this wide-layout query; the default derives from the structural tablet token. Ignored when `wide="sheet"`. */
  dismissAt?: string;
  /** Wide-layout behavior: `"dismiss"` closes and refuses opening while `dismissAt` matches; `"sheet"` opens as a modal side sheet at every viewport width. @default "dismiss" */
  wide?: "dismiss" | "sheet";
}

/** Selected Sheet owns overlay geometry; the frame retains navigation and responsive state. */
export function Drawer({
  trigger, heading, closeLabel, children, footer, fullViewport = false, placement = "start",
  navigationKey, dismissAt = TABLET_QUERY, wide = "dismiss", isOpen, defaultOpen = false,
  onOpenChange, className, style, closeButtonStyle, role = "dialog", ...rest
}: DrawerProps) {
  const [internal, setInternal] = useState(defaultOpen);
  const [dismissed, setDismissed] = useState(false);
  const [atWide, setAtWide] = useState(false);
  const sheet = wide === "sheet";
  const blocked = atWide && !sheet;
  const requested = isOpen ?? internal;
  const latest = useRef({ requested, onOpenChange });
  latest.current = { requested, onOpenChange };
  const lastNavigation = useRef(navigationKey);
  const change = (next: boolean) => {
    if (next && blocked) return;
    setInternal(next);
    setDismissed(!next);
    latest.current.onOpenChange?.(next);
  };
  useEffect(() => { if (isOpen === false) setDismissed(false); }, [isOpen]);
  useEffect(() => {
    if (lastNavigation.current === navigationKey) return;
    lastNavigation.current = navigationKey;
    if (latest.current.requested) change(false);
  }, [navigationKey]);
  useEffect(() => {
    if (sheet) { setAtWide(false); return; }
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(dismissAt);
    const sync = () => {
      setAtWide(media.matches);
      if (media.matches && latest.current.requested) change(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [dismissAt, isOpen, sheet]);
  const open = requested && !dismissed && !blocked;
  const panel = (close: () => void, title: ReactNode, closeControl: ReactNode) => <Panel
    className={cx("h-full min-h-0 flex-1 rounded-none", className)} style={style}
    data-drawer-placement={placement} data-drawer-wide={wide} footer={footer}
    header={<SemanticContent as="div" className="flex items-start justify-between gap-md">{title}{closeControl}</SemanticContent>}
    onClick={event => {
      const anchor = (event.target as Element).closest("a[href]");
      if (anchor && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) close();
    }}
  >{children}</Panel>;
  // Sheet exposes a dialog role only. The existing Dialog leaf retains the explicit alertdialog capability.
  if (role === "alertdialog") return <Dialog {...rest} role={role} trigger={trigger} isOpen={open} onOpenChange={change}
    overlayClassName={placement === "bottom" ? "items-end p-0" : placement === "start" ? "items-stretch justify-start p-0" : "items-stretch justify-end p-0"}>
    {({ close }) => panel(close, <Dialog.Heading>{heading}</Dialog.Heading>, <Button variant="ghost" aria-label={closeLabel} onPress={close} style={closeButtonStyle}
      aria-expanded={closeButtonStyle ? true : undefined} className="icon-control-md shrink-0 border-0 bg-transparent p-0"><Icon glyph={X} decorative size="md" /></Button>)}
  </Dialog>;
  return <SheetTrigger {...rest} isOpen={open} onOpenChange={change}>
    {trigger}
    <Sheet side={placement === "bottom" ? "bottom" : placement === "start" ? "left" : "right"} showCloseButton={false}
      className={fullViewport ? "w-full max-w-full" : undefined}>
      {panel(() => change(false), <SheetTitle>{heading}</SheetTitle>, <SheetClose variant="ghost" size="icon" aria-label={closeLabel} style={closeButtonStyle}
        aria-expanded={closeButtonStyle ? true : undefined} className="icon-control-md shrink-0 border-0 bg-transparent p-0"><Icon glyph={X} decorative size="md" /></SheetClose>)}
    </Sheet>
  </SheetTrigger>;
}
