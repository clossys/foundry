import { useState, type CSSProperties } from "react";
import { ChartFrame, type ChartTableSpec } from "./ChartFrame.js";
import { bandScale, formatTickValue, linearScale, niceTicks } from "./internal/scale.js";
import { CHART_AXIS_LABEL, CHART_FONT_BODY, CHART_GRID, CHART_SURFACE, MAX_CATEGORICAL_SERIES, resolveSeriesColor } from "./internal/chart-vars.js";

export interface BarChartSeries {
  readonly name: string;
  /** One value per entry in `categories`, same order. */
  readonly values: readonly number[];
  /**
   * Override this series' color. Omit to use the fixed-order categorical
   * palette by default (see `BarChartProps.colorDomain` for how to keep
   * that default stable across a filtered render — see this package's
   * charts README: "color follows the entity, never its rank").
   */
  color?: string;
}

export interface BarChartProps {
  readonly categories: readonly string[];
  /** 1 to `MAX_CATEGORICAL_SERIES` (8) series. Series past the 8th are dropped with a console warning — see `assignCategoricalColor`. */
  readonly series: readonly BarChartSeries[];
  /**
   * The full, stable set of possible series names — used, together with
   * each series' position WITHIN this list (not within `series` itself),
   * to pick its default color. Pass this whenever `series` can be
   * filtered down to a subset across renders: without it, a filtered-out
   * series shifts the remaining ones' array positions, and their default
   * colors shift with them (see this package's charts README,
   * "Non-negotiables" — "color follows the entity, never its rank").
   * Omit it for a chart whose series list never changes shape.
   */
  readonly colorDomain?: readonly string[];
  title: string;
  description?: string;
  /** @default 480 */
  width?: number;
  /** @default 280 */
  height?: number;
  /** @default thousands-comma formatting */
  valueFormat?: (value: number) => string;
  className?: string;
  style?: CSSProperties;
}

const BAR_MAX_THICKNESS = 24; // marks-and-anatomy.md: bar/column ≤ 24px thick
const SURFACE_GAP = 2; // marks-and-anatomy.md: 2px surface-color gap between adjacent bars/segments

/**
 * Categorical magnitude — one bar per category, grouped by series when
 * there's more than one. Composes `ChartFrame` for the plot/axes/grid/
 * legend/table; this component only computes bar geometry and marks.
 *
 * ONE axis, always: `BarChart` takes a single `valueFormat` and draws one
 * value scale. If two measures of different scale need showing together,
 * that's two `BarChart`s (or a shared, indexed scale) — never a second
 * y-axis on this one; see the dataviz reference's anti-patterns list.
 */
