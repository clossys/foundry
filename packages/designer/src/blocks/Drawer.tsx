import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../atoms/Button.js";
import { Dialog, type DialogProps } from "../atoms/Dialog.js";
import { cx } from "../atoms/internal/cx.js";
import { Panel } from "./Panel.js";

export interface DrawerProps extends Omit<DialogProps, "children" | "size" | "isDismissable" | "overlayClassName" | "modalClassName" | "modalStyle"> {
  heading: ReactNode;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Logical viewport edge. @default "start" */
  placement?: "start" | "end" | "bottom";
  /** Route identity supplied by the host; any change dismisses an open drawer. */
  navigationKey?: string;
  /** Close on entering this wide-layout query; the default matches the structural tablet breakpoint. @default "(min-width: 768px)" */
  dismissAt?: string;
}

/** Material composing the existing Dialog lifecycle and Panel regions, never a second overlay owner. */
export function Drawer({
  trigger, heading, closeLabel, children, footer, placement = "start",
  navigationKey, dismissAt = "(min-width: 768px)", isOpen, defaultOpen = false,
  onOpenChange, className, style, ...rest
}: DrawerProps) {
  const [internal, setInternal] = useState(defaultOpen);
  const [dismissed, setDismissed] = useState(false);
  const [wide, setWide] = useState(false);
  const requested = isOpen ?? internal;
  const latest = useRef({ requested, onOpenChange });
  latest.current = { requested, onOpenChange };
  const lastNavigation = useRef(navigationKey);
  const change = (next: boolean) => {
    if (next && wide) return;
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
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(dismissAt);
    const sync = () => {
      setWide(media.matches);
      if (media.matches && latest.current.requested) change(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [dismissAt, isOpen]);
  const bottom = placement === "bottom";
  return (
    <Dialog {...rest} trigger={trigger} isOpen={requested && !dismissed && !wide} onOpenChange={change}
      overlayClassName={bottom ? "items-end p-0" : placement === "start" ? "items-stretch justify-start p-0" : "items-stretch justify-end p-0"}
      modalClassName="h-full max-w-none"
      modalStyle={{
        width: bottom ? "100%" : "var(--ui-layout-drawer-w, min(20rem, 85vw))",
        maxWidth: "100%", height: bottom ? "85vh" : "100%",
        maxHeight: bottom ? "85vh" : "100%",
      }}
      className={bottom ? "h-full min-h-0 max-h-[85vh] rounded-none border-0 p-0" : "h-full min-h-0 max-h-none rounded-none border-0 p-0"} style={style}
    >
      {({ close }) => (
        <Panel
          className={cx("h-full min-h-0 flex-1 rounded-none", className)}
          data-drawer-placement={placement} footer={footer}
          header={(
            <div className="flex items-start justify-between gap-md">
              <Dialog.Heading>{heading}</Dialog.Heading>
              <Button variant="ghost" aria-label={closeLabel} onPress={close}
                className="icon-control-md shrink-0 border-0 bg-transparent p-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent">
                <span aria-hidden="true" style={{ fontSize: "var(--ui-icon-md, 24px)", lineHeight: 1 }}>×</span>
              </Button>
            </div>
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
