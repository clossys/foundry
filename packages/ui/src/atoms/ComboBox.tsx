import type { ReactNode } from "react";
import {
  Button as AriaButton,
  ComboBox as AriaComboBox,
  FieldError,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Text,
  type ComboBoxProps as AriaComboBoxProps,
  type ValidationResult,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import {
  UI_ALPHA_DISABLED,
  UI_ELEVATION_FLOATING,
  UI_RING_FOCUS,
  UI_Z_POPOVER,
} from "./internal/ui-vars.js";

export interface ComboBoxOption {
  /** The value submitted/reported when this option is chosen. */
  id: string;
  /** What's shown for this option, both in the list and (once chosen) in the input. */
  label: ReactNode;
  /** Disables this one option without disabling the whole field. */
  isDisabled?: boolean;
  /**
   * Plain-text form of `label`, used for filtering and typeahead. Required
   * when `label` isn't already a plain string — the same requirement
   * `Select`'s own `SelectOption.textValue` documents.
   */
  textValue?: string;
}

export interface ComboBoxProps
  extends Omit<AriaComboBoxProps<ComboBoxOption>, "children" | "items" | "defaultItems"> {
  /**
   * Required. Rendered as a real `<label>`, programmatically associated
   * with the text input — the accessible-name path a screen reader
   * announces, the same convention `TextField`'s and `Select`'s own `label`
   * follow.
   */
  label: ReactNode;
  /** Helper text below the field, read by assistive tech via `aria-describedby`. */
  description?: ReactNode;
  /**
   * Validation error text. Rendered only while the field `isInvalid`, and
   * wired to the input via `aria-describedby`.
   */
  errorMessage?: ReactNode | ((validation: ValidationResult) => ReactNode);
  /** Shown inside the empty input. */
  placeholder?: string;
  /**
   * The full list of choices. Passed to react-aria-components' own
   * `ComboBox` as `defaultItems` (uncontrolled) so ITS built-in
   * language-sensitive "contains" filter (`useFilter`) narrows the list as
   * the user types — the same default a consumer can override with this
   * component's own `defaultFilter` passthrough prop for a different match
   * strategy (starts-with, fuzzy, ...).
   */
  options: readonly ComboBoxOption[];
  /** Merged onto the outer field wrapper. */
  className?: string;
  /** Merged onto the text input itself. */
  inputClassName?: string;
}

/**
 * A searchable, filterable single-choice field over a large option set —
 * `Select`'s sibling for when the option set is too long to scan as a
 * closed list, and the user instead types to narrow it. Built on
 * react-aria-components' `ComboBox` composed with its OWN `Input`,
 * `Button`, `Popover`, and `ListBox`/`ListBoxItem` — not this package's own
 * `Button` atom, the same "an atom composing another atom is a layering
 * violation" reasoning `Select`'s own doc comment documents.
 * react-aria-components' `ComboBox` supplies the behavior that's genuinely
 * hard to get right by hand: filtering the option list against the typed
 * text on every keystroke, opening the popover on input/focus/the trigger
 * button, moving the active option with the arrow keys while keeping focus
 * IN the text input (typing and navigating the list happen from the same
 * place, unlike `Select`'s closed-trigger listbox), selecting the active
 * option with Enter or a click, closing on Escape or an outside click, and
 * the `role="combobox"`/`aria-expanded`/`aria-controls`/`aria-activedescendant`
 * wiring a screen reader needs to announce all of it.
 *
 * `options` is a plain array, the same shape `Select`'s own `options` uses
 * (`{ id, label, isDisabled?, textValue? }`) rather than JSX children, for
 * the identical reason: a combo box's option set is close to always already
 * data, especially so here given the whole point of this component is
 * searching a set too large to hand-write as markup.
 */
export function ComboBox({
  label,
  description,
  errorMessage,
  placeholder,
  options,
  className,
  inputClassName,
  isDisabled,
  isInvalid,
  ...rest
}: ComboBoxProps) {
  return (
    <AriaComboBox
      {...rest}
      defaultItems={options}
      isDisabled={isDisabled}
      isInvalid={isInvalid}
      className={cx("flex flex-col gap-xs", className)}
    >
      <Label className="text-body-s text-ink-secondary font-body">{label}</Label>
      <div
        className={cx(
          "flex items-center gap-sm rounded-control border bg-surface-raised px-md py-sm",
          isInvalid ? "border-status-danger" : "border-line-base",
        )}
        style={{ opacity: isDisabled ? UI_ALPHA_DISABLED : undefined }}
      >
        <Input
          placeholder={placeholder}
          className={cx("flex-1 bg-transparent text-body text-ink-primary outline-none", inputClassName)}
          style={(renderProps) => ({
            boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined,
          })}
        />
        <AriaButton className="shrink-0 text-ink-muted outline-none" aria-label="Show suggestions">
          <span aria-hidden="true">▾</span>
        </AriaButton>
      </div>
      {description ? (
        <Text slot="description" className="text-caption text-ink-muted">
          {description}
        </Text>
      ) : null}
      <FieldError className="text-caption text-status-danger-text">{errorMessage}</FieldError>
      <Popover
        className="min-w-40 rounded-control border border-overlay-border bg-overlay-surface p-xs outline-none"
        style={{ boxShadow: UI_ELEVATION_FLOATING, zIndex: UI_Z_POPOVER }}
      >
        <ListBox className="flex max-h-64 flex-col gap-xs overflow-auto outline-none">
          {(option: ComboBoxOption) => (
            <ListBoxItem
              id={option.id}
              isDisabled={option.isDisabled}
              textValue={option.textValue ?? (typeof option.label === "string" ? option.label : undefined)}
              className={(renderProps) =>
                cx(
                  "flex cursor-default items-center justify-between gap-sm rounded-default px-sm py-xs text-body-s font-body outline-none",
                  renderProps.isDisabled ? "text-ink-muted" : "text-ink-primary",
                  renderProps.isFocused && !renderProps.isDisabled ? "bg-surface-selected" : "",
                )
              }
            >
              {({ isSelected }) => (
                <>
                  <span className="truncate">{option.label}</span>
                  {isSelected ? (
                    <span aria-hidden="true" className="text-accent-text">
                      ✓
                    </span>
                  ) : null}
                </>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaComboBox>
  );
}
