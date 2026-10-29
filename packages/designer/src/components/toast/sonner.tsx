import { useLocale } from "react-aria-components";
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import type { QueuedToast, UNSTABLE_ToastQueue as ToastQueue } from "react-aria-components";
import { Button } from "../Button.js";
import { Icon } from "../icon/index.js";
import { toastClasses } from "../_parts/rail-sonner/index.js";
import { useFeedbackCopy, FEEDBACK_COPY_REFS, type FeedbackCopyResolver } from "../_parts/rail-feedback-copy/index.js";
import { Toast, ToastContent, ToastRegion, ToastText, type ToastPlacement } from "../_parts/rail-toast-primitives/index.js";
import { cn as cx } from "../_parts/rail-utils/index.js";


import { toastQueue, type ToastRecord, type ToastVariant } from "../_parts/rail-toast-queue/index.js";

export {
  toast,
  type ToastFunction,
  type ToastHandle,
  type ToastOptions,
  type ToastRecord,
  type ToastVariant,
} from "../_parts/rail-toast-queue/index.js";

const TYPE_ASSETS = {success: "assets.icon-success", warning: "assets.icon-warning", danger: "assets.icon-danger", info: "assets.icon-info"} as const;


export interface ToasterFrameInset { blockEnd: number; inlineEnd: number; direction: "ltr" | "rtl" }
const ToasterFrameInsetContext = createContext<ToasterFrameInset | null>(null);
export const ToasterFrameInsetProvider = ToasterFrameInsetContext.Provider;
function frameInsetStyle(inset: ToasterFrameInset | null): CSSProperties {
  if (!inset) return {};
  const edge = (px: number) => `calc(${px}px + var(--spacing-md))`;
  // Physical sides override both logical class insets, whatever direction the toast region itself resolves.
  return inset.direction === "rtl" ? { bottom: edge(inset.blockEnd), left: edge(inset.inlineEnd), right: "auto" } : { bottom: edge(inset.blockEnd), right: edge(inset.inlineEnd), left: "auto" };
}

export interface ToasterProps {
  
  "aria-label"?: string;
  
  className?: string;
  
  queue?: ToastQueue<ToastRecord>;
  closeLabel?: string;
  copy?: FeedbackCopyResolver;
  
  placement?: ToastPlacement;
}


export function Toaster({ "aria-label": ariaLabel, className, queue = toastQueue, placement = "viewport", closeLabel, copy }: ToasterProps) {
  const { direction } = useLocale();
  const resolve = useFeedbackCopy(copy);
  const frameInset = useContext(ToasterFrameInsetContext);
  if (placement === "container") {
    return (
      <ToastRegion style={{ direction }} queue={queue} placement="container" className={cx("flex flex-col gap-(--spacing-sm)", className)}>
        {queuedToast => <ToasterItem toast={queuedToast} queue={queue} closeLabel={closeLabel ?? resolve(FEEDBACK_COPY_REFS.toastClose)} />}
      </ToastRegion>
    );
  }
  return (
    <ToastRegion
      queue={queue}
      aria-label={ariaLabel}
      className={cx("fixed bottom-(--spacing-lg) end-4 z-(--ui-z-toast) flex flex-col gap-(--spacing-sm)", className)}
      style={{ direction: frameInset?.direction ?? direction, ...frameInsetStyle(frameInset) }}
      data-toaster-placement={frameInset ? "frame" : "viewport"}
    >
      {queuedToast => <ToasterItem toast={queuedToast} queue={queue} closeLabel={closeLabel ?? resolve(FEEDBACK_COPY_REFS.toastClose)} />}
    </ToastRegion>
  );
}

function ToasterItem({ toast: queuedToast, queue, closeLabel }: { toast: QueuedToast<ToastRecord>; queue: ToastQueue<ToastRecord>; closeLabel: string }) {
  const { variant, title, description, action } = queuedToast.content;
  return (
    <Toast
      toast={queuedToast}
      className={cx(
        toastClasses,
      )}
      
    >
      <Icon asset={TYPE_ASSETS[variant]} decorative size="sm" />
      <ToasterContent variant={variant}>
        <ToastText slot="title" className="block text-(length:--text-sm) font-(family-name:--font-body)">
          {title}
        </ToastText>
        {description ? (
          <ToastText slot="description" className="mt-(--spacing-xs) block text-(length:--text-xs)">
            {description}
          </ToastText>
        ) : null}
        {action ? <Button data-toast-part="action" variant="secondary" size="sm" onPress={event => { action.onPress(event); queue.close(queuedToast.key); }} isDisabled={action.isDisabled}>
          {action.label}
        </Button> : null}
      </ToasterContent>
      {}
      <Button aria-label={closeLabel} slot="close" variant="ghost" size="sm" className="shrink-0 px-(--spacing-xs) py-(--spacing-xs)">
        <span>{closeLabel}</span>
      </Button>
    </Toast>
  );
}


function ToasterContent({ variant, children }: { variant: ToastVariant; children: ReactNode }) {
  const isError = variant === "danger";
  return (
    <ToastContent urgency={isError ? "alert" : "status"} className="flex-1">
      {children}
    </ToastContent>
  );
}
