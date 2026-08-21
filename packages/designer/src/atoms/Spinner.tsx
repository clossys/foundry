import type { SVGAttributes } from "react";
import { cx } from "./internal/cx.js";

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps extends Omit<SVGAttributes<SVGSVGElement>, "className" | "children"> {
  /** @default "md" */
  size?: SpinnerSize;
  className?: string;
  /**
   * Accessible label, announced to assistive tech. Provide this when the
   * spinner is itself the only signal that something is loading — it then
   * renders `role="status"` with this as its accessible name. Omit it when
   * the spinner is purely decorative — e.g. next to a button's own
   * "Saving…" text, which already announces the state — the spinner then
   * renders `aria-hidden="true"` instead, so assistive tech isn't told
   * about the same thing twice.
   */
  label?: string;
}

// No dimension token exists for a control's own affordance size — see
// Checkbox/Switch/Avatar for the same reasoning. Tailwind's own built-in
// scale, not this package's token scale, used only for this reason.
const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

/**
 * An indeterminate loading indicator. Plain SVG — not interactive and
 * composes no other atom, so there's no react-aria-components primitive
 * for it (the same reasoning as `Badge`/`Card`/`Avatar`; see this
 * package's README).
 *
 * Uses `currentColor` for its stroke rather than a token-derived color
 * class, so it inherits whatever text color is already in effect at its
 * render site — correct by default inside a colored `Button` (e.g. white
 * on an accent-filled primary button) without a `variant` prop of its own
 * to keep in sync with the parent's. `text-ink-secondary` below is only
 * this component's own DEFAULT text color for when it's rendered
 * standalone with nothing else setting `color`; a consumer overrides it
 * the same way as any other inherited-color icon, with their own `text-*`
 * class via `className`.
 */
export function Spinner({ size = "md", className, label, ...rest }: SpinnerProps) {
  return (
    <svg
      {...rest}
      viewBox="0 0 24 24"
      fill="none"
      className={cx("animate-spin motion-reduce:animate-none text-ink-secondary", SIZE_CLASSES[size], className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
