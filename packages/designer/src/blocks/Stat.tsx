import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";

export type StatTrend = "up" | "down" | "neutral";

const TREND_TEXT_CLASSES: Record<StatTrend, string> = {
  up: "text-status-success-text",
  down: "text-status-danger-text",
  neutral: "text-ink-secondary",
};

// Aria-hidden glyphs — the VISUAL non-colour indicator. `neutral`'s glyph
// is a flat arrow, not one of `up`/`down`'s, so a colourblind reader (or
// anyone on a greyscale screen) can tell all three apart from shape alone,
// not just from the (also present) colour difference.
const TREND_GLYPH: Record<StatTrend, string> = {
  up: "▲",
  down: "▼",
  neutral: "→",
};

// The screen-reader-only text companion to the glyph above — the SECOND,
// independent non-colour signal, for anyone who can't see the glyph's
// shape either. `aria-hidden` on the glyph plus this `sr-only` text means
// assistive tech announces "Increase, +12%" rather than the bare "▲" a
// screen reader would otherwise skip or read as a stray character.
const TREND_LABEL: Record<StatTrend, string> = {
  up: "Increase",
  down: "Decrease",
  neutral: "No change",
};

export interface StatProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** What this number measures ("Monthly active users"). */
  label: ReactNode;
  /** The metric itself ("2,481"). */
  value: ReactNode;
  /** Change since some prior period ("+12%", "-3"). Omit for a metric with no trend to report. */
  delta?: ReactNode;
  /**
   * Direction `delta` represents. Drives the status-token colour AND a
   * non-colour indicator (an aria-hidden glyph, plus screen-reader-only
   * text) — colour is never the only signal, since colour-only status
   * coding fails for colourblind readers and disappears entirely in
   * greyscale. @default "neutral"
   */
  trend?: StatTrend;
  /** Supporting context below the value ("vs. last 30 days"). */
  description?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * A single metric: a label, the value itself, an optional delta/trend, and
 * an optional description — up to four regions that differ in kind. A page
 * routinely holds several `Stat`s in a row (a metrics dashboard, a summary
 * strip above a table), which is exactly why this is a block and not a
 * view — see this package's README, "Placement rules", test 3. It is NOT
 * an atom despite being small: `label` and `value` play different roles
 * (a metric's name vs. its measurement), not a homogeneous repeat of the
 * same kind of thing, which is what test 2 asks.
 */
export function Stat({
  label,
  value,
  delta,
  trend = "neutral",
  description,
  className,
  style,
  ...rest
}: StatProps) {
  return (
    <div {...rest} className={cx("flex flex-col gap-xs", className)} style={style}>
      <span className="text-body-s text-ink-secondary">{label}</span>
      <span className="text-h1 font-display text-ink-primary">{value}</span>
      {delta !== undefined ? (
        <span
          className={cx(
            "inline-flex items-center gap-xs text-body-s font-body",
            TREND_TEXT_CLASSES[trend],
          )}
        >
          <span aria-hidden="true">{TREND_GLYPH[trend]}</span>
          <span className="sr-only">{TREND_LABEL[trend]}, </span>
          {delta}
        </span>
      ) : null}
      {description !== undefined ? (
        <span className="text-caption text-ink-muted">{description}</span>
      ) : null}
    </div>
  );
}
