import { SemanticContent } from "../components/SemanticContent.js";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "../components/Button.js";
import { Dialog, type DialogProps } from "../components/Dialog.js";
import { Icon } from "../components/Icon.js";
import { cx } from "../components/internal/cx.js";
import { X } from "../icons/X.js";
import { TOKENS } from "../tokens/tokens.js";
import { Panel } from "./Panel.js";

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

/** Material composing the existing Dialog lifecycle and Panel regions, never a second overlay owner. */
export function Drawer({
  trigger, heading, closeLabel, children, footer, fullViewport = false, placement = "start",
  navigationKey, dismissAt = TABLET_QUERY, wide = "dismiss", isOpen, defaultOpen = false,
  onOpenChange, className, style, closeButtonStyle, ...rest
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
  const bottom = placement === "bottom";
  return (
    <Dialog {...rest} trigger={trigger} isOpen={requested && !dismissed && !blocked} onOpenChange={change}
      overlayClassName={bottom ? "items-end p-0" : placement === "start" ? "items-stretch justify-start p-0" : "items-stretch justify-end p-0"}
      modalClassName="h-full max-w-none"
      modalStyle={{
        width: bottom || fullViewport ? "100%" : "var(--ui-layout-drawer-w, min(20rem, 85vw))",
        maxWidth: "100%", height: bottom ? "85vh" : "100%",
        maxHeight: bottom ? "85vh" : "100%",
      }}
      className={bottom ? "h-full min-h-0 max-h-[85vh] rounded-none border-0 p-0" : "h-full min-h-0 max-h-none rounded-none border-0 p-0"} style={style}
    >
      {({ close }) => (
        <Panel
          className={cx("h-full min-h-0 flex-1 rounded-none", className)}
          data-drawer-placement={placement} data-drawer-wide={wide} footer={footer}
          header={(
            <SemanticContent as="div" className="flex items-start justify-between gap-md">
              <Dialog.Heading>{heading}</Dialog.Heading>
              <Button variant="ghost" aria-label={closeLabel} onPress={close} style={closeButtonStyle} aria-expanded={closeButtonStyle ? true : undefined}
                className="icon-control-md shrink-0 border-0 bg-transparent p-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent">
                <Icon glyph={X} decorative size="md" />
              </Button>
            </SemanticContent>
          )}
          onClick={event => {
            const anchor = (event.target as Element).closest("a[href]");
            if (anchor && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) close();
          }}
        >{children}</Panel>
      )}
    </Dialog>
  );
}
