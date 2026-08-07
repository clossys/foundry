import { useId, type CSSProperties } from "react";
import { cx } from "../atoms/internal/cx.js";
import { linearScale, formatTickValue } from "./internal/scale.js";
import { assignCategoricalColor } from "./internal/chart-vars.js";

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
  className?: string;
  style?: CSSProperties;
}

/**
 * A bare inline trend — no axes, no grid, no legend, and (unlike every
 * other component in this layer) no hover layer: `Sparkline` is the one
 * form this package's charts README calls out as skipping interaction
 * entirely, because it is meant to sit inline in running text or a stat
 * tile at a size too small for a crosshair/tooltip to make sense. It still
 * ships a table-view fallback — that requirement has no exception (see the
 * dataviz reference's anti-patterns list: "No table view / color-only
 * encoding on a continuous scale") — collapsed behind a `<details>` the
 * same way `ChartFrame`'s is, so it costs no layout space until opened.
 *
 * Does not compose `ChartFrame`: that container's grid/axis/legend/caption
 * chrome is exactly what a sparkline is defined by NOT having.
 */
export function Sparkline({
  values,
  title,
  width = 120,
  height = 24,
  color,
  valueFormat = formatTickValue,
  className,
  style,
}: SparklineProps) {
  const titleId = useId();
  const resolvedColor = color ?? assignCategoricalColor(0);
  const padding = 2; // keeps the 2px stroke and end marker from clipping at the viewBox edge
  const domainMin = Math.min(...values, 0);
  const domainMax = Math.max(...values, 0);
  const x = linearScale([0, Math.max(1, values.length - 1)], [padding, width - padding]);
  const y = linearScale([domainMin, domainMax], [height - padding, padding]);
  const points = values.map((v, i) => [x(i), y(v)] as const);
  const d = points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px},${py}`).join(" ");
  const last = points[points.length - 1];

  return (
    <span className={cx("inline-flex flex-col gap-xs", className)} style={style}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-labelledby={titleId} data-chart-part="sparkline">
        <title id={titleId}>{title}</title>
        <path d={d} fill="none" stroke={resolvedColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {last ? <circle cx={last[0]} cy={last[1]} r={2.5} fill={resolvedColor} /> : null}
      </svg>
      <details data-chart-part="table-fallback">
        <summary className="text-caption text-ink-secondary font-body cursor-pointer">View as table</summary>
        <table className="text-caption font-body">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Value</th>
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