export function BarChart({
  categories,
  series,
  colorDomain,
  title,
  description,
  width = 480,
  height = 280,
  valueFormat = formatTickValue,
  className,
  style,
}: BarChartProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  if (series.length > MAX_CATEGORICAL_SERIES && typeof console !== "undefined") {
    console.warn(
      `BarChart: ${series.length} series were passed but this palette supports at most ${MAX_CATEGORICAL_SERIES} ` +
        `(see assignCategoricalColor). Series past the ${MAX_CATEGORICAL_SERIES}th were dropped — fold the tail ` +
        `into "Other," or facet into small multiples instead.`,
    );
  }
  const visibleSeries = series.slice(0, MAX_CATEGORICAL_SERIES);

  const allValues = visibleSeries.flatMap((s) => s.values);
  const domainMin = Math.min(0, ...allValues);
  const domainMax = Math.max(0, ...allValues, 1);
  const ticks = niceTicks(domainMin, domainMax);

  const legend = visibleSeries.map((s, i) => ({ label: s.name, color: resolveSeriesColor(s.name, i, colorDomain, s.color) }));
  const showDirectLabels = visibleSeries.length >= 2 && visibleSeries.length <= 4;

  const table: ChartTableSpec = {
    headers: ["Category", ...visibleSeries.map((s) => s.name)],
    rows: categories.map((category, i) => [category, ...visibleSeries.map((s) => valueFormat(s.values[i] ?? 0))]),
  };

  return (
    <ChartFrame
      title={title}
      description={description}
      width={width}
      height={height}
      legend={legend}
      table={table}
      className={className}
      style={style}
      xTicks={[]}
      yTicks={[]}
    >
      {(plot) => {
        const y = linearScale([domainMin, domainMax], [plot.y + plot.height, plot.y]);
        const category = bandScale(categories, [plot.x, plot.x + plot.width], 0.3);
        const baselineY = y(0);

        return (
          <>
            {/* Redraw grid/ticks here, now that the value domain is known — ChartFrame's own grid/tick props are left empty above because the domain is BarChart's to compute, not ChartFrame's. */}
            <g data-chart-part="grid">
              {ticks.map((t) => (
                <line key={`g-${t}`} x1={plot.x} x2={plot.x + plot.width} y1={y(t)} y2={y(t)} stroke={CHART_GRID} strokeWidth={1} />
              ))}
            </g>
            <g data-chart-part="ticks" fontSize={11} fill={CHART_AXIS_LABEL} fontFamily={CHART_FONT_BODY}>
              {ticks.map((t) => (
                <text key={`ty-${t}`} x={plot.x - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                  {valueFormat(t)}
                </text>
              ))}
              {categories.map((c) => (
                <text key={`tx-${c}`} x={category(c) + category.bandwidth / 2} y={plot.y + plot.height + 16} textAnchor="middle">
                  {c}
                </text>
              ))}
            </g>

            {categories.map((cat, catIndex) => {
              const clusterWidth = category.bandwidth;
              const barWidth = Math.min(BAR_MAX_THICKNESS, clusterWidth / visibleSeries.length) - SURFACE_GAP;
              const clusterX = category(cat);
              return (
                <g key={cat} data-chart-part="cluster">
                  {visibleSeries.map((s, seriesIndex) => {
                    const value = s.values[catIndex] ?? 0;
                    const color = resolveSeriesColor(s.name, seriesIndex, colorDomain, s.color);
                    const barX =
                      clusterX +
                      (clusterWidth - visibleSeries.length * (barWidth + SURFACE_GAP)) / 2 +
                      seriesIndex * (barWidth + SURFACE_GAP);
                    const top = Math.min(y(value), baselineY);
                    const barHeight = Math.max(0, Math.abs(y(value) - baselineY));
                    const key = `${catIndex}-${seriesIndex}`;
                    const isHovered = hovered === key;
                    const isLastCategory = catIndex === categories.length - 1;

                    return (
                      <g key={key}>
                        <rect
                          x={barX}
                          y={top}
                          width={Math.max(0, barWidth)}
                          height={barHeight}
                          rx={4}
                          fill={color}
                          fillOpacity={isHovered ? 0.85 : 1}
                          stroke={isHovered ? CHART_SURFACE : "none"}
                          strokeWidth={isHovered ? 2 : 0}
                          tabIndex={0}
                          role="img"
                          aria-label={`${s.name}, ${cat}: ${valueFormat(value)}`}
                          onMouseEnter={() => setHovered(key)}
                          onMouseLeave={() => setHovered((cur) => (cur === key ? null : cur))}
                          onFocus={() => setHovered(key)}
                          onBlur={() => setHovered((cur) => (cur === key ? null : cur))}
                        >
                          <title>{`${s.name} — ${cat}: ${valueFormat(value)}`}</title>
                        </rect>
                        {showDirectLabels && isLastCategory ? (
                          <text
                            x={barX + barWidth / 2}
                            y={top - 4}
                            textAnchor="middle"
                            fontSize={11}
                            fill={CHART_AXIS_LABEL}
                            fontFamily={CHART_FONT_BODY}
                          >
                            {valueFormat(value)}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </>
        );
      }}
    </ChartFrame>
  );
}
