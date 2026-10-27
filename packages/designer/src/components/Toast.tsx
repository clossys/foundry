"use client";
import { useCallback, useMemo, useSyncExternalStore, type CSSProperties, type ReactElement, type ReactNode } from "react";
import {
  Text,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastList as AriaToastList,
  UNSTABLE_ToastRegion as AriaToastRegion,
  UNSTABLE_ToastStateContext as AriaToastStateContext,
  type QueuedToast,
  type ToastState,
  type UNSTABLE_ToastQueue as ToastQueue,
} from "react-aria-components";

/**
 * Where a toast stack draws. `viewport` portals react-aria-components' own
 * `ToastRegion` (landmark, F6 navigation, hover/focus timer pause) to
 * `document.body`. `container` renders the same queue in place through its
 * exported `ToastList`, so a bounded host such as a specimen cell shows the
 * toasts inside itself instead of over the page.
 */
export type ToastPlacement = "viewport" | "container";

export interface ToastRegionProps<T> {
  /** The queue whose visible toasts this region draws. */
  queue: ToastQueue<T>;
  /** @default "viewport" */
  placement?: ToastPlacement;
  /** Accessible label for the viewport landmark. */
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
  /** Placement marker the caller wants on the viewport root (viewport placement only). */
  "data-toaster-placement"?: string;
  /** Renders one queued toast. */
  children: (toast: QueuedToast<T>) => ReactElement;
}

/** react-aria-components' own `useToastQueue` contract, over React's external-store subscription. */
function useQueueState<T>(queue: ToastQueue<T>): ToastState<T> {
  const subscribe = useCallback((listener: () => void) => queue.subscribe(listener), [queue]);
  const snapshot = useCallback(() => queue.visibleToasts, [queue]);
  const visibleToasts = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(() => ({
    visibleToasts,
    add: (content, options) => queue.add(content, options),
    close: key => queue.close(key),
    pauseAll: () => queue.pauseAll(),
    resumeAll: () => queue.resumeAll(),
  }), [queue, visibleToasts]);
}

function ContainedToastList<T>({ queue, className, style, children }: Omit<ToastRegionProps<T>, "placement">) {
  const state = useQueueState(queue);
  if (state.visibleToasts.length === 0) return null;
  return (
    <AriaToastStateContext.Provider value={state as ToastState<unknown>}>
      <AriaToastList<T> className={className} style={style}>{({ toast }) => children(toast)}</AriaToastList>
    </AriaToastStateContext.Provider>
  );
}

/** A toast stack over one queue, drawn at the viewport edge or in place inside its container. */
export function ToastRegion<T>({ placement = "viewport", ...props }: ToastRegionProps<T>) {
  if (placement === "container") return <ContainedToastList {...props} />;
  const { queue, children, ...rest } = props;
  return <AriaToastRegion queue={queue} {...rest}>{({ toast }) => children(toast)}</AriaToastRegion>;
}

export interface ToastProps<T> {
  toast: QueuedToast<T>;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** One queued toast: focus management, the close slot and the auto-dismiss timer come from react-aria-components. */
export function Toast<T>({ toast, className, style, children }: ToastProps<T>) {
  return <AriaToast toast={toast} className={className} style={style}>{children}</AriaToast>;
}

export interface ToastContentProps {
  /** `alert` interrupts assistive technology; `status` waits its turn. */
  urgency: "alert" | "status";
  className?: string;
  children: ReactNode;
}

/**
 * A toast's announced body. react-aria-components' `ToastContent` defaults to
 * `role="alert"` for every toast; `urgency` passes the caller's own role and
 * live politeness, merged last over that default.
 */
export function ToastContent({ urgency, className, children }: ToastContentProps) {
  return (
    <AriaToastContent role={urgency} aria-live={urgency === "alert" ? "assertive" : "polite"} className={className}>
      {children}
    </AriaToastContent>
  );
}

export interface ToastTextProps {
  slot: "title" | "description";
  className?: string;
  children: ReactNode;
}

/** The toast's title or description, wired to its labelling and describing ids. */
export function ToastText({ slot, className, children }: ToastTextProps) {
  return <Text slot={slot} className={className}>{children}</Text>;
}
