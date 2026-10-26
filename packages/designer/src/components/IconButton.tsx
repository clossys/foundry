import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";
import type { IconNode } from "../icons/types.js";
import {
  iconButtonClassName,
  type ControlGround,
  type IconButtonShape,
  type IconButtonSize,
} from "./button-classes.js";
import { Icon } from "./Icon.js";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED } from "./internal/ui-vars.js";

export interface IconButtonProps extends Omit<AriaButtonProps, "children" | "aria-label" | "aria-labelledby"> {
  /**
   * The control's accessible name, required: the glyph alone says nothing
   * to assistive technology, and this package ships no default copy. Pass
   * the consumer's own words ("Close", "Next slide").
   */
  label: string;
  /** The glyph, as `@clossys/designer/icons` data. Rendered decorative; `label` names the control. */
  icon: IconNode;
  /** `md` is a 44px box; `sm` a 36px box with a 44px hit area. @default "md" */
  size?: IconButtonSize;
  /** `circle` (pill radius) or `square` (control radius). @default "circle" */
  shape?: IconButtonShape;
  /** The ground the control sits on. @default "base" */
  ground?: ControlGround;
}

/**
 * An icon-only control: one decorative glyph in a circle or square with a
 * hairline edge, named by a required `label`. Built on react-aria-components'
 * `Button` (keyboard activation, focus management, `aria-disabled` wiring);
 * the look is `iconButtonClassName`, so a plain link can take the same one.
 * For controls a view owns (carousel or step navigation, a dialog close, an
 * accordion toggle); never the only action of a page. Pass `aria-pressed`
 * or `aria-expanded` for a toggle: the selected state fills the control.
 *
 * `className` is merged with `tailwind-merge`, so a conflicting consumer
 * class wins; `style` is merged after this component's disabled opacity.
 * `size`, `shape` and `ground` pass through as given: `iconButtonClassName`
 * owns their defaults, so the component and the class string cannot drift.
 */
export function IconButton({
  label,
  icon,
  size,
  shape,
  ground,
  className,
  style,
  ...rest
}: IconButtonProps) {
  return (
    <AriaButton
      {...rest}
      aria-label={label}
      className={(renderProps) =>
        cx(
          iconButtonClassName({ size, shape, ground }),
          typeof className === "function" ? className(renderProps) : className,
        )
      }
      style={(renderProps) => ({
        opacity: renderProps.isDisabled ? UI_ALPHA_DISABLED : undefined,
        ...(typeof style === "function" ? style(renderProps) : style),
      })}
    >
      <Icon glyph={icon} decorative size={size === "sm" ? "sm" : "md"} />
    </AriaButton>
  );
}
