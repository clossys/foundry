import {
  Link as AriaLink,
  type LinkProps as AriaLinkProps,
} from "react-aria-components";
import type { ButtonSize, ButtonVariant } from "./Button.js";
import { buttonClassName } from "./button-classes.js";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "./internal/ui-vars.js";

export type LinkVariant = "default" | "muted" | "standalone";

export interface LinkProps extends AriaLinkProps {
  /**
   * Visual treatment. `default` reads as inline text — colored, underlined
   * on hover — the right choice inside a sentence or paragraph. `muted` is
   * lower-emphasis, for secondary chrome (a footer link, a "see also")
   * that shouldn't compete with primary content. `standalone` is for a
   * link that IS the whole clickable unit on its own — a card title, a nav
   * item — where a permanent underline would read as noise since there's
   * no surrounding prose to distinguish it from.
   * @default "default"
   */
  variant?: LinkVariant;
  /**
   * Renders the link with exactly the classes `Button` applies for this
   * variant, plus the same disabled opacity and focus indicator, instead of the
   * link `variant` classes. Semantics stay a link (`role="link"`, `href`,
   * `render`). Setting either this or `buttonSize` turns button mode on;
   * with neither set the link is unchanged.
   * @default "primary" (once button mode is on)
   */
  buttonVariant?: ButtonVariant;
  /**
   * Size of the button look, as for `Button`'s `size`. Setting either this
   * or `buttonVariant` turns button mode on.
   * @default "md" (once button mode is on)
   */
  buttonSize?: ButtonSize;
}

const BASE = "text-body font-body outline-none disabled:cursor-not-allowed";

const VARIANT_CLASSES: Record<LinkVariant, string> = {
  default: "text-ink-link underline decoration-transparent hover:decoration-current",
  muted: "text-ink-muted hover:text-ink-secondary",
  standalone: "text-ink-primary hover:underline",
};

/**
 * A navigable link. Built on react-aria-components' `Link` for its keyboard
 * interaction and `aria-disabled`/`aria-current` wiring — the same reason
 * `Button` and `TextField` are built on react-aria-components rather than
 * hand-rolled (see this package's README).
 *
 * Renders a real `<a href="...">` by default. A consumer whose app uses a
 * router with its own link component (one that intercepts clicks for
 * client-side navigation) can render that instead via react-aria-components'
 * own `render` prop — the escape hatch this component deliberately does NOT
 * paper over with a bespoke `as`/`component` prop of its own, since
 * react-aria-components already ships one that handles ref-forwarding and
 * prop-merging correctly:
 *
 * ```tsx
 * <Link render={(props) => <RouterLink {...props} to="/prompts" />}>
 *   Prompts
 * </Link>
 * ```
 *
 * `buttonVariant` / `buttonSize` give a link — including one rendered
 * through `render` — the same look as `Button`, since `Button` itself can
 * only render a `<button>`:
 *
 * ```tsx
 * <Link
 *   href="/prompts"
 *   buttonVariant="secondary"
 *   render={(props) => <RouterLink {...props} to="/prompts" />}
 * >
 *   Prompts
 * </Link>
 * ```
 */
export function Link({
  variant = "default",
  buttonVariant,
  buttonSize,
  className,
  style,
  ...rest
}: LinkProps) {
  const isButtonLook = buttonVariant !== undefined || buttonSize !== undefined;
  const lookClassName = isButtonLook
    ? buttonClassName(buttonVariant ?? "primary", buttonSize ?? "md")
    : [BASE, VARIANT_CLASSES[variant]].join(" ");
  return (
    <AriaLink
      {...rest}
      className={(renderProps) =>
        cx(
          lookClassName,
          typeof className === "function" ? className(renderProps) : className,
        )
      }
      // BASE sets `outline-none`, which removes the browser's own focus
      // ring. Something must put one back, or keyboard focus on a link is
      // invisible — a WCAG 2.4.7 failure, and a silent one, since nothing
      // about the rendered markup looks wrong. Every other interactive
      // atom pairs `outline-none` with this same token-driven ring on
      // `isFocusVisible`; this one did not, so a keyboard user tabbing
      // through a page had no idea where they were.
      style={(renderProps) => ({
        opacity: isButtonLook && renderProps.isDisabled ? UI_ALPHA_DISABLED : undefined,
        boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined,
        ...(typeof style === "function" ? style(renderProps) : style),
      })}
    />
  );
}
