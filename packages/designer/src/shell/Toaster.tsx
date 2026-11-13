"use client";
import { useLocale } from "react-aria-components";
import { createContext, useContext, type CSSProperties } from "react";
import { Toaster as SonnerToaster } from "../components/partners/shadcn/sonner.js";
import { cx } from "../components/internal/cx.js";
import { UI_ELEVATION_FLOATING } from "../components/internal/ui-vars.js";
import { UI_Z_TOAST } from "../components/internal/ui-vars.js";
import type { ToastVariant } from "./internal/toast-queue.js";

export {
  toast,
  type ToastFunction,
  type ToastHandle,
  type ToastOptions,
  type ToastRecord,
  type ToastVariant,
} from "./internal/toast-queue.js";

/** Sonner's rich-colour variables per toast type, read from the status tokens. */
const SONNER_TYPE = { success: "success", danger: "error", info: "info", warning: "warning" } as const satisfies Record<ToastVariant, string>;
const VARIANT_VARS = Object.fromEntries((Object.keys(SONNER_TYPE) as ToastVariant[]).flatMap(variant => [
  [`--${SONNER_TYPE[variant]}-bg`, `var(--color-status-${variant}-tint)`],
  [`--${SONNER_TYPE[variant]}-border`, `var(--color-status-${variant})`],
  [`--${SONNER_TYPE[variant]}-text`, `var(--color-status-${variant}-text)`],
])) as CSSProperties;

/**
 * Viewport-edge distances, in px, of the area a frame reserves for toasts (its stage). A frame supplies it so the
 * viewport anchors to the stage corner instead of the window corner, clear of the frame's header and dock.
 * Internal to the frame contract; not a public prop.
 */
export interface ToasterFrameInset { blockEnd: number; inlineEnd: number; direction: "ltr" | "rtl" }
const ToasterFrameInsetContext = createContext<ToasterFrameInset | null>(null);
export const ToasterFrameInsetProvider = ToasterFrameInsetContext.Provider;
const edge = (px: number) => `calc(${px}px + var(--spacing-md))`;
/** Sonner's "system" theme reads `matchMedia`; where there is none (a server, jsdom) it draws the light scheme. */
const sonnerTheme = (): "system" | "light" => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? "system" : "light");

/** Where a toast stack draws: the window (or frame stage) corner, or in place inside the mounting element. */
export type ToastPlacement = "viewport" | "container";

export interface ToasterProps {
  /**
   * Accessible label for the toast viewport landmark.
   * @default "Notifications"
   */
  "aria-label"?: string;
  /** Merged onto the toast list sonner draws. */
  className?: string;
  /**
   * The sonner Toaster `id` this Toaster draws. Omitted, it draws the app-wide toasts the `toast` API adds; a bounded
   * host (a preview cell) passes its own id and adds through `createToastScope(id)`, so its toasts never reach the
   * page's Toaster.
   */
  toasterId?: string;
  /**
   * `viewport` fixes the stack to the window (or frame stage) corner; `container` draws it in place
   * inside whatever element mounts the Toaster.
   * @default "viewport"
   */
  placement?: ToastPlacement;
}

/**
 * The toast viewport — a runtime service, not a layout component (see this
 * package's README, "Placement rules": a portal, a queue, and an
 * imperative API put a toast stack outside the components/blocks/views/shell
 * ladder entirely). Ships from this subpath anyway, standalone rather than
 * as `Shell.Toaster`, for two reasons:
 *
 *   1. Its LIFETIME requirement is identical to `Shell`'s — it has to
 *      survive route changes so a toast queued just before a navigation is
 *      still there after it, the same reason `Shell` itself has to live in
 *      `layout.tsx` rather than `page.tsx`. That's why it ships from
 *      `/shell` instead of, say, its own top-level subpath.
 *   2. It is not itself part of `Shell`'s SLOT structure. the
 *      toast list is fixed to the viewport (sonner's own
 *      `[data-sonner-toaster]` styles) regardless of where in the component
 *      tree `<Toaster />` is mounted — nesting it inside
 *      `<Shell>` as a `Shell.Toaster` slot would misleadingly imply its
 *      on-screen position is controlled by `Shell`'s grid, the way
 *      `Shell.Rail`'s or `Shell.Header`'s actually is. It isn't; it's
 *      fixed-positioned independently, at `UI_Z_TOAST`.
 *
 * Mount it once, anywhere under the same tree as `<Shell>` — typically as
 * its sibling in a root `layout.tsx` — then call `toast.success(...)` /
 * `toast.error(...)` / `toast.warning(...)` / `toast.info(...)` (or plain
 * `toast(...)`, also `info`-variant) from anywhere in the application,
 * including code with no JSX in it at all.
 *
 * Drawn through the stock shadcn Sonner Toaster (`components/partners/shadcn/sonner.tsx`, MIT)
 * over sonner itself (MIT). Sonner supplies the store, stacking, swipe and
 * close dismissal, the auto-dismiss timer and its pause while the stack is
 * hovered, and the `section` landmark, labelled by `aria-label`, whose
 * `aria-live="polite"` region announces each toast. F6 moves focus to the
 * stack (`hotkey`), as the react-aria-components region did before. Sonner
 * has no assertive announcement, so a danger toast's body carries its own
 * `role="alert"` (see `internal/toast-body.tsx`); the other variants are
 * announced politely by the region. The `container` placement draws the same
 * sonner list in place, for bounded hosts such as a preview cell.
 */
export function Toaster({ "aria-label": ariaLabel = "Notifications", className, toasterId, placement = "viewport" }: ToasterProps) {
  const { direction } = useLocale();
  const frameInset = useContext(ToasterFrameInsetContext);
  const inContainer = placement === "container";
  const dir = (inContainer ? null : frameInset?.direction) ?? direction;
  // Sonner positions by physical side; the inline end is the right in left-to-right and the left in right-to-left.
  const side = dir === "rtl" ? "left" : "right";
  const offset = !inContainer && frameInset ? { bottom: edge(frameInset.blockEnd), [side]: edge(frameInset.inlineEnd) } : undefined;
  const toaster = (
    <SonnerToaster
      {...(toasterId ? { id: toasterId } : {})}
      theme={sonnerTheme()}
      position={`bottom-${side}`}
      dir={dir}
      hotkey={["F6"]}
      customAriaLabel={ariaLabel}
      containerAriaLabel={ariaLabel}
      closeButton
      richColors
      visibleToasts={inContainer ? 1 : 5}
      {...(offset ? { offset } : {})}
      className={cx(inContainer ? "toaster group" : "toaster group end-md", className)}
      style={{ ...VARIANT_VARS, ["--border-radius" as string]: "var(--radius-control)", ...(inContainer ? { position: "relative", insetInline: "auto", insetBlock: "auto", transform: "none" } : { zIndex: UI_Z_TOAST }) } as CSSProperties}
      toastOptions={{ closeButtonAriaLabel: "Close", classNames: { toast: "cn-toast" }, style: { boxShadow: UI_ELEVATION_FLOATING } }}
    />
  );
  if (inContainer) return toaster;
  return <div data-toaster-placement={frameInset ? "frame" : "viewport"} className="contents">{toaster}</div>;
}
