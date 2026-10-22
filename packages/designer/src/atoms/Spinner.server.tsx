import type { SVGAttributes } from "react";
import { cx } from "./internal/cx.js";
import type { SpinnerProps, SpinnerSize } from "./Spinner.js";

// No dimension token exists for a control's own affordance size — see
// Checkbox/Switch/Avatar for the same reasoning. Tailwind's own built-in
// scale, not this package's token scale, used only for this reason.
export const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};


export interface SpinnerGraphicProps extends Omit<SVGAttributes<SVGSVGElement>, "className" | "children"> {
  size: SpinnerSize;
  className?: string | undefined;
}

/**
 * The spinning ring: an `<svg>` with the size, motion and colour classes and
 * no accessibility wiring. Pure markup with no hooks, so the server `Spinner`
 * (this file) and the client `Spinner` (`Spinner.tsx`) draw the very same
 * element and differ only in what names it.
 */
export function SpinnerGraphic({ size, className, ...rest }: SpinnerGraphicProps) {
  return (
    <svg
      {...rest}
      viewBox="0 0 24 24"
      fill="none"
      className={cx("animate-spin motion-reduce:animate-none text-ink-secondary", SIZE_CLASSES[size], className)}
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

/**
 * The server-safe `Spinner`, re-exported as `Spinner` from
 * `@clossys/designer/atoms/server`. An indeterminate loading indicator as
 * plain SVG, with no react-aria-components (which cannot load under React's
 * `react-server` condition). With a `label` the `<svg>` itself is
 * `role="status"` named by the label; without one it is `aria-hidden`. The
 * client `Spinner` (`Spinner.tsx`) names a labelled spinner through
 * react-aria-components' `ProgressBar` instead (`role="progressbar"`);
 * a parity test pins the two to the same `<svg>`.
 *
 * Uses `currentColor` for its stroke, so it inherits the text colour in
 * effect at its render site (see `Spinner.tsx`).
 */
export function Spinner({ size = "md", className, label, ...rest }: SpinnerProps) {
  return (
    <SpinnerGraphic
      {...rest}
      size={size}
      className={className}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
