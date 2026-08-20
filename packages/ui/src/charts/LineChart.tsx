import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChartFrame, type ChartTableSpec } from "./ChartFrame.js";
import { linearScale, niceTicks, formatTickValue, timeScale } from "./internal/scale.js";
import { CHART_AXIS_LABEL, CHART_FONT_BODY, CHART_GRID, CHART_SURFACE, MAX_CATEGORICAL_SERIES, resolveSeriesColor } from "./internal/chart-vars.js";

export interface LineChartSeries {
  readonly name: string;
  /** One value per entry in `x`, same order. */
  readonly values: readonly number[];
  /** Override this series' color. Omit to use the fixed-order categorical palette by default (see `LineChartProps.colorDomain` and `BarChart`'s equivalent doc comment — same "color follows the entity" rule). */
  color?: string;
}

export interface LineChartProps {
  /** The shared x position for every series — either `Date`s (a real time scale) or plain numbers (a linear index/x scale). */
  readonly x: readonly (Date | number)[];
  readonly series: readonly LineChartSeries[];
  /**
   * The full, stable set of possible series names — see `BarChart`'s
   * equivalent prop doc for why this matters whenever `series` can be
   * filtered to a subset across renders.
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
  /** @default `Date` -> locale short date; `number` -> the number itself */
  xFormat?: (value: Date | number) => string;
  /**
   * Accessible name for the keyboard/hover overlay, appended after `title`
   * (as `"${title}: ${keyboardHintLabel}"`).
   * @default "use arrow keys to inspect values"
   */
  keyboardHintLabel?: string;
  className?: string;
  style?: CSSProperties;
}

const defaultXFormat = (value: Date | number): string =>
  value instanceof Date ? value.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : String(value);

/**
 * Change over time — one line per series, sharing one x scale and one y
 * scale (never a second y-axis; see `BarChart`'s equivalent doc comment).
 * Ships a full hover layer: a crosshair that finds the nearest x on
 * pointer move, a readout listing every series at that x, and the same
 * detail on keyboard focus (arrow-key stepping) as on hover — see this
 * package's charts README, "Interaction".
 */
