import type { ReactNode } from "react";
import { UNSTABLE_ToastQueue as AriaToastQueue } from "react-aria-components";

export type ToastVariant = "success" | "danger" | "info" | "warning";

/** What a queued toast actually holds — react-aria-components' `ToastQueue` is generic over this. */
export interface ToastRecord {
  title: ReactNode;
  description?: ReactNode;
  variant: ToastVariant;
}

export interface ToastOptions {
  /** A line of supporting copy under the title. */
  description?: ReactNode;
  /**
   * Milliseconds before this toast auto-dismisses. Pass `null` to disable
   * auto-dismiss for this toast — it then stays until dismissed by the
   * user (the close button) or by code (the returned handle, or
   * `toast.dismiss`/`toast.dismissAll`).
   * @default 5000
   */
  timeout?: number | null;
  /** Called once, when this toast leaves the queue for any reason — a timeout, the close button, or a `dismiss()` call. */
  onClose?: () => void;
}

/** Returned by every `toast(...)` call so the caller can dismiss it in response to a later event, without keeping the queue key around by hand. */
export interface ToastHandle {
  /** This toast's key in the underlying queue. */
  id: string;
  /** Removes this toast immediately, wherever it currently is (visible or queued). */
  dismiss: () => void;
}

const DEFAULT_TOAST_TIMEOUT_MS = 5000;

/**
 * The toast queue — one instance, module-scoped, shared by every caller of
 * `toast(...)` and by `<Toaster />`. A toast system is a singleton by
 * nature (see this package's README, "Placement rules" — a portal, a
 * queue, and an imperative API put it outside the atoms/blocks/views/shell
 * ladder entirely): there is exactly one notification queue per
 * application, the same way there is exactly one `Shell`. Creating it here
 * — at module scope, not inside a component — is what makes `toast.success(...)`
 * callable from anywhere (an event handler, a data-fetching effect, code
 * with no JSX in it at all) without a `useToast()` hook or a context
 * provider a consumer has to remember to wrap their tree in.
 *
 * `<Toaster />` subscribes to this exact instance via react-aria-components'
 * `useToastQueue`/`ToastRegion`; see `Toaster.tsx`.
 */
export const toastQueue = new AriaToastQueue<ToastRecord>({ maxVisibleToasts: 5 });

function addToast(variant: ToastVariant, title: ReactNode, options: ToastOptions = {}): ToastHandle {
  const { description, timeout, onClose } = options;
  const resolvedTimeout = timeout === null ? undefined : (timeout ?? DEFAULT_TOAST_TIMEOUT_MS);
  const id = toastQueue.add({ title, description, variant }, { timeout: resolvedTimeout, onClose });
  return { id, dismiss: () => toastQueue.close(id) };
}

export interface ToastFunction {
  /** Plain call: an `info`-variant toast. */
  (title: ReactNode, options?: ToastOptions): ToastHandle;
  success: (title: ReactNode, options?: ToastOptions) => ToastHandle;
  error: (title: ReactNode, options?: ToastOptions) => ToastHandle;
  warning: (title: ReactNode, options?: ToastOptions) => ToastHandle;
  info: (title: ReactNode, options?: ToastOptions) => ToastHandle;
  /** Removes a toast immediately, by the handle `toast(...)` returned or by its `id`. */
  dismiss: (handleOrId: ToastHandle | string) => void;
  /** Removes every toast, visible or queued. */
  dismissAll: () => void;
}

function toastImpl(title: ReactNode, options?: ToastOptions): ToastHandle {
  return addToast("info", title, options);
}

/**
 * The imperative API for adding a toast — `toast.success(...)`,
 * `toast.error(...)`, `toast.warning(...)`, `toast.info(...)`, or a plain
 * `toast(...)` (also `info`-variant; there is no "neutral" status token to
 * back a fifth, variant-less style). Works from anywhere in an application
 * that has mounted `<Toaster />` once — see that component's docs.
 */
export const toast: ToastFunction = Object.assign(toastImpl, {
  success: (title: ReactNode, options?: ToastOptions) => addToast("success", title, options),
  error: (title: ReactNode, options?: ToastOptions) => addToast("danger", title, options),
  warning: (title: ReactNode, options?: ToastOptions) => addToast("warning", title, options),
  info: (title: ReactNode, options?: ToastOptions) => addToast("info", title, options),
  dismiss: (handleOrId: ToastHandle | string) => toastQueue.close(typeof handleOrId === "string" ? handleOrId : handleOrId.id),
  dismissAll: () => toastQueue.clear(),
});
