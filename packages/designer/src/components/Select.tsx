import { Icon } from "./Icon.js";
import { useGlyph } from "./glyph-context.js";
import type { ReactNode } from "react";
import {
  Button as AriaButton,
  FieldError,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  SelectValue,
  Text,
  type SelectProps as AriaSelectProps,
  type ValidationResult,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import {
  UI_ALPHA_DISABLED,
  UI_ELEVATION_FLOATING,
  UI_RING_FOCUS,
  UI_Z_POPOVER,
} from "./internal/ui-vars.js";

export interface SelectOption {
  /** The value submitted/reported when this option is chosen. */
  id: string;
  /** What's shown for this option, both in the list and (once chosen) in the trigger. */
  label: ReactNode;
  /** Disables this one option without disabling the whole field. */
  isDisabled?: boolean;
  /**
   * Plain-text form of `label`, used for typeahead ("press 'p' to jump to
   * the first option starting with 'p'") and as the trigger's displayed
   * text. Required when `label` isn't already a plain string — see
   * react-aria-components' own `textValue` for why a non-string label
   * can't be read as text automatically.
   */
  textValue?: string;
}

export type SelectSize = "sm" | "md" | "lg";
/** `full` fills the row (the long-standing look); `compact` sizes the field to its trigger content. */
export type SelectWidth = "full" | "compact";

// Trigger padding and type step per size, matching Button's size scale; md is
// the long-standing default look.
const SIZE_CLASSES: Record<SelectSize, string> = {
  sm: "px-sm py-xs text-body-s",
  md: "px-md py-sm text-body",
  lg: "px-lg py-md text-body-l",
};

const WIDTH_CLASSES: Record<SelectWidth, string> = {
  full: "flex",
  compact: "inline-flex w-fit max-w-full",
};

export interface SelectProps
  extends Omit<AriaSelectProps<SelectOption>, "children" | "placeholder"> {
  /**
   * Required. Rendered as a real label, programmatically associated with
   * the trigger — the accessible-name path a screen reader announces, not
   * a `placeholder` standing in for it. Pass null only where the row already
   * names the control (a compact header toolbar, say) and supply `aria-label`
   * or `aria-labelledby` instead; react-aria-components wires either onto the
   * trigger. A select with none of the three throws.
   */
  label: ReactNode;
  /** Helper text below the field, read by assistive tech via `aria-describedby`. */
  description?: ReactNode;
  /**
   * Validation error text. Rendered only while the field `isInvalid`, and
   * wired to the trigger via `aria-describedby` so a screen reader
   * announces it.
   */
  errorMessage?: ReactNode | ((validation: ValidationResult) => ReactNode);
  /** Shown in the trigger when nothing is selected yet. @default "Select an option" */
  placeholder?: string;
  /** The list of choices, in order. */
  options: readonly SelectOption[];
  /** Merged onto the outer field wrapper. */
  className?: string;
  /** Merged onto the trigger button. */
  triggerClassName?: string;
  /** Trigger padding and type step. @default "md" */
  size?: SelectSize;
  /** `compact` sizes the field to its trigger content instead of filling the row. @default "full" */
  width?: SelectWidth;
}

/**
 * A labeled dropdown of mutually-exclusive options — the same label/
 * description/error surface as `TextField`, for a closed, single-choice set
 * instead of free text. Built on react-aria-components' `Select` composed
 * with its `Button`, `Popover`, and `ListBox`/`ListBoxItem` — NOT this
 * package's own `Button` component: an component composing another component is a layering
 * violation this package's `ladder.test.ts` (a repository-only test that does not ship) and README both call out (see
 * "Components compose no other component"). react-aria-components' `Select` supplies
 * the behavior that's hard to get right by hand: opening on click AND on
 * ArrowUp/ArrowDown/Enter/Space when focused, closing on Escape or an
 * outside click, moving the active option with the arrow keys, selecting
 * with Enter, typeahead-by-first-letter, and the
 * `aria-expanded`/`aria-haspopup`/`role="listbox"`/`aria-selected` wiring
 * a screen reader needs to announce all of it.
 *
 * `options` is a plain array rather than JSX children (unlike `Breadcrumb`
 * or `Menu`): a select's option set is close to always already data —
 * fetched, computed, or a fixed enum — rather than something a consumer
 * hand-writes as markup, so this shape avoids the ceremony of mapping an
 * array into child elements for the overwhelmingly common case.
 *
 * One gap in react-aria-components' own `Select`, worth knowing rather than
 * silently working around: the trigger button never carries `aria-invalid`
 * — only a `data-invalid` attribute on the outermost wrapper (a CSS styling
 * hook, not an accessibility one) plus `aria-describedby` linking the
 * trigger to the rendered error text. That's not an oversight this
 * component patches over: `<Button>`'s own `useButton` hook filters props
 * through an internal allowlist that excludes `aria-invalid` — passing it
 * as a prop is silently dropped before it ever reaches the DOM, not merely
 * unstyled. Forcing it through would mean reaching past props entirely
 * (an imperative ref effect setting the attribute after render), which
 * isn't worth the complexity here: `aria-describedby` already gets a
 * screen reader to the error text from the trigger, which is what actually
 * matters for this to be usable — `aria-invalid` beyond that is a nice-to
 * -have this component doesn't currently provide.
 */
export function Select({
  label,
  description,
  errorMessage,
  placeholder = "Select an option",
  options,
  className,
  triggerClassName,
  size = "md",
  width = "full",
  isDisabled,
  isInvalid,
  ...rest
}: SelectProps) {
  if (label == null && !rest["aria-label"]?.trim() && !rest["aria-labelledby"]?.trim()) {
    throw new TypeError("Select requires a label, aria-label or aria-labelledby.");
  }
  const checkGlyph = useGlyph("assets.icon-check");
  const expandGlyph = useGlyph("assets.icon-chevron-down");
  return (
    <AriaSelect
      {...rest}
      isDisabled={isDisabled}
      isInvalid={isInvalid}
      placeholder={placeholder}
      className={cx(WIDTH_CLASSES[width], "flex-col gap-xs", className)}
    >
      {label != null ? <Label className="text-body-s text-ink-secondary font-body">{label}</Label> : null}
      <AriaButton
        isDisabled={isDisabled}
        className={(renderProps) =>
          cx(
            "flex w-full items-center justify-between gap-sm rounded-control border bg-surface-raised text-ink-primary outline-none disabled:cursor-not-allowed",
            SIZE_CLASSES[size],
            isInvalid ? "border-status-danger" : "border-line-control",
            triggerClassName,
          )
        }
        style={(renderProps) => ({
          opacity: renderProps.isDisabled ? UI_ALPHA_DISABLED : undefined,
          boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined,
        })}
      >
        <SelectValue className="truncate">
          {({ isPlaceholder, selectedText }) =>
            isPlaceholder ? placeholder : selectedText
          }
        </SelectValue>
        <Icon glyph={expandGlyph} decorative size="sm" className="text-ink-muted" />
      </AriaButton>
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
        <ListBox
          items={options}
          className="flex max-h-64 flex-col gap-xs overflow-auto outline-none"
        >
          {(option) => (
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
                    <Icon glyph={checkGlyph} decorative size="sm" className="text-accent-text" />
                  ) : null}
                </>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
