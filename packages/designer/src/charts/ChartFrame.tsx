import { useId, type CSSProperties, type ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { CHART_AXIS, CHART_AXIS_LABEL, CHART_FONT_BODY, CHART_GRID, CHART_SURFACE } from "./internal/chart-vars.js";
import { CHART_HAIRLINE, CHART_INLINE_AXIS_LABEL } from "./internal/marks.js";
import { scatterGlyph } from "./internal/scatter-geometry.js";

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
  /** Optional shape key; omission retains the existing color swatch. */
  readonly mark?: "circle" | "square" | "diamond" | "triangle";
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
  /** Expose interactive SVG descendants to assistive technology. @default false */
  interactive?: boolean;
  /** @default 480 */
  width?: number;
  /** @default 280 */
  height?: number;
  /** Preserve intrinsic sizing, or scale fluidly up to 1.5 times `width`. @default "fixed" */
  fit?: "fixed" | "fluid";
  margin?: Partial<ChartMargin>;
  /** Horizontal gridlines/x-axis ticks. Omit for a chart with no meaningful x-ticks (rare — most charts pass both axes). */
  xTicks?: readonly ChartAxisTick[];
  yTicks?: readonly ChartAxisTick[];
  /**
   * A legend is always present for two or more series — the dependable
   * identity channel, never color-matching alone (see this package's
   * charts README). By default, 0 or 1 items render no legend: the title
   * names a single series. `showSingleSeriesLegend` also displays one item
   * when its name must remain visible independently of the title.
   */
  legend?: readonly ChartLegendItem[];
  /** Include a single-series legend when its visible name is needed independently of the title. @default false */
  showSingleSeriesLegend?: boolean;
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
  /**
   * Text of the disclosure that opens the table-view fallback.
   * @default "View as table"
   */
  tableFallbackLabel?: string;
}

/**
 * The shared container for full chart compositions: plot area, axes,
 * grid, an optional legend, an accessible SVG title/description, and a
 * table-view fallback. `BarChart`, `LineChart`, `WaterfallChart`, `RangeChart`,
 * and `ScatterChart` render their marks through this.
 */
export function ChartFrame({
  title,
  description,
  interactive = false,
  width = 480,
  height = 280,
  fit = "fixed",
  margin,
  xTicks = [],
  yTicks = [],
  legend,
  showSingleSeriesLegend = false,
  table,
  className,
  style,
  children,
  tableFallbackLabel = "View as table",
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
  const showLegend = (legend?.length ?? 0) >= (showSingleSeriesLegend ? 1 : 2);
  const hasMarkedLegend = legend?.some(item => item.mark !== undefined) ?? false;

  return (
    <figure className={cx("m-0 flex flex-col gap-sm", className)} style={style}>
      <figcaption className="text-body-s text-ink-secondary font-body">{title}</figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={fit === "fluid" ? "100%" : width}
        height={height}
        role={interactive ? "group" : "img"}
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        data-chart-part="frame"
        style={fit === "fluid" ? { maxWidth: width * 1.5, height: "auto" } : undefined}
      >
        <style>{`[data-chart-tooltip-trigger] > [data-chart-part="tooltip"] { visibility: hidden; }
[data-chart-tooltip-trigger]:hover > [data-chart-part="tooltip"],
[data-chart-tooltip-trigger]:focus > [data-chart-part="tooltip"] { visibility: visible; }`}</style>
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
              strokeWidth={fit === "fluid" ? CHART_HAIRLINE : 1}
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
            strokeWidth={fit === "fluid" ? CHART_HAIRLINE : 1}
          />
        </g>

        {/* Tick labels. */}
        <g data-chart-part="ticks" fill={fit === "fluid" ? CHART_INLINE_AXIS_LABEL : CHART_AXIS_LABEL} fontSize={11} fontFamily={CHART_FONT_BODY}>
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
          {legend!.map((item, index) => {
            const glyph = item.mark === undefined ? undefined : scatterGlyph(item.mark, 6, 6, 6);
            return (
              <li key={hasMarkedLegend ? `${index}:${item.label}` : item.label} className="inline-flex items-center gap-xs">
                {glyph ? (
                  <svg aria-hidden="true" focusable="false" width={12} height={12} viewBox="0 0 12 12" className="inline-block h-3 w-3 shrink-0">
                    {item.mark === "circle" ? (
                      <circle data-chart-marker={item.mark} cx={6} cy={6} r={glyph.radius} fill={item.color} />
                    ) : (
                      <path data-chart-marker={item.mark} d={glyph.path} fill={item.color} />
                    )}
                  </svg>
                ) : (
                  <span aria-hidden="true" className="inline-block h-3 w-3 rounded-subtle" style={{ backgroundColor: item.color }} />
                )}
                {item.label}
              </li>
            );
          })}
        </ul>
      ) : null}

      <details data-chart-part="table-fallback">
        <summary className="text-body-s text-ink-secondary font-body cursor-pointer">{tableFallbackLabel}</summary>
        <table className="text-body-s font-body" role={fit === "fluid" ? "table" : undefined}>
          <caption className="sr-only">{title}</caption>
          <thead role={fit === "fluid" ? "rowgroup" : undefined}>
            <tr role={fit === "fluid" ? "row" : undefined}>
              {table.headers.map((header) => (
                <th key={header} scope="col" role={fit === "fluid" ? "columnheader" : undefined}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role={fit === "fluid" ? "rowgroup" : undefined}>
            {table.rows.map((row, i) => (
              // eslint-disable-next-line react/no-array-index-key -- rows have no stable id of their own
              <tr key={i} role={fit === "fluid" ? "row" : undefined}>
                {row.map((cell, j) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <td key={j} role={fit === "fluid" ? "cell" : undefined} data-column-label={fit === "fluid" ? table.headers[j] : undefined}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Pure SVG inspection part. CSS exposes a wrapped mark on hover/focus; existing
 * client inspection can render the same part without children while active.
 * Very long text in a narrow plot can exceed the SVG viewport; the full
 * authored data remains available in the frame table. CSS inspection alone
 * does not establish tooltip accessibility conformance.
 * This keeps the shared frame and static chart exports usable on the server. */
function ChartTooltip({ plot, x, y, text, children }: {
  plot: PlotArea; x: number; y: number; text: string; children?: ReactNode;
}) {
  const width = Math.max(1, Math.min(320, plot.width));
  const lineLength = Math.max(1, Math.floor((width - 16) / 11));
  const characters = Array.from(text);
  const lines: string[] = [];
  for (let offset = 0; offset < characters.length; offset += lineLength) lines.push(characters.slice(offset, offset + lineLength).join(""));
  const height = lines.length * 14 + 12;
  const left = Math.max(plot.x, Math.min(x, plot.x + plot.width - width));
  const top = Math.max(plot.y, Math.min(y, plot.y + plot.height - height));
  const tooltip = <g data-chart-part="tooltip" aria-hidden="true" pointerEvents="none">
    <path d={`M${left},${top}h${width}v${height}h${-width}Z`} fill={CHART_SURFACE} stroke={CHART_AXIS} />
    <text fill={CHART_AXIS_LABEL} fontSize={11} fontFamily={CHART_FONT_BODY}>
      {lines.map((line, index) => <tspan key={index} x={left + 8} y={top + 16 + index * 14}>{line}</tspan>)}
    </text>
  </g>;
  return children === undefined ? tooltip : <g data-chart-tooltip-trigger="" tabIndex={0} role="img" aria-label={text}
    className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
    {children}{tooltip}
  </g>;
}

ChartFrame.Tooltip = ChartTooltip;
