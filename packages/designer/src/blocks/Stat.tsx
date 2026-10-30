import type { ComponentType, CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { TREND_TEXT_CLASSES } from "./internal/trend.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const Card = componentLeaf<ComponentType<HTMLAttributes<HTMLDivElement>>>("components.card");
const CardHeader = componentLeaf<ComponentType<HTMLAttributes<HTMLDivElement>>>("components.card", "CardHeader");
const CardTitle = componentLeaf<ComponentType<HTMLAttributes<HTMLDivElement>>>("components.card", "CardTitle");
const CardContent = componentLeaf<ComponentType<HTMLAttributes<HTMLDivElement>>>("components.card", "CardContent");
const CardFooter = componentLeaf<ComponentType<HTMLAttributes<HTMLDivElement>>>("components.card", "CardFooter");
const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

export type StatTrend = "up" | "down" | "neutral";

// Aria-hidden glyphs — the VISUAL non-colour indicator. `neutral`'s glyph
// is a flat arrow, not one of `up`/`down`'s, so a colourblind reader (or
// anyone on a greyscale screen) can tell all three apart from shape alone,
// not just from the (also present) colour difference.
const TREND_GLYPH: Record<StatTrend, string> = {
  up: "▲",
  down: "▼",
  neutral: "→",
};

export interface StatTrendLabels {
  readonly up: string;
  readonly down: string;
  readonly neutral: string;
}

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
  /**
   * Screen-reader-only trend direction beside `delta`.
   * Required when a delta is present; supplied by the caller's copy source.
   */
  trendLabels?: StatTrendLabels;
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
 * an component despite being small: `label` and `value` play different roles
 * (a metric's name vs. its measurement), not a homogeneous repeat of the
 * same kind of thing, which is what test 2 asks.
 */
export function Stat({
  label,
  value,
  delta,
  trend = "neutral",
  trendLabels,
  description,
  className,
  style,
  ...rest
}: StatProps) {
  if (delta !== undefined && (!trendLabels || typeof trendLabels[trend] !== "string" || !trendLabels[trend].trim())) {
    throw new TypeError(`NEED Stats trendLabels.${trend}`);
  }
  return (
    <Card {...rest} className={cx("h-full min-w-0", className)} style={style}>
      <CardHeader>
        <CardTitle className="text-(length:--text-body-s) font-body text-ink-secondary">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-(length:--text-h1) font-display tabular-nums text-ink-primary">{value}</CardContent>
      {delta !== undefined || description !== undefined ? <CardFooter className="flex flex-col items-start gap-xs">
        {delta !== undefined ? <SemanticContent as="span"
          className={cx(
            "inline-flex items-center gap-xs text-body-s font-body",
            TREND_TEXT_CLASSES[trend],
          )}
        >
          <SemanticContent as="span" aria-hidden="true">{TREND_GLYPH[trend]}</SemanticContent>
          <SemanticContent as="span" className="sr-only">{trendLabels![trend]}, </SemanticContent>
          {delta}
        </SemanticContent> : null}
        {description !== undefined ? <SemanticContent as="span" className="text-caption text-ink-muted">{description}</SemanticContent> : null}
      </CardFooter> : null}
    </Card>
  );
}
