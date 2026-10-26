import { useId } from "react";
import type { FieldProps } from "./Field.js";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED } from "./internal/ui-vars.js";

/** Static counterpart for the existing server entry point. The client Field
 * uses RAC; this entry retains the arbitrary-control render bridge without
 * requiring a client-only peer at module load, like Avatar.server. */
export function Field({ label, description, errorMessage, isInvalid = false,
  isRequired = false, isDisabled = false, children, className, style }: FieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = isInvalid && errorMessage ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  return <div className={cx("flex flex-col gap-xs", className)} style={{ opacity: isDisabled ? UI_ALPHA_DISABLED : undefined, ...style }}>
    <label htmlFor={id} className="text-body-s text-ink-secondary font-body">{label}</label>
    {children({ id, "aria-describedby": describedBy,
      ...(isInvalid ? { "aria-invalid": true as const } : {}),
      ...(isRequired ? { "aria-required": true as const } : {}),
      ...(isDisabled ? { disabled: true as const, "aria-disabled": true as const } : {}),
    })}
    {description ? <span id={descriptionId} className="text-caption text-ink-muted">{description}</span> : null}
    {errorId ? <span id={errorId} className="text-caption text-status-danger-text">{errorMessage}</span> : null}
  </div>;
}
