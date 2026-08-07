import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "./internal/ui-vars.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends AriaButtonProps {
  /**
   * Visual treatment. `primary` is the accent-filled default action;
   * `secondary` is a bordered lower-emphasis action; `ghost` has no fill
   * or border until hovered; `danger` marks a destructive action.
   * @default "primary"
   */
  variant?: ButtonVariant;
  /** @default "md" */
  size?: ButtonSize;
}

const BASE =
  "inline-flex items-center justify-center gap-sm rounded-control text-body font-body transition-colors outline-none disabled:cursor-not-allowed";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-ink-on-accent hover:bg-accent-hover",
  secondary: "bg-surface-raised text-ink-primary border border-line-base hover:bg-surface-sunken",
  ghost: "text-ink-primary hover:bg-surface-sunken",
  danger: "bg-status-danger text-ink-on-accent hover:bg-status-danger-text",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-sm py-xs text-body-s",
  md: "px-md py-sm text-body",
  lg: "px-lg py-md text-body-l",
};

/**
 * A pressable action. Built on react-aria-components' `Button` for its
 * keyboard interaction (Enter/Space activation), focus management, and
 * `role="button"` + `aria-disabled` wiring — behavior that is easy to get
 * subtly wrong by hand (see this package's README for why).
 *
 * `className` is merged with `tailwind-merge` (via the internal `cx`
 * helper), so a conflicting utility passed by the consumer always wins
 * over this component's own defaults. `style` is merged the same way: this
 * component's own disabled-opacity/focus-ring styles apply first, then the
 * consumer's own `style` (object or render-prop function, matching
 * react-aria-components' own `style` shape) is spread on top, so a
 * property the consumer sets always wins over this component's default for
 * that same property.
 */
export function Button({ variant = "primary", size = "md", className, style, ...rest }: ButtonProps) {
  return (
    <AriaButton
      {...rest}
      className={(renderProps) =>
        cx(
          BASE,
          SIZE_CLASSES[size],
          VARIANT_CLASSES[variant],
          typeof className === "function" ? className(renderProps) : className,
        )
      }
      style={(renderProps) => ({
        opacity: renderProps.isDisabled ? UI_ALPHA_DISABLED : undefined,
        boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined,
        ...(typeof style === "function" ? style(renderProps) : style),
      })}
    />
  );
}
