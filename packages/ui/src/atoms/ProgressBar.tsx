import type { ReactNode } from "react";
import {
  Label,
  ProgressBar as AriaProgressBar,
  type ProgressBarProps as AriaProgressBarProps,
} from "react-aria-components";
import { cx } from "./internal/cx.js";

export interface ProgressBarProps extends Omit<AriaProgressBarProps, "children"> {
  /**
   * Required. Rendered via react-aria-components' own `Label`, which reads
   * `ProgressBar`'s context to become the element `aria-labelledby` points
   * at — the same accessible-name path `TextField`'s own `label` documents,
   * except this one is a `<span>`, not a real `<label>` (a progress bar
   * isn't a form control there's anything to associate a `<label for>`
   * with).
   */
  label: ReactNode;
  /** Merged onto the outer wrapper. */
  className?: string;
}

const TRACK_CLASSES = "h-2 w-full overflow-hidden rounded-pill bg-surface-sunken";
const FILL_CLASSES = "h-full rounded-pill bg-accent transition-[width]";

/**
 * Determinate and indeterminate progress, built on react-aria-components'
 * own `ProgressBar` for the `role="progressbar"`/`aria-valuenow`/
 * `aria-valuemin`/`aria-valuemax`/`aria-valuetext` wiring a screen reader
 * needs — including OMITTING `aria-valuenow` entirely while indeterminate
 * (per the ARIA spec: a progress bar with no known value must not claim
 * one), which this component never has to remember to do itself.
 * `value`/`minValue`/`maxValue` (0/100 by default) and `isIndeterminate`
 * all pass straight through; `valueText`/`formatOptions` control the
 * announced/displayed value text (a percentage by default — "42%" — or
 * `valueLabel` for something else entirely, like "3 of 10").
 *
 * The filled portion's width is set with an inline `style`, not a Tailwind
 * class: it's a continuously-variable number (`renderProps.percentage`),
 * not one of a fixed set of utility values Tailwind could generate ahead of
 * time. While indeterminate, no percentage exists to size the fill by at
 * all — `animate-pulse` (Tailwind's own built-in keyframe utility, not a
 * token-derived one) stands in for the usual "unknown progress" motion
 * instead of the width scaling with anything.
 */
export function ProgressBar({ label, className, ...rest }: ProgressBarProps) {
  return (
    <AriaProgressBar {...rest} className={cx("flex flex-col gap-xs", className)}>
      {(renderProps) => (
        <>
          <div className="flex items-center justify-between gap-sm">
            <Label className="text-body-s text-ink-secondary font-body">{label}</Label>
            {!renderProps.isIndeterminate && renderProps.valueText ? (
              <span className="text-body-s text-ink-muted">{renderProps.valueText}</span>
            ) : null}
          </div>
          <div className={TRACK_CLASSES}>
            <div
              className={cx(FILL_CLASSES, renderProps.isIndeterminate ? "w-1/3 animate-pulse" : "")}
              style={{
                width: renderProps.isIndeterminate ? undefined : `${renderProps.percentage ?? 0}%`,
              }}
            />
          </div>
        </>
      )}
    </AriaProgressBar>
  );
}
