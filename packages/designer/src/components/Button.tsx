import { useId, useState, type ReactElement } from "react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";
import { buttonClassName, controlStateStyle, type ControlGround } from "./button-classes.js";
import { cx } from "./internal/cx.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends AriaButtonProps {
  /**
   * Visual treatment. `primary` is the action-filled default action;
   * `secondary` is a bordered lower-emphasis action; `ghost` has no fill
   * or border until hovered; `danger` marks a destructive action;
   * `outline` is a page's secondary call to action: no fill, a hairline
   * inset edge in the surrounding ink, the same box as `primary`.
   * @default "primary"
   */
  variant?: ButtonVariant;
  /** @default "md" */
  size?: ButtonSize;
  /**
   * The ground the button sits on. The primary look changes with it
   * (the inverse plate takes the on-inverse ink and fill).
   * @default "base"
   */
  ground?: ControlGround;
  /** Explains an unavailable action to assistive technology when isDisabled is set. */
  disabledReason?: string;
  /** Optional description supplied directly by the host. */
  "aria-description"?: string;
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
 * component's own geometry, state-layer and focus styles apply first, then the
 * consumer's own `style` (object or render-prop function, matching
 * react-aria-components' own `style` shape) is spread on top, so a
 * property the consumer sets always wins over this component's default for
 * that same property.
 */
export function Button(props: ButtonProps) {
  const description = props.isDisabled ? (props.disabledReason ?? props["aria-description"]) : props["aria-description"];
  // Allocate a description id only when there is a description. Ordinary
  // actions retain their peer's server id allocation and markup.
  return description ? <DescribedButton {...props} /> : <ButtonControl {...props} />;
}

function DescribedButton(props: ButtonProps) {
  const descriptionId = useId();
  return <ButtonControl {...props} descriptionId={descriptionId} />;
}

function ButtonControl({
  variant = "primary",
  size = "md",
  ground = "base",
  disabledReason,
  "aria-description": ariaDescription,
  "aria-describedby": ariaDescribedBy,
  descriptionId,
  isDisabled,
  onPressStart,
  onPressEnd,
  className,
  style,
  children,
  ...rest
}: ButtonProps & { descriptionId?: string }) {
  const description = isDisabled ? (disabledReason ?? ariaDescription) : ariaDescription;
  const [pressed, setPressed] = useState(false);
  return (
    <AriaButton
      {...rest}
      isDisabled={isDisabled}
      aria-describedby={[ariaDescribedBy, description ? descriptionId : undefined].filter(Boolean).join(" ") || undefined}
      onPressStart={event => { setPressed(true); onPressStart?.(event); }}
      onPressEnd={event => { setPressed(false); onPressEnd?.(event); }}
      className={(renderProps) =>
        cx(
          buttonClassName(variant, size, ground),
          typeof className === "function" ? className(renderProps) : className,
        )
      }
      style={(renderProps) => ({
        ...controlStateStyle({ ...renderProps, isPressed: pressed }, { ground }),
        ...(typeof style === "function" ? style(renderProps) : style),
      })}
    >
      {!description
        ? (typeof children === "function" ? renderProps => truncatable(children(renderProps)) : truncatable(children))
        : renderProps => <>
            {truncatable(typeof children === "function" ? children(renderProps) : children)}
            {description ? <span id={descriptionId} hidden>{description}</span> : null}
          </>}
    </AriaButton>
  );
}

/*
 * A plain-text label sits in its own span so a label longer than the
 * container ends in an ellipsis on one line (the box is `whitespace-nowrap`
 * and `max-w-full`). Element children keep their own layout.
 */
function truncatable<T>(children: T): T | ReactElement {
  return typeof children === "string" ? <span className="min-w-0 truncate">{children}</span> : children;
}
