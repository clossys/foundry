import type { ButtonProps } from "react-aria-components";
import { createElement, type ReactNode } from "react";
import { toast as sonnerToast } from "sonner";
import { ToastBody } from "./toast-body.js";

export type ToastVariant = "success" | "danger" | "info" | "warning";

/** What a toast holds: the title, the optional description, its variant and its optional action. */
export interface ToastRecord {
  title: ReactNode;
  description?: ReactNode;
  variant: ToastVariant;
  action?: ToastOptions["action"];
}

export interface ToastOptions {
  /** Host-authored action; the toast closes after the library Button invokes onPress. */
  action?: { label: ReactNode; onPress: NonNullable<ButtonProps["onPress"]>; isDisabled?: boolean };
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
  /** Called once, when this toast leaves for any reason — a timeout, the close button, or a `dismiss()` call. */
  onClose?: () => void;
}

/** Returned by every `toast(...)` call so the caller can dismiss it in response to a later event, without keeping the id around by hand. */
export interface ToastHandle {
  /** This toast's id in sonner's toast store. */
  id: string;
  /** Removes this toast immediately, wherever it currently is (visible or stacked). */
  dismiss: () => void;
}

const DEFAULT_TOAST_TIMEOUT_MS = 5000;
const SONNER_TYPE = { success: "success", danger: "error", info: "info", warning: "warning" } as const;
let nextToastId = 0;

/** Adds one toast to sonner's store for the Toaster whose `id` is `toasterId` (the app-wide Toaster when omitted). */
export function addToast(record: ToastRecord, options: Omit<ToastOptions, "action" | "description"> = {}, toasterId?: string): ToastHandle {
  const { timeout, onClose } = options;
  const id = `toast-${++nextToastId}`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    onClose?.();
  };
  // Sonner draws the toast and owns its timer and dismissal; the body is the title, description and
  // library-Button action, with the danger variant's own assertive announcement (see toast-body.tsx).
  sonnerToast[SONNER_TYPE[record.variant]](createElement(ToastBody, { record, onDone: () => sonnerToast.dismiss(id) }), {
    id,
    ...(toasterId ? { toasterId } : {}),
    duration: timeout === null ? Number.POSITIVE_INFINITY : (timeout ?? DEFAULT_TOAST_TIMEOUT_MS),
    onDismiss: close,
    onAutoClose: close,
  });
  return { id, dismiss: () => sonnerToast.dismiss(id) };
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
  /** Removes every toast. */
  dismissAll: () => void;
}

const add = (variant: ToastVariant, toasterId?: string) => (title: ReactNode, { description, action, ...options }: ToastOptions = {}) =>
  addToast({ title, description, variant, action }, options, toasterId);

/**
 * A toast function bound to one Toaster `id`, for a host that draws a bounded `Toaster` apart from the app-wide
 * one, such as a Studio specimen cell. Its toasts never reach the app-wide Toaster, and the app-wide `toast`
 * never reaches it (sonner filters each Toaster's toasts by `toasterId`).
 */
export function createToastScope(toasterId?: string): ToastFunction {
  return Object.assign(add("info", toasterId), {
    success: add("success", toasterId),
    error: add("danger", toasterId),
    warning: add("warning", toasterId),
    info: add("info", toasterId),
    dismiss: (handleOrId: ToastHandle | string) => { sonnerToast.dismiss(typeof handleOrId === "string" ? handleOrId : handleOrId.id); },
    dismissAll: () => { sonnerToast.dismiss(); },
  });
}

/** The app-wide toasts still in sonner's store (those with no `toasterId`), for a host or test that checks isolation. */
export function appToastIds(): string[] {
  return sonnerToast.getToasts().filter(entry => !("toasterId" in entry && entry.toasterId) && !("dismiss" in entry && entry.dismiss)).map(entry => String(entry.id));
}

/**
 * The imperative API for adding a toast — `toast.success(...)`,
 * `toast.error(...)`, `toast.warning(...)`, `toast.info(...)`, or a plain
 * `toast(...)` (also `info`-variant; there is no "neutral" status token to
 * back a fifth, variant-less style). Works from anywhere in an application
 * that has mounted `<Toaster />` once — see that component's docs. The store
 * behind it is sonner's own module-scoped one, so no `useToast()` hook or
 * provider is needed.
 */
export const toast: ToastFunction = createToastScope();
