import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ContextType, type CSSProperties, type ReactNode } from "react";
import {
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastRegion as AriaToastRegion,
  UNSTABLE_ToastStateContext as AriaToastStateContext,
  Text,
  type QueuedToast,
  type UNSTABLE_ToastQueue as ToastQueue,
} from "react-aria-components";
import { Button } from "../components/Button.js";
import { cx } from "../components/internal/cx.js";
import { UI_ELEVATION_FLOATING } from "../components/internal/ui-vars.js";
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

/**
 * Viewport-edge distances, in px, of the area a frame reserves for toasts (its stage). A frame supplies it so the
 * portalled viewport anchors to the stage corner instead of the window corner, clear of the frame's header and dock.
 * Internal to the frame contract; not a public prop.
 */
export interface ToasterFrameInset { blockEnd: number; inlineEnd: number; direction: "ltr" | "rtl" }
const ToasterFrameInsetContext = createContext<ToasterFrameInset | null>(null);
export const ToasterFrameInsetProvider = ToasterFrameInsetContext.Provider;
function frameInsetStyle(inset: ToasterFrameInset | null): CSSProperties {
  if (!inset) return {};
  const edge = (px: number) => `calc(${px}px + var(--spacing-md))`;
  // Physical sides override both logical class insets, whatever direction the toast region itself resolves.
  return inset.direction === "rtl" ? { bottom: edge(inset.blockEnd), left: edge(inset.inlineEnd), right: "auto" } : { bottom: edge(inset.blockEnd), right: edge(inset.inlineEnd), left: "auto" };
}

/**
 * A specimen-local queue for Studio's component specimens. Under it the Toaster draws that queue in place, inside the
 * specimen's own cell, instead of portalling the app-wide queue to `document.body`: react-aria-components' ToastRegion
 * always portals, and this package does not depend on react-aria's portal provider. Internal; not a public prop.
 */
const ToasterSpecimenQueueContext = createContext<ToastQueue<ToastRecord> | null>(null);
export const ToasterSpecimenQueueProvider = ToasterSpecimenQueueContext.Provider;

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
 * imperative API put a toast stack outside the components/blocks/views/shell
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
  const frameInset = useContext(ToasterFrameInsetContext);
  const specimenQueue = useContext(ToasterSpecimenQueueContext);
  if (specimenQueue) return <SpecimenToaster queue={specimenQueue} aria-label={ariaLabel} className={className} />;
  return (
    <AriaToastRegion
      queue={toastQueue}
      aria-label={ariaLabel}
      className={cx("fixed bottom-md end-md flex flex-col gap-sm", className)}
      style={{ zIndex: UI_Z_TOAST, ...frameInsetStyle(frameInset) }}
      data-toaster-placement={frameInset ? "frame" : "viewport"}
    >
      {({ toast: queuedToast }) => <ToasterItem toast={queuedToast} queue={toastQueue} />}
    </AriaToastRegion>
  );
}

/**
 * The same toasts drawn in place from a specimen-local queue: react-aria-components' own Toast, given the queue's
 * state the way its `useToastQueue` builds it, listed as its ToastList lists them. No portal, no viewport placement,
 * and the app-wide queue is never read or written.
 */
function SpecimenToaster({ queue, "aria-label": ariaLabel, className }: ToasterProps & { queue: ToastQueue<ToastRecord> }) {
  const subscribe = useCallback((onChange: () => void) => queue.subscribe(onChange), [queue]);
  const snapshot = useCallback(() => queue.visibleToasts, [queue]);
  const visibleToasts = useSyncExternalStore(subscribe, snapshot, snapshot);
  const state = useMemo((): NonNullable<ContextType<typeof AriaToastStateContext>> => ({
    visibleToasts,
    add: (content, options) => queue.add(content, options),
    close: key => queue.close(key),
    pauseAll: () => queue.pauseAll(),
    resumeAll: () => queue.resumeAll(),
  }), [queue, visibleToasts]);
  return (
    <div role="region" aria-label={ariaLabel ?? "Notifications"} className={cx("flex flex-col gap-sm", className)} data-toaster-placement="specimen">
      <AriaToastStateContext.Provider value={state}>
        <ol style={{ display: "contents" }}>
          {visibleToasts.map(queuedToast => <li key={queuedToast.key} style={{ display: "contents" }}><ToasterItem toast={queuedToast} queue={queue} /></li>)}
        </ol>
      </AriaToastStateContext.Provider>
    </div>
  );
}

function ToasterItem({ toast: queuedToast, queue }: { toast: QueuedToast<ToastRecord>; queue: ToastQueue<ToastRecord> }) {
  const { variant, title, description, action } = queuedToast.content;
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
        {action ? <Button data-toast-part="action" variant="secondary" size="sm" onPress={event => { action.onPress(event); queue.close(queuedToast.key); }} isDisabled={action.isDisabled}>
          {action.label}
        </Button> : null}
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
