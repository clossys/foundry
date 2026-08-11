import type { ReactNode } from "react";
import {
  FieldError,
  Label,
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
  Text,
  type RadioGroupProps as AriaRadioGroupProps,
  type RadioProps as AriaRadioProps,
  type ValidationResult,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "./internal/ui-vars.js";

export interface RadioGroupProps extends Omit<AriaRadioGroupProps, "children"> {
  /**
   * Required. Rendered as the group's own label, programmatically associated
   * with the `role="radiogroup"` region the same way `TextField`'s `label`
   * is associated with its input — not a heading floating unattached above
   * the options.
   */
  label: ReactNode;
  /** Helper text below the label, read by assistive tech via `aria-describedby`. */
  description?: ReactNode;
  /**
   * Validation error text. Rendered — and wired to the group via
   * `aria-describedby` — only while the group `isInvalid`, the same
   * convention `TextField`'s and `Select`'s own `errorMessage` follow.
   */
  errorMessage?: ReactNode | ((validation: ValidationResult) => ReactNode);
  /** One or more `RadioGroup.Radio`s. */
  children: ReactNode;
  /** Merged onto the outer field wrapper. */
  className?: string;
}

/**
 * A single-choice control over a small, fixed set of mutually-exclusive
 * options — `Select`'s sibling for when every option should stay visible at
 * once rather than living behind a closed trigger (a handful of plan tiers,
 * a payment method, a delivery speed), the same distinction `Checkbox`
 * documents against `Switch` even though both are single-atom binary
 * toggles: the right choice here depends on how many options there are and
 * whether comparing them side by side matters, not on anything this
 * component decides for you.
 *
 * Built on react-aria-components' `RadioGroup` + `Radio`, which supply
 * roving-tabindex arrow-key navigation between options (Up/Down or
 * Left/Right, following `orientation`; Tab reaches the group once, not once
 * per option — the same roving-tabindex shape `Tabs`' own `TabList`/`Tab`
 * already use in this package), Space to select the focused option, and the
 * `role="radiogroup"`/`role="radio"`/`aria-checked` wiring a screen reader
 * needs — none of it reimplemented here. `children` is composable JSX
 * (`RadioGroup.Radio`s), not a data array like `Select`'s `options`: unlike
 * a select's closed list, a visible set of radio options routinely differs
 * option-by-option (per-option `description` text, a disabled option with
 * its own reason) in a way that reads more naturally as hand-written markup
 * than as a flat array of plain data — the same reasoning `Menu`/`Tabs`
 * already use for their own JSX-children shape.
 */
function RadioGroupRoot({
  label,
  description,
  errorMessage,
  children,
  className,
  ...rest
}: RadioGroupProps) {
  return (
    <AriaRadioGroup {...rest} className={cx("flex flex-col gap-xs", className)}>
      <Label className="text-body-s text-ink-secondary font-body">{label}</Label>
      <div className="flex flex-col gap-sm">{children}</div>
      {description ? (
        <Text slot="description" className="text-caption text-ink-muted">
          {description}
        </Text>
      ) : null}
      <FieldError className="text-caption text-status-danger-text">{errorMessage}</FieldError>
    </AriaRadioGroup>
  );
}

export interface RadioGroupRadioProps extends Omit<AriaRadioProps, "children"> {
  /** The visible label for this one option. */
  children: ReactNode;
  /** Optional helper text under this option's own label, distinct from the group's own `description`. */
  description?: ReactNode;
}

// No dimension token exists for a control's own affordance size — see
// `Checkbox`/`Switch`/`Avatar` for the same reasoning. Tailwind's own
// built-in scale, not this package's token scale, used only for this
// reason.
const DOT_BASE =
  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-pill border transition-colors motion-reduce:transition-none";

/**
 * One option within a `RadioGroup`. Named `RadioGroup.Radio`, matching
 * react-aria-components' own naming one level down — the same convention
 * `Table.Row`/`Table.Cell` already follow in this package (see `Table.tsx`'s
 * own doc comment).
 */
function RadioGroupRadio({ children, description, className, ...rest }: RadioGroupRadioProps) {
  return (
    <AriaRadio
      {...rest}
      className={(renderProps) =>
        cx(
          "flex items-start gap-sm text-body text-ink-primary outline-none disabled:cursor-not-allowed",
          renderProps.isDisabled ? "text-ink-muted" : "",
          typeof className === "function" ? className(renderProps) : className,
        )
      }
    >
      {(renderProps) => (
        <>
          <span
            aria-hidden="true"
            className={cx(
              DOT_BASE,
              renderProps.isSelected ? "border-accent" : "border-line-base bg-surface-raised",
              renderProps.isInvalid ? "border-status-danger" : "",
            )}
            style={{
              opacity: renderProps.isDisabled ? UI_ALPHA_DISABLED : undefined,
              boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined,
            }}
          >
            {renderProps.isSelected ? <span className="h-2 w-2 rounded-pill bg-accent" /> : null}
          </span>
          <span className="flex flex-col">
            <span>{children}</span>
            {description ? <span className="text-caption text-ink-muted">{description}</span> : null}
          </span>
        </>
      )}
    </AriaRadio>
  );
}

export const RadioGroup = Object.assign(RadioGroupRoot, { Radio: RadioGroupRadio });
