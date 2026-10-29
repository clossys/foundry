import type { LinkProps as AriaLinkProps } from "react-aria-components";
import type { ButtonSize } from "./Button.js";
import type { ControlAppearanceVariant } from "./button-classes.js";
import type { ControlGround } from "./button-classes.js";

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
  buttonVariant?: ControlAppearanceVariant;
  /**
   * Size of the button look, as for `Button`'s `size`. Setting either this
   * or `buttonVariant` turns button mode on.
   * @default "md" (once button mode is on)
   */
  buttonSize?: ButtonSize;
  /** Ground for button appearance; inline links retain their own text treatment. */
  ground?: ControlGround;
}

