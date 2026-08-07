import type { ReactNode } from "react";
import {
  Button as AriaButton,
  FieldError,
  Input,
  Label,
  SearchField as AriaSearchField,
  Text,
  type SearchFieldProps as AriaSearchFieldProps,
  type ValidationResult,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "./internal/ui-vars.js";

export interface SearchFieldProps extends Omit<AriaSearchFieldProps, "children"> {
  /**
   * Required. Rendered as a real `<label>`, programmatically associated
   * with the input — the same accessible-name path `TextField`'s own
   * `label` documents.
   */
  label: ReactNode;
  /** Placeholder shown inside the empty input. */
  placeholder?: string;
  /** Helper text below the input, read by assistive tech via `aria-describedby`. */
  description?: ReactNode;
  /**
   * Validation error text. Rendered only while the field `isInvalid`, and
   * wired to the input via `aria-describedby`.
   */
  errorMessage?: ReactNode | ((validation: ValidationResult) => ReactNode);
  /** Merged onto the outer field wrapper. */
  className?: string;
  /** Merged onto the `<input>` element itself. */
  inputClassName?: string;
}

/**
 * A search input with a built-in clear affordance — `TextField`'s sibling
 * for a query the user types and then clears, rather than a value that's
 * submitted as-is. Built on react-aria-components' `SearchField` + `Label`
 * + `Input` + `FieldError`, which supply what a hand-rolled search input
 * gets subtly wrong: a real `type="search"` input (native OS chrome — the
 * WebKit clear-x, `inputmode`, keyboard "search" affordance — that a plain
 * `type="text"` never gets); a clear BUTTON, exposed here by rendering
 * react-aria-components' own `Button` with no props of its own, since
 * `SearchField` wires its `aria-label` ("Clear search"), its `onPress`
 * (clearing the value AND refocusing the input), and its conditional
 * presence entirely through context — this component only decides WHEN to
 * render it (see below); Escape clearing the field (and, only once already
 * empty, letting Escape continue propagating — so an Escape that empties
 * the field first and dismisses a wrapping `Popover`/`Dialog` second still
 * works exactly as a keyboard user expects); and the
 * `aria-describedby`/`isRequired`/`isInvalid` wiring every other field atom
 * here shares.
 *
 * The clear button is rendered only while the field has a value (this
 * component's own `isEmpty` check on react-aria-components' render-prop
 * children, not a CSS visibility hack) — a clear control for an already-
 * empty field has nothing to do and would otherwise sit in the Tab order
 * doing nothing.
 */
export function SearchField({
  label,
  description,
  errorMessage,
  placeholder,
  className,
  inputClassName,
  ...rest
}: SearchFieldProps) {
  return (
    <AriaSearchField {...rest} className={cx("flex flex-col gap-xs", className)}>
      {({ isEmpty, isDisabled, isInvalid }) => (
        <>
          <Label className="text-body-s text-ink-secondary font-body">{label}</Label>
          <div className="relative flex items-center">
            <Input
              placeholder={placeholder}
              className={cx(
                "w-full rounded-control border bg-surface-raised py-sm pl-md pr-2xl text-body text-ink-primary",
                isInvalid ? "border-status-danger" : "border-line-base",
                inputClassName,
              )}
              style={(renderProps) => ({
                opacity: isDisabled ? UI_ALPHA_DISABLED : undefined,
                boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined,
              })}
            />
            {!isEmpty ? (
              <AriaButton className="absolute right-sm shrink-0 text-ink-muted outline-none">
                <span aria-hidden="true">×</span>
              </AriaButton>
            ) : null}
          </div>
          {description ? (
            <Text slot="description" className="text-caption text-ink-muted">
              {description}
            </Text>
          ) : null}
          <FieldError className="text-caption text-status-danger-text">{errorMessage}</FieldError>
        </>
      )}
    </AriaSearchField>
  );
}
