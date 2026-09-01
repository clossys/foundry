import type { ReactNode } from "react";
import {
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastRegion as AriaToastRegion,
  Text,
  type QueuedToast,
} from "react-aria-components";
import { Button } from "../atoms/Button.js";
import { cx } from "../atoms/internal/cx.js";
import { UI_ELEVATION_FLOATING } from "../atoms/internal/ui-vars.js";
import { UI_Z_TOAST } from "./internal/shell-vars.js";
import { toastQueue, type ToastRecord, type ToastVariant } from "./internal/toast-queue.js";

export {
  toast,
  type ToastFunction,
  type ToastHandle,
  type ToastOptions,
  type ToastRecord,
  type ToastVariant,
} from "./internal/toast-queue.js";

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: "border-status-success bg-status-success-tint text-status-success-text",
  warning: "border-status-warning bg-status-warning-tint text-status-warning-text",
  danger: "border-status-danger bg-status-danger-tint text-status-danger-text",
  info: "border-status-info bg-status-info-tint text-status-info-text",
};

export interface ToasterProps {
  /**
   * Accessible label for the toast viewport landmark.
   * @default "Notifications"
   */
  "aria-label"?: string;
  /** Merged onto the toast viewport's own root element. */
  className?: string;
}

/**
 * The toast viewport — a runtime service, not a layout component (see this
 * package's README, "Placement rules": a portal, a queue, and an
 * imperative API put a toast stack outside the atoms/blocks/views/shell
 * ladder entirely). Ships from this subpath anyway, standalone rather than
 * as `Shell.Toaster`, for two reasons:
 *
 *   1. Its LIFETIME requirement is identical to `Shell`'s — it has to
 *      survive route changes so a toast queued just before a navigation is
 *      still there after it, the same reason `Shell` itself has to live in
 *      `layout.tsx` rather than `page.tsx`. That's why it ships from
 *      `/shell` instead of, say, its own top-level subpath.
 *   2. It is not itself part of `Shell`'s SLOT structure. `Toast`'s
 *      viewport renders through a React portal straight to `document.body`
 *      (via react-aria-components' `ToastRegion`) regardless of where in
 *      the component tree `<Toaster />` is mounted — nesting it inside
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
 * Built on react-aria-components' `ToastRegion`/`Toast`/`ToastContent` —
 * the installed version (1.20.0) ships them (as `UNSTABLE_*`, its own
 * naming for a still-evolving API surface, not a signal that the behavior
 * itself is unreliable). Between them these primitives supply: portal
 * rendering to `document.body`; per-toast focus management, including
 * moving focus to the next/previous toast when a focused one is removed;
 * pausing every visible toast's auto-dismiss timer while the region has
 * mouse hover OR keyboard focus anywhere inside it, and resuming when
 * both end (`useToastRegion`'s own `pauseAll`/`resumeAll` wiring — nothing
 * about hover/focus pausing is reimplemented here); and the region's own
 * `role="region"` landmark. None of that is hand-rolled here.
 *
 * One thing IS overridden from react-aria-components' own default: its
 * `ToastContent` always renders `role="alert"` (assertive) for every
 * variant, with no notion of a lower-urgency toast. That's wrong for this
 * package's success/info/warning toasts, which should interrupt a screen
 * reader user no more than a status update does — see `ToasterContent`
 * below, which passes its own `role`/`aria-live` to `ToastContent` instead
 * (`alert`/`assertive` for `danger` only; `status`/`polite` for the rest).
 * `ToastContent` accepts both as ordinary `HTMLAttributes`, and merges its
 * own react-aria-components-supplied defaults with whatever's passed to it
 * via `mergeProps(contextProps, props)` — the caller's value applies last,
 * so this override is a normal prop, not a hack.
 */
export function Toaster({ "aria-label": ariaLabel, className }: ToasterProps) {
  return (
    <AriaToastRegion
      queue={toastQueue}
      aria-label={ariaLabel}
      className={cx("fixed bottom-md end-md flex flex-col gap-sm", className)}
      style={{ zIndex: UI_Z_TOAST }}
    >
      {({ toast: queuedToast }) => <ToasterItem toast={queuedToast} />}
    </AriaToastRegion>
  );
}

function ToasterItem({ toast: queuedToast }: { toast: QueuedToast<ToastRecord> }) {
  const { variant, title, description } = queuedToast.content;
  return (
    <AriaToast
      toast={queuedToast}
      className={cx(
        "flex w-[min(24rem,90vw)] items-start gap-sm rounded-control border p-md",
        VARIANT_CLASSES[variant],
      )}
      style={{ boxShadow: UI_ELEVATION_FLOATING }}
    >
      <ToasterContent variant={variant}>
        <Text slot="title" className="block text-body font-body">
          {title}
        </Text>
        {description ? (
          <Text slot="description" className="mt-xs block text-body-s">
            {description}
          </Text>
        ) : null}
      </ToasterContent>
      {/*
        Plain `variant="ghost"` — its default `text-ink-primary`, not this
        toast's own status color. Matching the glyph's color to the variant
        would need either a fifth `Button` variant just for this one glyph
        or a `style` override on the color — not worth it for a "×" that
        already reads clearly in the default ink color.
      */}
      <Button slot="close" variant="ghost" size="sm" className="shrink-0 px-xs py-xs">
        <span aria-hidden="true">×</span>
      </Button>
    </AriaToast>
  );
}

/**
 * Wraps a toast's title/description in react-aria-components' own
 * `ToastContent`, overriding `role`/`aria-live` per variant — see
 * `Toaster`'s own docs above for why the override is necessary and why
 * it's safe (a normal prop, merged over react-aria-components' own default
 * via `mergeProps`, with this component's value applying last).
 */
function ToasterContent({ variant, children }: { variant: ToastVariant; children: ReactNode }) {
  const isError = variant === "danger";
  return (
    <AriaToastContent
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className="flex-1"
    >
      {children}
    </AriaToastContent>
  );
}
