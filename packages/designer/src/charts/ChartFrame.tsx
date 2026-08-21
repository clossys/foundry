import { useId, type CSSProperties, type ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { CHART_AXIS, CHART_AXIS_LABEL, CHART_FONT_BODY, CHART_GRID } from "./internal/chart-vars.js";

export interface ChartMargin {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** The plot rectangle inside a `ChartFrame`'s SVG coordinate space — everything a chart's own marks are drawn relative to. */
export interface PlotArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ChartAxisTick {
  /** Pixel position along the axis, already resolved by the caller's own scale — `ChartFrame` draws ticks, it does not compute them. */
  readonly position: number;
  readonly label: string;
}

export interface ChartLegendItem {
  readonly label: string;
  readonly color: string;
}

export interface ChartTableSpec {
  readonly headers: readonly string[];
  readonly rows: ReadonlyArray<ReadonlyArray<string | number>>;
}

const DEFAULT_MARGIN: ChartMargin = { top: 16, right: 16, bottom: 32, left: 48 };

export interface ChartFrameProps {
  /** Names what's plotted. Renders as the SVG's accessible name (an `<svg role="img">`'s `<title>`) AND as a visible caption — never color-only, per this package's charts README. */
  title: string;
  /** Optional longer accessible description, rendered as the SVG's `<desc>`. */
  description?: string;
  /** @default 480 */
  width?: number;
  /** @default 280 */
  height?: number;
  margin?: Partial<ChartMargin>;
  /** Horizontal gridlines/x-axis ticks. Omit for a chart with no meaningful x-ticks (rare — most charts pass both axes). */
  xTicks?: readonly ChartAxisTick[];
  yTicks?: readonly ChartAxisTick[];
  /**
   * A legend is always present for two or more series — the dependable
   * identity channel, never color-matching alone (see this package's
   * charts README). Pass 0 or 1 items and `ChartFrame` renders no legend
   * at all: a single series needs none, since the title already names it.
   */
  legend?: readonly ChartLegendItem[];
  /**
   * The table-view fallback — REQUIRED. Every chart in this layer must be
   * able to show the same data as an ordinary HTML table; this is the
   * accessibility answer, not a nicety (see this package's charts README
   * and the dataviz reference's anti-patterns list).
   */
  table: ChartTableSpec;
  className?: string;
  style?: CSSProperties;
  /** Render prop: receives the resolved plot rectangle so marks can be computed in the same coordinate space `ChartFrame` drew its axes in. */
  children: (plot: PlotArea) => ReactNode;
}

/**
 * The shared container every chart in this layer composes: plot area, axes,
 * grid, an optional legend, an accessible SVG title/description, and a
 * table-view fallback. `BarChart`, `LineChart`, and `Sparkline` all render
 * their marks through this (`Sparkline` with grid/ticks/legend/table all
 * omitted — see its own doc comment for why that's still correct here).
 */
export function ChartFrame({
  title,
  description,
  width = 480,
  height = 280,
  margin,
  xTicks = [],
  yTicks = [],
  legend,
  table,
  className,
  style,
  children,
}: ChartFrameProps) {
  const titleId = useId();
  const descId = useId();
  const m = { ...DEFAULT_MARGIN, ...margin };
  const plot: PlotArea = {
    x: m.left,
    y: m.top,
    width: Math.max(0, width - m.left - m.right),
    height: Math.max(0, height - m.top - m.bottom),
  };
  const showLegend = (legend?.length ?? 0) >= 2;

  return (
    <figure className={cx("m-0 flex flex-col gap-sm", className)} style={style}>
      <figcaption className="text-body-s text-ink-secondary font-body">{title}</figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        data-chart-part="frame"
      >
        <title id={titleId}>{title}</title>
        {description ? <desc id={descId}>{description}</desc> : null}

        {/* Gridlines — one-step-off-surface gray, hairline, solid, recessive (never dashed). */}
        <g data-chart-part="grid">
          {yTicks.map((tick) => (
            <line
              key={`grid-y-${tick.label}`}
              x1={plot.x}
              x2={plot.x + plot.width}
              y1={tick.position}
              y2={tick.position}
              stroke={CHART_GRID}
              strokeWidth={1}
            />
          ))}
        </g>

        {/* Axis baseline — the x-axis line; ONE axis, always (see BarChart/LineChart's own doc comments for the dual-axis prohibition this frame structurally can't violate: it draws exactly one y-scale's worth of ticks). */}
        <g data-chart-part="axis">
          <line
            x1={plot.x}
            x2={plot.x + plot.width}
            y1={plot.y + plot.height}
            y2={plot.y + plot.height}
            stroke={CHART_AXIS}
            strokeWidth={1}
          />
        </g>

        {/* Tick labels. */}
        <g data-chart-part="ticks" fill={CHART_AXIS_LABEL} fontSize={11} fontFamily={CHART_FONT_BODY}>
          {xTicks.map((tick) => (
            <text key={`tick-x-${tick.label}`} x={tick.position} y={plot.y + plot.height + 16} textAnchor="middle">
              {tick.label}
            </text>
          ))}
          {yTicks.map((tick) => (
            <text key={`tick-y-${tick.label}`} x={plot.x - 8} y={tick.position} textAnchor="end" dominantBaseline="middle">
              {tick.label}
            </text>
          ))}
        </g>

        <g data-chart-part="marks">{children(plot)}</g>
      </svg>

      {showLegend ? (
        <ul data-chart-part="legend" className="m-0 flex list-none flex-wrap gap-md p-0 text-body-s text-ink-secondary font-body">
          {legend!.map((item) => (
            <li key={item.label} className="inline-flex items-center gap-xs">
              <span aria-hidden="true" className="inline-block h-3 w-3 rounded-subtle" style={{ backgroundColor: item.color }} />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}

      <details data-chart-part="table-fallback">
        <summary className="text-body-s text-ink-secondary font-body cursor-pointer">View as table</summary>
        <table className="text-body-s font-body">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              {table.headers.map((header) => (
                <th key={header} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              // eslint-disable-next-line react/no-array-index-key -- rows have no stable id of their own
              <tr key={i}>
                {row.map((cell, j) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
