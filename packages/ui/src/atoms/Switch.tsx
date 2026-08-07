import type { ReactNode } from "react";
import {
  Switch as AriaSwitch,
  type SwitchProps as AriaSwitchProps,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "./internal/ui-vars.js";

export interface SwitchProps extends Omit<AriaSwitchProps, "children"> {
  /** The visible label, rendered next to the switch itself. */
  children: ReactNode;
}

// No dimension token exists for a control's own affordance size (the track
// and thumb, as opposed to spacing around it) — see Checkbox and Avatar for
// the same reasoning. These are Tailwind's own built-in scale, not this
// package's token scale, used only for this reason.
const TRACK_BASE = "flex h-5 w-9 shrink-0 items-center rounded-pill border transition-colors";
const THUMB_BASE = "h-3.5 w-3.5 rounded-pill bg-surface-raised transition-transform";

/**
 * A binary on/off toggle. Built on react-aria-components' `Switch` for the
 * same reason `Button` and `TextField` are (see this package's README):
 * `role="switch"`/`aria-checked` wiring and Space/Enter activation that are
 * easy to get subtly wrong by hand, plus label association via a wrapping
 * `<label>` rather than a separate `for`/`id` pair to keep in sync.
 *
 * Semantically distinct from `Checkbox` even though both toggle a boolean:
 * a switch takes effect immediately (turning a setting on/off), while a
 * checkbox marks a pending selection that typically waits for a separate
 * submit/save action. `role="switch"` (not `role="checkbox"`) is what
 * communicates that distinction to assistive tech, which is exactly why
 * this is its own component built on react-aria-components' own `Switch`
 * rather than a `Checkbox` with different styling.
 */
export function Switch({ children, className, style, ...rest }: SwitchProps) {
  return (
    <AriaSwitch
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
            aria-hidden="true"
            className={cx(
              TRACK_BASE,
              renderProps.isSelected ? "border-accent bg-accent" : "border-line-base bg-surface-sunken",
              "px-0.5",
            )}
            style={{
              boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined,
            }}
          >
            <span
              className={cx(THUMB_BASE, renderProps.isSelected ? "translate-x-4" : "translate-x-0")}
            />
          </span>
          {children}
        </>
      )}
    </AriaSwitch>
  );
}