export function LineChart({
  x,
  series,
  colorDomain,
  title,
  description,
  width = 480,
  height = 280,
  valueFormat = formatTickValue,
  xFormat = defaultXFormat,
  keyboardHintLabel = "use arrow keys to inspect values",
  className,
  style,
}: LineChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (series.length > MAX_CATEGORICAL_SERIES && typeof console !== "undefined") {
    console.warn(
      `LineChart: ${series.length} series were passed but this palette supports at most ${MAX_CATEGORICAL_SERIES} ` +
        `(see assignCategoricalColor). Series past the ${MAX_CATEGORICAL_SERIES}th were dropped.`,
    );
  }
  const visibleSeries = series.slice(0, MAX_CATEGORICAL_SERIES);

  const allValues = visibleSeries.flatMap((s) => s.values);
  const domainMin = Math.min(0, ...allValues);
  const domainMax = Math.max(0, ...allValues, 1);
  const yTicks = niceTicks(domainMin, domainMax);

  const isTime = x.length > 0 && x[0] instanceof Date;
  const legend = visibleSeries.map((s, i) => ({ label: s.name, color: resolveSeriesColor(s.name, i, colorDomain, s.color) }));
  const showDirectLabels = visibleSeries.length >= 2 && visibleSeries.length <= 4;

  const table: ChartTableSpec = {
    headers: ["X", ...visibleSeries.map((s) => s.name)],
    rows: x.map((xv, i) => [xFormat(xv), ...visibleSeries.map((s) => valueFormat(s.values[i] ?? 0))]),
  };

  return (
    <ChartFrame title={title} description={description} width={width} height={height} legend={legend} table={table} className={className} style={style} xTicks={[]} yTicks={[]}>
      {(plot) => {
        const y = linearScale([domainMin, domainMax], [plot.y + plot.height, plot.y]);
        const xScale = isTime
          ? timeScale([x[0] as Date, x[x.length - 1] as Date], [plot.x, plot.x + plot.width])
          : linearScale([x[0] as number, x[x.length - 1] as number], [plot.x, plot.x + plot.width]);
        const xTickValues = x.length <= 6 ? x : [x[0]!, x[Math.floor((x.length - 1) / 2)]!, x[x.length - 1]!];

        function nearestIndexForClientX(clientX: number, svgEl: SVGSVGElement): number {
          const rect = svgEl.getBoundingClientRect();
          // jsdom returns a zero-size rect (no real layout engine); guard so
          // tests can still drive this deterministically via keyboard instead.
          const scaleX = rect.width > 0 ? width / rect.width : 1;
          const localX = (clientX - rect.left) * scaleX;
          let nearest = 0;
          let nearestDist = Infinity;
          x.forEach((xv, i) => {
            const px = xScale(xv as never);
            const dist = Math.abs(px - localX);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearest = i;
            }
          });
          return nearest;
        }

        function onOverlayPointerMove(event: ReactPointerEvent<SVGRectElement>) {
          const svgEl = event.currentTarget.ownerSVGElement;
          if (!svgEl) return;
          setActiveIndex(nearestIndexForClientX(event.clientX, svgEl));
        }

        function onOverlayKeyDown(event: KeyboardEvent<SVGRectElement>) {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            setActiveIndex((cur) => Math.min(x.length - 1, (cur ?? -1) + 1));
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            setActiveIndex((cur) => Math.max(0, (cur ?? x.length) - 1));
          } else if (event.key === "Escape") {
            setActiveIndex(null);
          }
        }

        const crosshairX = activeIndex !== null ? xScale(x[activeIndex] as never) : null;

        return (
          <>
            <g data-chart-part="grid">
              {yTicks.map((t) => (
                <line key={`g-${t}`} x1={plot.x} x2={plot.x + plot.width} y1={y(t)} y2={y(t)} stroke={CHART_GRID} strokeWidth={1} />
              ))}
            </g>
            <g data-chart-part="ticks" fontSize={11} fill={CHART_AXIS_LABEL} fontFamily={CHART_FONT_BODY}>
              {yTicks.map((t) => (
                <text key={`ty-${t}`} x={plot.x - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                  {valueFormat(t)}
                </text>
              ))}
              {xTickValues.map((xv, i) => (
                // eslint-disable-next-line react/no-array-index-key -- x tick subset, positional
                <text key={i} x={xScale(xv as never)} y={plot.y + plot.height + 16} textAnchor="middle">
                  {xFormat(xv as Date | number)}
                </text>
              ))}
            </g>

            {visibleSeries.map((s, seriesIndex) => {
              const color = resolveSeriesColor(s.name, seriesIndex, colorDomain, s.color);
              const points = x.map((xv, i) => [xScale(xv as never), y(s.values[i] ?? 0)] as const);
              const d = points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px},${py}`).join(" ");
              const last = points[points.length - 1];
              return (
                <g key={s.name} data-chart-part="series">
                  <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {last ? (
                    <circle cx={last[0]} cy={last[1]} r={4} fill={color} stroke={CHART_SURFACE} strokeWidth={2} />
                  ) : null}
                  {showDirectLabels && last ? (
                    <text x={last[0] + 6} y={last[1]} dominantBaseline="middle" fontSize={11} fill={CHART_AXIS_LABEL} fontFamily={CHART_FONT_BODY}>
                      {s.name} {valueFormat(s.values[s.values.length - 1] ?? 0)}
                    </text>
                  ) : null}
                  {activeIndex !== null ? (
                    <circle
                      cx={xScale(x[activeIndex] as never)}
                      cy={y(s.values[activeIndex] ?? 0)}
                      r={4}
                      fill={color}
                      stroke={CHART_SURFACE}
                      strokeWidth={2}
                      data-chart-part="hover-dot"
                    />
                  ) : null}
                </g>
              );
            })}

            {crosshairX !== null ? (
              <line
                data-chart-part="crosshair"
                x1={crosshairX}
                x2={crosshairX}
                y1={plot.y}
                y2={plot.y + plot.height}
                stroke={CHART_AXIS_LABEL}
                strokeWidth={1}
              />
            ) : null}

            {activeIndex !== null ? (
              <g data-chart-part="tooltip" aria-hidden="true">
                <text x={Math.min(plot.x + plot.width - 4, (crosshairX ?? plot.x) + 6)} y={plot.y + 10} fontSize={11} fill={CHART_AXIS_LABEL} fontFamily={CHART_FONT_BODY}>
                  {xFormat(x[activeIndex] as Date | number)}
                  {": "}
                  {visibleSeries.map((s) => `${s.name} ${valueFormat(s.values[activeIndex] ?? 0)}`).join(", ")}
                </text>
              </g>
            ) : null}

            {/* Hover/keyboard overlay — invisible, spans the whole plot; the mark IS the crosshair's hit target here, same reasoning BarChart gives each bar its own hit target. */}
            <rect
              data-chart-part="hover-overlay"
              x={plot.x}
              y={plot.y}
              width={plot.width}
              height={plot.height}
              fill="transparent"
              tabIndex={0}
              role="img"
              aria-label={`${title}: ${keyboardHintLabel}`}
              onPointerMove={onOverlayPointerMove}
              onPointerLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex((cur) => cur ?? 0)}
              onBlur={() => setActiveIndex(null)}
              onKeyDown={onOverlayKeyDown}
            />
          </>
        );
      }}
    </ChartFrame>
  );
}
