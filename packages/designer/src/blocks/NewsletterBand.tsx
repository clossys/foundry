import {
  useEffect, useId, useRef,
  type CSSProperties, type FormEvent, type ReactNode,
} from "react";
import { Button } from "../components/Button.js";
import { Icon } from "../components/Icon.js";
import { TextField } from "../components/TextField.js";
import { cx } from "../components/internal/cx.js";
import { UI_LAYOUT_TAP_TARGET } from "../components/internal/ui-vars.js";
import { XCircle } from "../icons/XCircle.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.newsletter", "foundry/sections.newsletter");

export type NewsletterStatus = "idle" | "pending" | "sent" | "failed";

export interface NewsletterBandProps {
  emailLabel: string;
  submitLabel: string;
  pendingLabel: string;
  sentMessage: ReactNode;
  failedMessage: ReactNode;
  privacyNote?: ReactNode;
  hint?: ReactNode;
  layout?: "inline" | "stacked";
  status?: NewsletterStatus;
  /** Same-origin absolute path for native form submission. */
  action?: string;
  method?: "post";
  /** Technical form-data key. */
  name?: string;
  onSubmit?: (email: string, event: FormEvent<HTMLFormElement>) => void;
  ground?: SectionGround;
  "aria-labelledby"?: string;
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
}

const ACTION_PATTERN = /^\/(?!\/)[^\s\\\u0000-\u001f\u007f]*$/;

/** Controlled email capture using native validation and caller-supplied copy. */
export function NewsletterBand({
  emailLabel, submitLabel, pendingLabel, sentMessage, failedMessage,
  privacyNote, hint, layout = "inline", status = "idle", action, method = "post",
  name, onSubmit, ground = "base", "aria-labelledby": labelledBy,
  "aria-label": label, className, style,
}: NewsletterBandProps) {
  const fieldName = name === undefined ? "email" : name;
  if (action === undefined && onSubmit === undefined) {
    throw new TypeError("NewsletterBand: action or onSubmit is required");
  }
  if (action !== undefined && (typeof action !== "string" || !ACTION_PATTERN.test(action))) {
    throw new TypeError("NewsletterBand: action must be a same-origin path");
  }
  if (typeof fieldName !== "string" || fieldName.length === 0 || /\s/.test(fieldName)) {
    throw new TypeError("NewsletterBand: name must be a non-empty key without whitespace");
  }

  const formRef = useRef<HTMLFormElement>(null);
  const sentRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const failedId = useId();
  const hasHint = hint !== undefined && hint !== null && hint !== false;
  const inks = SECTION_GROUND_CLASSES[ground === "inverse" ? "base" : ground];

  useEffect(() => {
    if (status === "failed") formRef.current?.querySelector("input")?.focus();
  }, [status]);
  useEffect(() => {
    if (status === "sent") sentRef.current?.focus();
  }, [status]);

  function handle(event: FormEvent<HTMLFormElement>) {
    if (status === "pending") {
      event.preventDefault();
      return;
    }
    const value = new FormData(event.currentTarget).get(fieldName);
    const email = typeof value === "string" ? value.trim() : "";
    if (onSubmit !== undefined) {
      event.preventDefault();
      onSubmit(email, event);
    }
  }

  const form = (
    <form
      {...(ground === "inverse" ? {} : SECTION_STAMP)}
      ref={formRef}
      method={method}
      action={action}
      noValidate={false}
      aria-labelledby={labelledBy}
      aria-label={label}
      onSubmit={handle}
      className={cx("flex flex-col gap-sm", inks.surface, inks.primary, className)}
      style={style}
    >
      {status !== "sent" ? (
        <div className={layout === "stacked"
          ? "flex flex-col gap-sm max-w-[28rem]"
          : "grid grid-cols-1 gap-sm tablet:grid-cols-[1fr_auto] tablet:items-end max-w-[32rem]"}>
          <TextField
            type="email"
            name={fieldName}
            autoComplete="email"
            isRequired
            validationBehavior="native"
            label={emailLabel}
            isReadOnly={status === "pending"}
            isInvalid={status === "failed"}
            aria-describedby={[hasHint ? hintId : undefined, status === "failed" ? failedId : undefined].filter(Boolean).join(" ") || undefined}
          />
          <Button type="submit" size="md" isPending={status === "pending"} className="w-full tablet:w-auto" style={{ minBlockSize: UI_LAYOUT_TAP_TARGET }}>
            {status === "pending" ? pendingLabel : submitLabel}
          </Button>
        </div>
      ) : null}
      <div role="status" aria-live="polite" aria-atomic="true">
        {status === "pending" ? <span className="sr-only">{pendingLabel}</span> : null}
        {status === "sent" ? <div ref={sentRef} tabIndex={-1} className={cx("text-body", inks.primary)}>{sentMessage}</div> : null}
      </div>
      {status !== "sent" ? <>
        {hasHint ? <p id={hintId} className={cx("text-caption", inks.secondary)}>{hint}</p> : null}
        {status === "failed" ? (
          <p id={failedId} className="flex items-start gap-xs text-caption text-status-danger-text">
            <Icon glyph={XCircle} decorative size="sm" />{failedMessage}
          </p>
        ) : null}
        {privacyNote !== undefined && privacyNote !== null && privacyNote !== false
          ? <p className={cx("text-body-s", inks.secondary)}>{privacyNote}</p> : null}
      </> : null}
    </form>
  );
  return ground === "inverse" ? (
    <div {...SECTION_STAMP} className={SECTION_GROUND_CLASSES.inverse.surface}>
      <div className="rounded-panel bg-surface-raised p-lg text-ink-primary">{form}</div>
    </div>
  ) : form;
}
