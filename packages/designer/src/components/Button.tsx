import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";
import { useGlyph } from "./glyph-context.js";
import type { IconNode } from "../icons/types.js";
import { buttonClassName, type ControlGround } from "./button-classes.js";
import { Icon } from "./Icon.js";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED } from "./internal/ui-vars.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "tonal" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends AriaButtonProps {
  /**
   * Visual treatment. `primary` is the action-filled default action;
   * `secondary` is a bordered lower-emphasis action; `ghost` has no fill
   * or border until hovered; `danger` marks a destructive action;
   * `outline` is a page's secondary call to action: no fill, a hairline
   * inset edge in the surrounding ink, the same box as `primary`;
   * `tonal` is a tertiary call to action: a neutral tonal fill, no edge;
   * `quiet` is a chevron text button: no box, a trailing icon, a 44px tap
   * block, underlined on hover.
   * @default "primary"
   */
  variant?: ButtonVariant;
  /** @default "md" */
  size?: ButtonSize;
  /**
   * The ground the button sits on. The primary, tonal and quiet looks change with it
   * (the inverse plate takes the on-inverse ink and fill).
   * @default "base"
   */
  ground?: ControlGround;
  /**
   * `quiet` only: the trailing icon, decorative, after the label. Defaults
   * to `ChevronRight` from this package's icon set; `null` renders none.
   * Ignored by every other variant.
   */
  trailingIcon?: IconNode | null;
}

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
export function Button({
  variant = "primary",
  size = "md",
  ground = "base",
  trailingIcon,
  className,
  style,
  children,
  ...rest
}: ButtonProps) {
  const defaultTrailing = useGlyph("assets.icon-chevron-right");
  const trailing = variant === "quiet" ? (trailingIcon === undefined ? defaultTrailing : trailingIcon) : null;
  return (
    <AriaButton
      {...rest}
      className={(renderProps) =>
        cx(
          buttonClassName(variant, size, ground),
          typeof className === "function" ? className(renderProps) : className,
        )
      }
      style={(renderProps) => ({
        opacity: renderProps.isDisabled ? UI_ALPHA_DISABLED : undefined,
        outline: renderProps.isFocusVisible ? `var(--ui-border-focus, 2px) solid var(${ground === "inverse" ? "--color-focus-ring-on-inverse" : "--color-focus-ring"})` : undefined,
        outlineOffset: renderProps.isFocusVisible ? "var(--ui-focus-offset, 2px)" : undefined,
        ...(typeof style === "function" ? style(renderProps) : style),
      })}
    >
      {trailing === null
        ? children
        : (renderProps) => (
            <>
              {typeof children === "function" ? children(renderProps) : children}
              <Icon glyph={trailing} decorative size="sm" />
            </>
          )}
    </AriaButton>
  );
}
