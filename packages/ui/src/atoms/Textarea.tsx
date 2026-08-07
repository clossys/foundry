import type { ReactNode } from "react";
import {
  FieldError,
  Label,
  Text,
  TextArea,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
  type ValidationResult,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "./internal/ui-vars.js";

export interface TextareaProps extends Omit<AriaTextFieldProps, "children"> {
  /**
   * Required. Rendered as a real `<label>`, programmatically associated
   * with the textarea via `for`/`id` — the accessible-name path a screen
   * reader announces, not a `placeholder` standing in for it.
   */
  label: ReactNode;
  /** Placeholder shown inside the empty textarea. Not a label substitute. */
  placeholder?: string;
  /** Helper text below the textarea, read by assistive tech via `aria-describedby`. */
  description?: ReactNode;
  /**
   * Validation error text. Rendered only while the field `isInvalid`, and
   * wired to the textarea via `aria-describedby` so a screen reader
   * announces it. Accepts react-aria-components' own render-prop form so a
   * consumer can compose it from `ValidationResult` (e.g. built-in
   * `validate`).
   */
  errorMessage?: ReactNode | ((validation: ValidationResult) => ReactNode);
  /** Number of visible text rows. @default 3 */
  rows?: number;
  /** Merged onto the outer field wrapper. */
  className?: string;
  /** Merged onto the `<textarea>` element itself. */
  textareaClassName?: string;
}

/**
 * A labeled multi-line text input — `TextField`'s sibling for content that
 * runs longer than one line. Same label/description/error surface as
 * `TextField`, built the same way for the same reason: react-aria-components'
 * `TextField` + `Label` + `TextArea` + `FieldError` supply label
 * association, `aria-describedby` linking to description/error text, and
 * `aria-invalid`/`isRequired` wiring that's easy to get subtly wrong by
 * hand (see this package's README).
 *
 * A separate component from `TextField` rather than a `multiline` prop on
 * it: the two render different DOM elements (`<textarea>` vs `<input>`)
 * with different native behavior (`rows`, soft-wrapping, Enter inserting a
 * newline instead of submitting) — a structural difference, not a purely
 * visual one, so it gets its own component rather than a mode prop (see
 * this package's README, "the variant rule").
 */
export function Textarea({
  label,
  placeholder,
  description,
  errorMessage,
  rows = 3,
  className,
  textareaClassName,
  ...rest
}: TextareaProps) {
  return (
    <AriaTextField {...rest} className={cx("flex flex-col gap-xs", className)}>
      <Label className="text-body-s text-ink-secondary font-body">{label}</Label>
      <TextArea
        placeholder={placeholder}
        rows={rows}
        className={(renderProps) =>
          cx(
            "resize-y rounded-control border bg-surface-raised px-md py-sm text-body text-ink-primary",
            renderProps.isInvalid ? "border-status-danger" : "border-line-base",
            textareaClassName,
          )
        }
        style={(renderProps) => ({
          opacity: renderProps.isDisabled ? UI_ALPHA_DISABLED : undefined,
          boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined,
        })}
      />
      {description ? (
        <Text slot="description" className="text-caption text-ink-muted">
          {description}
        </Text>
      ) : null}
      <FieldError className="text-caption text-status-danger-text">{errorMessage}</FieldError>
    </AriaTextField>
  );
}
