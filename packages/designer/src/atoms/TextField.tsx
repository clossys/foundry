import type { ReactNode } from "react";
import {
  FieldError,
  Input,
  Label,
  Text,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
  type ValidationResult,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "./internal/ui-vars.js";

export interface TextFieldProps extends Omit<AriaTextFieldProps, "children"> {
  /**
   * Required. Rendered as a real `<label>`, programmatically associated
   * with the input via `for`/`id` (react-aria-components generates and
   * wires the id) — the accessible-name path a screen reader announces,
   * not a `placeholder` standing in for it.
   */
  label: ReactNode;
  /** Placeholder shown inside the empty input. Not a label substitute. */
  placeholder?: string;
  /** Helper text below the input, read by assistive tech via `aria-describedby`. */
  description?: ReactNode;
  /**
   * Validation error text. Rendered only while the field `isInvalid`, and
   * wired to the input via `aria-describedby` so a screen reader announces
   * it. Accepts react-aria-components' own render-prop form so a consumer
   * can compose it from `ValidationResult` (e.g. built-in `validate`).
   */
  errorMessage?: ReactNode | ((validation: ValidationResult) => ReactNode);
  /** Merged onto the outer field wrapper. */
  className?: string;
  /** Merged onto the `<input>` element itself. */
  inputClassName?: string;
}

/**
 * A labeled single-line text input. Built on react-aria-components'
 * `TextField` + `Label` + `Input` + `FieldError` for the accessibility
 * wiring that's easy to get subtly wrong by hand: label association,
 * `aria-describedby` linking the input to its description and error text,
 * and `aria-invalid`/`isRequired` state — see this package's README for
 * why that wiring is delegated rather than hand-rolled.
 */
export function TextField({
  label,
  placeholder,
  description,
  errorMessage,
  className,
  inputClassName,
  ...rest
}: TextFieldProps) {
  return (
    <AriaTextField {...rest} className={cx("flex flex-col gap-xs", className)}>
      <Label className="text-body-s text-ink-secondary font-body">{label}</Label>
      <Input
        placeholder={placeholder}
        className={(renderProps) =>
          cx(
            "rounded-control border bg-surface-raised px-md py-sm text-body text-ink-primary",
            renderProps.isInvalid ? "border-status-danger" : "border-line-base",
            inputClassName,
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
