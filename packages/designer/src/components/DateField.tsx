import { forwardRef, type ReactNode, type Ref, type RefAttributes, type ReactElement } from "react";
import {
  Button as AriaButton,
  type DateFieldProps as AriaDateFieldProps,
  type DateValue,
  type ValidationResult,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { useTableTextEntry } from "./internal/table-text-entry.js";
import { DateField as IntentDateField, DateInput } from "./intent/date-field.js";
import { Description, FieldError, Label } from "./intent/field.js";

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
  /** Optional calendar trigger. Omit it to retain the standalone field anatomy.
   * The caller supplies a decorative glyph and an explicit accessible name.
   * In a date range, pass this only to the end field.
   */
  pickerTrigger?: { label: string; children: ReactNode };
  /** Merged onto the segmented date input itself. */
  inputClassName?: string;
}

/**
 * Built on the Intent UI date field (`./intent/date-field.tsx`: RAC `DateField` + `DateInput` +
 * `DateSegment` with Intent's field, segment and invalid styling) and Intent's `Label`,
 * `Description` and `FieldError`. This file stays a thin Foundry adapter (L4) only for the
 * `label`/`description`/`errorMessage`/`pickerTrigger` props, which the receipted DatePicker
 * composition (`catalog/rules/components.date-picker.json`) calls; the trigger takes the classes of
 * Intent's `DatePickerTrigger` button (its `touch-target` utility has no token here and is dropped).
 *
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
 * `isRequired` wiring identical in shape to every other field component here.
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
 * When used within RAC DatePicker or DateRangePicker, the existing field
 * context supplies values and changes. Preserve start/end slots for ranges.
 * An optional pickerTrigger renders a context-owned RAC Button; this field
 * owns its visual and focus treatment, while the parent owns open state.
 */
export const DateField = forwardRef(function DateField<T extends DateValue = DateValue>({
  label,
  description,
  errorMessage,
  inputClassName,
  pickerTrigger,
  onFocusChange,
  ...rest
}: DateFieldProps<T>, ref: Ref<HTMLDivElement>) {
  const onTableTextEntry = useTableTextEntry(onFocusChange);
  return (
    <IntentDateField {...rest} {...({ ref } as object)} onFocusChange={onTableTextEntry}>
      {state => {
        const input = <DateInput className={cx("*:data-[type=literal]:px-0", inputClassName)} />;
        return <>
          <Label>{label}</Label>
          {pickerTrigger ? <div data-slot="control" className="relative flex items-stretch *:data-[slot=control]:w-full">
            {input}
            <AriaButton
              type="button"
              data-slot="date-picker-trigger"
              aria-label={pickerTrigger.label}
              isDisabled={state.isDisabled || state.isReadOnly}
              className={cx(
                "grid place-content-center self-stretch rounded-lg border border-input outline-hidden",
                "pressed:text-foreground text-muted-foreground hover:text-foreground focus-visible:text-foreground",
                "focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-50",
                "px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)]",
                "*:size-5 sm:*:size-4",
              )}
            >{pickerTrigger.children}</AriaButton>
          </div> : input}
          {description ? <Description>{description}</Description> : null}
          <FieldError>{errorMessage}</FieldError>
        </>;
      }}
    </IntentDateField>
  );
}) as <T extends DateValue = DateValue>(props: DateFieldProps<T> & RefAttributes<HTMLDivElement>) => ReactElement;
