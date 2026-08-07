/**
 * Raw CSS custom-property reads for @vespeneventures/tokens' chart-color
 * family (`--color-chart-*`) — the charts layer's equivalent of
 * `atoms/internal/ui-vars.ts`. SVG presentation attributes (`fill`,
 * `stroke`) and inline `style` both take a `var(...)` string directly, so
 * there is no Tailwind class to reach for here the way an atom would —
 * every chart mark reads color through one of these constants instead of a
 * hardcoded hex, so it follows `data-theme`/`prefers-color-scheme` the same
 * way every other token-driven surface in this package does.
 *
 * Every read carries an explicit fallback (the token's own shipped default
 * from `@vespeneventures/tokens`' `styles/tokens.css`), so a chart still
 * renders legibly for a consumer who has this package but hasn't wired up
 * tokens' CSS yet.
 */

// ── Chrome ──────────────────────────────────────────────────────────────
export const CHART_SURFACE = "var(--color-chart-surface, var(--color-surface-raised, oklch(1 0 0)))";
export const CHART_GRID = "var(--color-chart-grid, oklch(0.91 0 0))";
export const CHART_AXIS = "var(--color-chart-axis, var(--color-line-strong, oklch(0.7763 0 0)))";
export const CHART_AXIS_LABEL = "var(--color-chart-axis-label, var(--color-ink-muted, oklch(0.54 0 0)))";

/**
 * SVG `<text>` does not inherit an ancestor HTML element's Tailwind
 * `font-body` class the way ordinary DOM text does, so every tick/axis/
 * direct-label `<text>` in this layer sets this explicitly — the same
 * "everything, including axis text, stays in the system sans, never a
 * display or serif face" rule the dataviz reference's marks-and-anatomy
 * guidance states for the rest of a chart's typography.
 */
export const CHART_FONT_BODY =
  'var(--font-body, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)';

// ── Categorical (fixed order, 1-indexed to match the token names) ───────
const CHART_CATEGORICAL_FALLBACK: Readonly<Record<number, string>> = {
  1: "#2a78d6",
  2: "#eb6834",
  3: "#1baf7a",
  4: "#eda100",
  5: "#e87ba4",
  6: "#008300",
  7: "#4a3aa7",
  8: "#e34948",
};

/** How many categorical identity slots this package's token vocabulary defines — see `assignCategoricalColor`. */
export const MAX_CATEGORICAL_SERIES = 8;

/**
 * The categorical color for series `index` (0-based) in FIXED order — never
 * cycled. Per the dataviz method this package's tokens were validated
 * against (see `@vespeneventures/tokens`' `styles/tokens.css`, "CHART ·
 * CATEGORICAL"), a 9th series does not get a generated hue: callers must
 * cap at `MAX_CATEGORICAL_SERIES` themselves (fold the tail into "Other",
 * or facet into small multiples) before calling this. Throws rather than
 * silently wrapping/reusing a slot, because a wrapped 9th series would
 * collide with the 1st under color-vision deficiency — exactly the
 * "cycling past 8" anti-pattern this palette was built to avoid.
 */
export function assignCategoricalColor(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_CATEGORICAL_SERIES) {
    throw new RangeError(
      `assignCategoricalColor: index ${index} is out of range — this palette supports exactly ` +
        `${MAX_CATEGORICAL_SERIES} fixed-order categorical slots (0-${MAX_CATEGORICAL_SERIES - 1}). ` +
        `Fold additional series into "Other," or facet into small multiples, rather than cycling a color.`,
    );
  }
  const slot = index + 1;
  return `var(--color-chart-categorical-${slot}, ${CHART_CATEGORICAL_FALLBACK[slot]})`;
}

/**
 * Resolves one series' color the way `BarChart`/`LineChart` both do:
 * an explicit `color` wins outright; otherwise, if a stable `colorDomain`
 * (the full, unfiltered list of possible series names) is supplied and
 * contains `name`, that name's position in the DOMAIN — not in whatever
 * subset is currently being rendered — picks the slot; otherwise falls
 * back to `positionalIndex` (today's render's own array position).
 *
 * This is the mechanism behind "color follows the entity, never its
 * rank" (see this package's charts README, "Non-negotiables"): a
 * consumer who filters `series` down to a subset, WITHOUT also passing
 * the same `colorDomain` on every render, gets the anti-pattern back —
 * the survivors' positions shift, so their colors shift with them.
 * Passing a stable `colorDomain` (the full set of entity names the
 * consumer already knows about before filtering) is what actually
 * pins each entity to one slot regardless of which others are visible.
 */
export function resolveSeriesColor(
  name: string,
  positionalIndex: number,
  colorDomain: readonly string[] | undefined,
  explicitColor: string | undefined,
): string {
  if (explicitColor) return explicitColor;
  if (colorDomain) {
    const domainIndex = colorDomain.indexOf(name);
    if (domainIndex >= 0 && domainIndex < MAX_CATEGORICAL_SERIES) {
      return assignCategoricalColor(domainIndex);
    }
  }
  return assignCategoricalColor(positionalIndex);
}

// ── Sequential (magnitude ramp; step count intentionally small — see
// scale.ts's sequentialStep, which is the only place this is read from) ──
const CHART_SEQUENTIAL_FALLBACK: Readonly<Record<number, string>> = {
  100: "#cde2fb",
  200: "#9ec5f4",
  300: "#6da7ec",
  400: "#3987e5",
  500: "#256abf",
  600: "#184f95",
  700: "#0d366b",
};
export const CHART_SEQUENTIAL_STEPS: readonly number[] = [100, 200, 300, 400, 500, 600, 700];

export function chartSequentialVar(step: number): string {
  const fallback = CHART_SEQUENTIAL_FALLBACK[step];
  if (fallback === undefined) {
    throw new RangeError(`chartSequentialVar: ${step} is not one of the shipped steps (${CHART_SEQUENTIAL_STEPS.join(", ")})`);
  }
  return `var(--color-chart-sequential-${step}, ${fallback})`;
}

// ── Diverging ─────────────────────────────────────────────────────────
export const CHART_DIVERGING_NEGATIVE = "var(--color-chart-diverging-negative, var(--color-chart-categorical-8, #e34948))";
export const CHART_DIVERGING_POSITIVE = "var(--color-chart-diverging-positive, var(--color-chart-categorical-1, #2a78d6))";
export const CHART_DIVERGING_NEUTRAL = "var(--color-chart-diverging-neutral, var(--color-line-base, oklch(0.8761 0 0)))";
