import { useState } from "react";
import {
  ToggleButton as AriaToggleButton,
  type ToggleButtonProps as AriaToggleButtonProps,
} from "react-aria-components";
import type { ButtonSize } from "./Button.js";
import { buttonLookClassName, iconButtonClassName, controlSizeStyle, controlStateStyle, type ControlGround, type ControlAppearanceVariant } from "./button-classes.js";
import { cx } from "./internal/cx.js";

export type ToggleButtonShape = "text" | "icon-only";

export interface ToggleButtonProps extends AriaToggleButtonProps {
  /**
   * The resting look, the `Button` look of the same name. Selected fills
   * with the action colour on every variant except `quiet` (a persistent
   * underline) and `primary` (already action-filled: an inset ring in its
   * own ink marks it).
   * @default "secondary"
   */
  variant?: ControlAppearanceVariant;
  /** @default "md" */
  size?: ButtonSize;
  /** The ground the toggle sits on; selected on `inverse` takes the inverse action fill. @default "base" */
  ground?: ControlGround;
  /**
   * `icon-only` draws the square icon control (`IconButton`'s look) around
   * one decorative glyph passed as `children` (an `Icon` with `decorative`);
   * the toggle then needs an `aria-label` or `aria-labelledby`.
   * @default "text"
   */
  shape?: ToggleButtonShape;
  /**
   * A change is in flight: the toggle stays focusable and undimmed, marks
   * `data-pending` (as `Button` does) and ignores presses until it clears.
   * Applies to a standalone toggle; inside a `ToggleGroup` the group owns
   * selection.
   */
  isPending?: boolean;
}

const SELECTED: Record<"base" | "inverse", string> = {
  base: "bg-action text-ink-on-action border-action hover:bg-action-hover",
  inverse: "bg-action-on-inverse text-ink-primary border-transparent hover:bg-action-on-inverse-hover",
};

function selectedClassName(variant: ControlAppearanceVariant, ground: ControlGround): string {
  if (variant === "quiet") return "underline";
  if (variant === "primary") return "ring-2 ring-inset ring-current";
  return SELECTED[ground === "inverse" ? "inverse" : "base"];
}

/** The icon control's own selected fill is the ground's opposite; a toggle binds selected to the action colour instead. */
const iconToggleClassName = (size: ButtonSize, ground: ControlGround): string =>
  iconButtonClassName({ size, shape: "square", ground })
    .split(" ")
    .filter((name) => !name.startsWith("aria-pressed:") && !name.startsWith("aria-expanded:"))
    .join(" ");

/**
 * A pressable on/off action: the `Button` look, with its selected state
 * bound to the action colour, as `Checkbox`, `Switch` and `RadioGroup` bind
 * theirs. Built on react-aria-components' `ToggleButton` for `aria-pressed`
 * wiring, Enter/Space activation, focus management and group membership.
 * Distinct from `Switch` (a setting that takes effect, `role="switch"`): a
 * toggle button is a pressed/unpressed action such as Bold in a toolbar.
 *
 * `className` and `style` merge like `Button`'s: the consumer's conflicting
 * class or property wins. The focus outline and disabled opacity match
 * `Button` exactly; colour changes are instant under reduced motion.
 */
export function ToggleButton({
  variant = "secondary",
  size = "md",
  ground = "base",
  shape = "text",
  isPending = false,
  isSelected,
  defaultSelected = false,
  onChange,
  className,
  style,
  children,
  ...rest
}: ToggleButtonProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultSelected);
  const controlled = isSelected !== undefined;
  const look = shape === "icon-only" ? iconToggleClassName(size, ground) : buttonLookClassName(variant, size, ground);
  return (
    <AriaToggleButton
      {...rest}
      isSelected={controlled ? isSelected : uncontrolled}
      onChange={(next) => {
        if (isPending) return;
        if (!controlled) setUncontrolled(next);
        onChange?.(next);
      }}
      data-pending={isPending || undefined}
      className={(renderProps) =>
        cx(
          look,
          renderProps.isSelected && (shape === "icon-only" ? SELECTED[ground === "inverse" ? "inverse" : "base"] : selectedClassName(variant, ground)),
          typeof className === "function" ? className(renderProps) : className,
        )
      }
      style={(renderProps) => ({
        ...controlSizeStyle(size),
        ...(shape === "icon-only" ? { inlineSize: `var(--ui-control-h-${size})` } : {}),
        ...controlStateStyle(renderProps, { ground }),
        ...(typeof style === "function" ? style(renderProps) : style),
      })}
    >
      {children}
    </AriaToggleButton>
  );
}
