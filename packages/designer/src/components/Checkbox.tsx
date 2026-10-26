import { Icon } from "./Icon.js";
import { useGlyph, useIndeterminateGlyph } from "./glyph-context.js";
import type { ReactNode } from "react";
import {
  Checkbox as AriaCheckbox,
  type CheckboxProps as AriaCheckboxProps,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "./internal/ui-vars.js";

export interface CheckboxProps extends Omit<AriaCheckboxProps, "children"> {
  /** The visible label, rendered next to the checkbox itself. */
  children: ReactNode;
}

// `rounded-default` (the `--radius-default` token), not `rounded-s` (the
// `--radius-s` token, one step smaller): Tailwind v4 already reserves the
// `rounded-s` utility name for a LOGICAL-direction radius ("start" corners
// only), so a token literally named `s` collides with it — `rounded-s`
// silently applies only two corners instead of all four, and this
// package's own `cx()` doesn't even recognize it as conflicting with
// another radius utility, since Tailwind classifies it into a different
// class group entirely. `rounded-default` has no such collision.
const BOX_BASE =
  "flex shrink-0 items-center justify-center rounded-default border transition-colors motion-reduce:transition-none";

/**
 * A checkbox, with support for the indeterminate ("some, not all, of a
 * group are selected") visual state a `DataTable` select-all checkbox
 * needs. Built on react-aria-components' `Checkbox` for the same reason
 * `Button` and `TextField` are (see this package's README): correct
 * `role="checkbox"`/`aria-checked` wiring (including `aria-checked="mixed"`
 * for indeterminate — easy to get subtly wrong by hand, since indeterminate
 * is a presentation-only state with no matching native HTML attribute
 * value), Space-key activation, and label association via a wrapping
 * `<label>` rather than a separate `for`/`id` pair to keep in sync.
 *
 * `isIndeterminate` is presentational only, per react-aria-components' own
 * contract: it doesn't change `isSelected`, so a consumer driving a
 * select-all checkbox from a list of rows is still responsible for setting
 * both `isIndeterminate` (some rows selected) and `isSelected` (all rows
 * selected) from its own selection state.
 */
export function Checkbox({ children, className, style, ...rest }: CheckboxProps) {
  const checkGlyph = useGlyph("assets.icon-check");
  const mixedGlyph = useIndeterminateGlyph();
  return (
    <AriaCheckbox
      {...rest}
      className={(renderProps) =>
        cx(
          "inline-flex items-center gap-sm text-body text-ink-primary disabled:cursor-not-allowed",
          typeof className === "function" ? className(renderProps) : className,
        )
      }
      style={(renderProps) => ({
        opacity: renderProps.isDisabled ? UI_ALPHA_DISABLED : undefined,
        ...(typeof style === "function" ? style(renderProps) : style),
      })}
    >
      {(renderProps) => (
        <>
          <span
            data-part="control-mark"
            aria-hidden="true"
            className={cx(
              BOX_BASE,
              renderProps.isSelected || renderProps.isIndeterminate
                ? "border-action bg-action text-ink-on-action"
                : "border-line-base bg-surface-raised",
              renderProps.isInvalid ? "border-status-danger" : "",
            )}
            style={{
              width: "var(--ui-control-mark)",
              height: "var(--ui-control-mark)",
              boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined,
            }}
          >
            {renderProps.isIndeterminate || renderProps.isSelected ? (
              <Icon
                glyph={renderProps.isIndeterminate ? mixedGlyph : checkGlyph}
                decorative
                style={{ width: "calc(var(--ui-control-mark) * 0.625)", height: "calc(var(--ui-control-mark) * 0.625)" }}
              />
            ) : null}
          </span>
          {children}
        </>
      )}
    </AriaCheckbox>
  );
}
