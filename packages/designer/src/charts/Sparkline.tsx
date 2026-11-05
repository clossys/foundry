import { useId, type CSSProperties } from "react";
import { cx } from "../components/internal/cx.js";
import { linearScale, formatTickValue } from "./internal/scale.js";
import { assignCategoricalColor, CHART_AXIS, CHART_AXIS_LABEL, CHART_FONT_BODY } from "./internal/chart-vars.js";
import { CHART_TOOLTIP_REVEAL_CSS, ChartFrame, type PlotArea } from "./ChartFrame.js";

export interface SparklineProps {
  readonly values: readonly number[];
  /** Required, even though nothing is drawn for it — this is `Sparkline`'s only accessible name (its SVG `<title>`), since it renders no visible caption of its own. */
  title: string;
  /** @default 120 */
  width?: number;
  /** @default 24 */
  height?: number;
  /** @default the first categorical slot */
  color?: string;
  /** @default thousands-comma formatting */
  valueFormat?: (value: number) => string;
  /**
   * Text of the disclosure that opens the table-view fallback.
   * @default "View as table"
   */
  tableFallbackLabel?: string;
  /**
   * Column heading for the value column in the table-view fallback.
   * @default "Value"
   */
  valueColumnLabel?: string;
  /**
   * Draw the zero baseline and label the plotted range (its maximum above,
   * its minimum below) in a gutter before the line, formatted with
   * `valueFormat`. Off by default: a sparkline is usually read for shape.
   * @default false
   */
  axes?: boolean;
  /**
   * Visible name of the single series, shown as a one-item legend under the
   * line. Omitted: no legend; `title` already names the series.
   */
  legend?: string;
  /**
   * Make each point inspectable on hover and keyboard focus through the
   * shared `ChartFrame.Tooltip` part ("<position>. <valueColumnLabel>:
   * <value>"). Turns the SVG into a labelled group with one tab stop per
   * point, so keep it off for sparklines repeated inline in running text.
   * @default false
   */
  tooltip?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * A compact inline trend. By default it is bare — no axes, no grid, no
 * legend and no hover layer — so it can sit inline in running text or a
 * stat tile. Three optional parts, all off by default, cover the cases
 * where that is too little: `axes` (zero baseline and range labels),
 * `legend` (a one-item series legend) and `tooltip` (per-point inspection
 * through the same `ChartFrame.Tooltip` part the full charts use). It
 * always ships a table-view fallback — that requirement has no exception
 * (see the dataviz reference's anti-patterns list: "No table view /
 * color-only encoding on a continuous scale") — collapsed behind a
 * `<details>` the same way `ChartFrame`'s is, so it costs no layout space
 * until opened.
 *
 * Does not compose `ChartFrame` itself: that container's caption, grid and
 * fixed margins are sized for a full chart, not an inline one.
 */
export function Sparkline({
  values,
  title,
  width = 120,
  height = 24,
  color,
  valueFormat = formatTickValue,
  tableFallbackLabel = "View as table",
  valueColumnLabel = "Value",
  axes = false,
  legend,
  tooltip = false,
  className,
  style,
}: SparklineProps) {
  const titleId = useId();
  const resolvedColor = color ?? assignCategoricalColor(0);
  const padding = 2; // keeps the 2px stroke and end marker from clipping at the viewBox edge
  const domainMin = Math.min(...values, 0);
  const domainMax = Math.max(...values, 0);
  const rangeLabels = axes ? [valueFormat(domainMax), valueFormat(domainMin)] : [];
  // Range labels sit in a start-side gutter sized to the longer label (about 6px per 11px glyph plus a gap), so they never overlap the line.
  const gutter = axes ? Math.max(...rangeLabels.map((label) => label.length)) * 6 + 6 : 0;
  const plot: PlotArea = { x: gutter + padding, y: padding, width: Math.max(0, width - gutter - 2 * padding), height: Math.max(0, height - 2 * padding) };
  const x = linearScale([0, Math.max(1, values.length - 1)], [plot.x, plot.x + plot.width]);
  const y = linearScale([domainMin, domainMax], [height - padding, padding]);
  const points = values.map((v, i) => [x(i), y(v)] as const);
  const d = points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px},${py}`).join(" ");
  const last = points[points.length - 1];

  return (
    <span className={cx("inline-flex flex-col gap-xs", className)} style={style}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role={tooltip ? "group" : "img"}
        aria-labelledby={titleId}
        data-chart-part="sparkline"
        overflow={tooltip ? "visible" : undefined}
      >
        {tooltip ? <style>{CHART_TOOLTIP_REVEAL_CSS}</style> : null}
        <title id={titleId}>{title}</title>
        {axes ? (
          <>
            <g data-chart-part="axis">
              <line x1={plot.x} x2={plot.x + plot.width} y1={y(0)} y2={y(0)} stroke={CHART_AXIS} strokeWidth={1} />
            </g>
            <g data-chart-part="ticks" fill={CHART_AXIS_LABEL} fontSize={11} fontFamily={CHART_FONT_BODY} textAnchor="end">
              <text x={gutter - 2} y={y(domainMax)} dominantBaseline="hanging">{rangeLabels[0]}</text>
              <text x={gutter - 2} y={y(domainMin)} dominantBaseline="text-after-edge">{rangeLabels[1]}</text>
            </g>
          </>
        ) : null}
        <path d={d} fill="none" stroke={resolvedColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {last ? <circle cx={last[0]} cy={last[1]} r={2.5} fill={resolvedColor} /> : null}
        {tooltip
          ? points.map(([px, py], i) => (
              // eslint-disable-next-line react/no-array-index-key -- position IS the datum here
              <ChartFrame.Tooltip key={i} plot={plot} x={px} y={py} text={`${i + 1}. ${valueColumnLabel}: ${valueFormat(values[i]!)}`}>
                <circle cx={px} cy={py} r={4} fill={resolvedColor} fillOpacity={0} />
              </ChartFrame.Tooltip>
            ))
          : null}
      </svg>
      {legend !== undefined ? (
        <ul data-chart-part="legend" className="m-0 flex list-none flex-wrap gap-md p-0 text-caption text-ink-secondary font-body">
          <li className="inline-flex items-center gap-xs">
            <span aria-hidden="true" className="inline-block h-3 w-3 rounded-subtle" style={{ backgroundColor: resolvedColor }} />
            {legend}
          </li>
        </ul>
      ) : null}
      <details data-chart-part="table-fallback">
        <summary className="text-caption text-ink-secondary font-body cursor-pointer">{tableFallbackLabel}</summary>
        <table className="text-caption font-body">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{valueColumnLabel}</th>
            </tr>
          </thead>
          <tbody>
            {values.map((v, i) => (
              // eslint-disable-next-line react/no-array-index-key -- position IS the datum here
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{valueFormat(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </span>
  );
}
