import type { SVGAttributes } from "react";
import { ProgressBar } from "react-aria-components";
import { Spinner as ServerSpinner, SpinnerGraphic } from "./Spinner.server.js";

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps extends Omit<SVGAttributes<SVGSVGElement>, "className" | "children"> {
  /** @default "md" */
  size?: SpinnerSize;
  className?: string;
  /**
   * Accessible label, announced to assistive tech. Provide this when the
   * spinner is itself the only signal that something is loading — it then
   * renders `role="progressbar"` (no value, so indeterminate) with this as
   * its accessible name. Omit it when
   * the spinner is purely decorative — e.g. next to a button's own
   * "Saving…" text, which already announces the state — the spinner then
   * renders `aria-hidden="true"` instead, so assistive tech isn't told
   * about the same thing twice.
   */
  label?: string;
}

/**
 * An indeterminate loading indicator. A labelled spinner is built on
 * react-aria-components' `ProgressBar` with `isIndeterminate`, which supplies
 * the `role="progressbar"` and leaves `aria-valuenow` off (a progress bar
 * with no known value must not claim one); `label` becomes its `aria-label`.
 * The `<svg>` ring inside carries every class, the consumer's `className`
 * and any other SVG attributes, exactly as before, so the visual is
 * unchanged; the wrapper `<div>` (`inline-block`, so a spinner stays inline
 * without a CSS reset) is the progress bar. The relationship attributes
 * `aria-labelledby`, `aria-describedby` and `aria-details` go to that
 * progress bar, the element that has the role and the name, since a progress
 * bar's descendants are presentational; every other attribute stays on the
 * ring. A passed `aria-label` attribute does not reach the ring: `label` names
 * the progress bar (as the server `Spinner` names its ring by `label` over
 * any `aria-label`), so the ring never carries a second, conflicting name.
 *
 * A decorative spinner (no `label`) is the same `<svg>` with
 * `aria-hidden="true"` and no wrapper, so it keeps its previous semantics:
 * react-aria-components' `ProgressBar` has no hidden-and-unnamed form and
 * warns in development when it has no name, and a hidden ring needs none.
 *
 * Imports react-aria-components, so it is not server-safe. The server-safe
 * `Spinner` from `@clossys/designer/atoms/server` is `Spinner.server.tsx`:
 * the same `<svg>`, named with `role="status"` instead.
 *
 * Uses `currentColor` for its stroke rather than a token-derived color
 * class, so it inherits whatever text color is already in effect at its
 * render site — correct by default inside a colored `Button` (e.g. white
 * on an accent-filled primary button) without a `variant` prop of its own
 * to keep in sync with the parent's. `text-ink-secondary` is only this
 * component's own DEFAULT text color for when it's rendered standalone with
 * nothing else setting `color`; a consumer overrides it the same way as any
 * other inherited-color icon, with their own `text-*` class via `className`.
 */
export function Spinner({ size = "md", className, label, ...rest }: SpinnerProps) {
  if (!label) return <ServerSpinner {...rest} size={size} className={className} />;
  const { "aria-label": _ariaLabel, "aria-labelledby": labelledBy, "aria-describedby": describedBy, "aria-details": details, ...ring } = rest;
  return (
    <ProgressBar
      isIndeterminate
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-details={details}
      className="inline-block"
    >
      <SpinnerGraphic {...ring} size={size} className={className} />
    </ProgressBar>
  );
}
