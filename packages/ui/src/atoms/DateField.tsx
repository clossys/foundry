import type { ReactNode } from "react";
import {
  DateField as AriaDateField,
  DateInput,
  DateSegment,
  FieldError,
  Label,
  Text,
  type DateFieldProps as AriaDateFieldProps,
  type DateValue,
  type ValidationResult,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "./internal/ui-vars.js";

export interface DateFieldProps<T extends DateValue = DateValue>
  extends Omit<AriaDateFieldProps<T>, "children"> {
  /**
   * Required. Rendered as a real `<label>`, programmatically associated
   * with the segmented date input — the same accessible-name path
   * `TextField`'s own `label` documents, not a `placeholder` standing in
   * for it (a date field has no placeholder text of its own at all; each
   * segment shows its own unit — `mm`, `dd`, `yyyy` — as a placeholder
   * instead).
   */
  label: ReactNode;
  /** Helper text below the input, read by assistive tech via `aria-describedby`. */
  description?: ReactNode;
  /**
   * Validation error text. Rendered only while the field `isInvalid`, and
   * wired to the input via `aria-describedby` so a screen reader announces
   * it — the same convention `TextField`'s own `errorMessage` follows.
   */
  errorMessage?: ReactNode | ((validation: ValidationResult) => ReactNode);
  /** Merged onto the outer field wrapper. */
  className?: string;
  /** Merged onto the segmented date input itself. */
  inputClassName?: string;
}

/**
 * A segmented, keyboard-editable date entry — the same label/description/
 * error surface `TextField` bundles with its own `<input>`, for a date
 * value instead of free text. Built on react-aria-components' `DateField` +
 * `DateInput` + `DateSegment`, which supply what's genuinely hard to get
 * right by hand: each unit (month/day/year, and time units for a
 * `granularity` finer than `"day"`) as its own focusable segment, arrow-key
 * increment/decrement per segment, automatic advance to the next segment on
 * a complete entry (typing "3" in the month segment of an MM/DD/YYYY field
 * jumps to the day segment), locale-correct segment ORDER and separators
 * (`DateInput`'s `children` render prop is called once per segment in
 * locale order, not a fixed MM/DD/YYYY layout this component would
 * otherwise have to hardcode), and `aria-invalid`/`aria-describedby`/
 * `isRequired` wiring identical in shape to every other field atom here.
 *
 * `value`/`defaultValue` are react-stately `DateValue`s (a `CalendarDate`,
 * `CalendarDateTime`, or `ZonedDateTime`), not a native JS `Date` or an ISO
 * string — the same calendar-aware representation react-aria-components'
 * date components are all built around, since a plain `Date` has no way to
 * represent "just a date" without smuggling in a timezone. Constructing one
 * needs `@internationalized/date` (`parseDate`, `CalendarDate`, ...) — a
 * REAL runtime dependency of this package, not merely a type-only import:
 * react-aria-components' own date components use it internally, but a
 * consumer who wants an initial or controlled `value` at all still has to
 * import it directly, so it ships here as a `dependencies` entry rather
 * than staying an unlisted transitive of `react-aria-components`.
 *
 * A full `DatePicker` (this field plus a calendar-grid popover) was
 * considered and deliberately NOT built here instead: react-aria-components'
 * own `DatePicker` composes a `Calendar` internally, and this package has no
 * `Calendar` atom — it's one of the components explicitly excluded from
 * this ladder for now (see the README, "What's deliberately not here").
 * Shipping `DatePicker` would mean building that calendar grid (month
 * navigation, a day grid, keyboard paging) as an unavoidable side effect of
 * a component this package wasn't asked for, rather than as its own
 * deliberate addition later. `DateField` alone — direct keyboard entry, no
 * calendar — is already a complete, independently useful control, and
 * matches what this rung of the ladder was scoped to add.
 */
export function DateField<T extends DateValue = DateValue>({
  label,
  description,
  errorMessage,
  className,
  inputClassName,
  ...rest
}: DateFieldProps<T>) {
  return (
    <AriaDateField {...rest} className={cx("flex flex-col gap-xs", className)}>
      <Label className="text-body-s text-ink-secondary font-body">{label}</Label>
      <DateInput
        className={(renderProps) =>
          cx(
            "flex items-center gap-0.5 rounded-control border bg-surface-raised px-md py-sm text-body text-ink-primary",
            renderProps.isInvalid ? "border-status-danger" : "border-line-base",
            inputClassName,
          )
        }
        style={(renderProps) => ({
          opacity: renderProps.isDisabled ? UI_ALPHA_DISABLED : undefined,
          boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined,
        })}
      >
        {(segment) => (
          <DateSegment
            segment={segment}
            className={(renderProps) =>
              cx(
                "rounded-default px-0.5 text-body tabular-nums outline-none",
                renderProps.isPlaceholder ? "text-ink-muted" : "text-ink-primary",
                renderProps.isFocused ? "bg-surface-selected" : "",
              )
            }
          />
        )}
      </DateInput>
      {description ? (
        <Text slot="description" className="text-caption text-ink-muted">
          {description}
        </Text>
      ) : null}
      <FieldError className="text-caption text-status-danger-text">{errorMessage}</FieldError>
    </AriaDateField>
  );
}
