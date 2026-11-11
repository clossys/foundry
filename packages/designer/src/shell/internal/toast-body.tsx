"use client";
import { Button } from "../../components/preview-runtime/components/button/button.js";
import type { ToastRecord } from "./toast-queue.js";

/**
 * One toast's content inside sonner's toast: its title, its optional description and its optional
 * library-Button action. Sonner announces every toast through its own polite region (the Toaster's
 * `aria-live="polite"` section); sonner has no assertive option, so a danger toast's body is its own
 * `role="alert"` region and interrupts assistive technology as before.
 */
export function ToastBody({ record, onDone }: { record: ToastRecord; onDone: () => void }) {
  const { variant, title, description, action } = record;
  const urgent = variant === "danger";
  return (
    <div data-toast-part="content" data-variant={variant} className="flex flex-col gap-xs" {...(urgent ? { role: "alert", "aria-live": "assertive" as const } : {})}>
      <span data-toast-part="title" className="block text-body font-body">{title}</span>
      {description ? <span data-toast-part="description" className="block text-body-s">{description}</span> : null}
      {action ? (
        <Button data-toast-part="action" variant="secondary" size="sm" className="self-start" onPress={event => { action.onPress(event); onDone(); }} isDisabled={action.isDisabled}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
