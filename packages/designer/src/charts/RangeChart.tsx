import type { CSSProperties } from "react";
import type { StatusMarkTone } from "../atoms/StatusMark.js";
import { cx } from "../atoms/internal/cx.js";
import { ChartFrame, type ChartFrameProps } from "./ChartFrame.js";
import { assignCategoricalColor, CHART_FONT_BODY } from "./internal/chart-vars.js";
import { CHART_HAIRLINE, CHART_INLINE_AXIS_LABEL, CHART_MARK_RADIUS } from "./internal/marks.js";
import { linearScale } from "./internal/scale.js";

interface RangeChartRow {
  readonly id: string;
  readonly label: string;
  readonly from: number;
  readonly to: number;
  readonly status?: { readonly tone: StatusMarkTone; readonly label: string };
}

/** Static intervals whose bounds address the boundaries of authored tick periods. */
export interface RangeChartProps {
  rows: readonly RangeChartRow[];
  ticks: readonly string[];
  labels: { readonly table: string; readonly category: string; readonly from: string; readonly to: string; readonly status?: string };
  title: string;
  description?: string;
  /** @default "fluid" */
  fit?: ChartFrameProps["fit"];
  /** @default 360 */
  width?: number;
  /** Grows to retain complete authored row and status text. */
  height?: number;
  className?: string;
  style?: CSSProperties;
}

const STATUS_SHAPE = { success: "circle", warning: "triangle", danger: "diamond", info: "open-circle", neutral: "dash" } as const;
const STATUS_MARK_CLASSES = {
  success: "fill-status-success", warning: "fill-status-warning", danger: "fill-status-danger", info: "fill-status-info", neutral: "fill-ink-muted",
} as const;
const STATUS_TEXT_CLASSES = {
  success: "text-status-success-text", warning: "text-status-warning-text", danger: "text-status-danger-text", info: "text-status-info-text", neutral: "text-ink-secondary",
} as const;
const STATUS_GLYPH = {
  circle: <path d="M5 0.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9Z" stroke={CHART_INLINE_AXIS_LABEL} strokeWidth={CHART_HAIRLINE} vectorEffect="non-scaling-stroke" />,
  triangle: <path d="M5 0.5 9.75 9.25H0.25Z" />,
  diamond: <path d="M5 0 10 5 5 10 0 5Z" />,
  "open-circle": <path fillRule="evenodd" d="M5 0.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9ZM5 2a3 3 0 1 1 0 6a3 3 0 1 1 0-6Z" />,
  dash: <rect x="1" y="4" width="8" height="2" style={{ rx: CHART_MARK_RADIUS } as CSSProperties} />,
};

/** Preserve every authored character while assigning conservative lines to the static SVG. */
function wrapLabel(text: string, width: number): string[] {
  const maximum = Math.max(1, Math.floor(width / 11));
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(part => part.segment);
  const lines: string[] = [];
  let remaining = graphemes;
  while (remaining.length > maximum) {
    let space = -1;
    for (let index = maximum - 1; index > 0; index--) {
      if (remaining[index] === " ") { space = index; break; }
    }
    const cut = space > 0 ? space + 1 : maximum;
    lines.push(remaining.slice(0, cut).join(""));
    remaining = remaining.slice(cut);
  }
  lines.push(remaining.join(""));
  return lines;
}

/** No hover state: authored labels and native table retain all interval and status information. */
export function RangeChart({ rows, ticks, labels, title, description, fit = "fluid", width = 360,
  height: authoredHeight, className, style,
}: RangeChartProps) {
  if (!Number.isFinite(width) || width < 75) throw new RangeError("RangeChart width must contain its plot margins.");
  if (!ticks.length || ticks.some(tick => typeof tick !== "string" || !tick.trim())) throw new RangeError("RangeChart requires nonblank authored tick periods.");
  if (!rows.length) throw new RangeError("RangeChart requires authored interval rows.");
  if (!labels || [labels.table, labels.category, labels.from, labels.to].some(value => typeof value !== "string" || !value.trim())) {
    throw new TypeError("RangeChart requires authored table, category, from, and to labels.");
  }
  const hasStatus = rows.some(row => row.status !== undefined);
  if (hasStatus && width < 89) throw new RangeError("RangeChart width must retain its status glyph and label.");
  if (hasStatus && (!labels.status || !labels.status.trim())) throw new TypeError("RangeChart requires an authored status label.");
  const ids = new Set<string>();
  const layouts = rows.map(row => {
    if (!row.id.trim() || ids.has(row.id)) throw new RangeError("RangeChart requires unique nonblank row IDs.");
    ids.add(row.id);
    if (!Number.isFinite(row.from) || !Number.isFinite(row.to) || row.from < 0 || row.from >= row.to || row.to > ticks.length) {
      throw new RangeError("RangeChart bounds must satisfy zero <= from < to <= tick count.");
    }
    if (row.status && (!Object.hasOwn(STATUS_SHAPE, row.status.tone) || typeof row.status.label !== "string" || !row.status.label.trim())) {
      throw new TypeError("RangeChart requires an authored status tone and label.");
    }
    if (typeof row.label !== "string" || !row.label.trim()) throw new TypeError("RangeChart requires authored row labels.");
    const name = wrapLabel(row.label, width - 64);
    const status = row.status ? wrapLabel(row.status.label, width - 78) : [];
    return { row, name, status, pitch: 36 + (name.length - 1) * 14 + (status.length ? 18 + (status.length - 1) * 14 : 0) };
  });
  const plotHeight = layouts.reduce((sum, row) => sum + row.pitch, 0);
  const minimumHeight = Math.max(36, plotHeight) + 48;
  const height = authoredHeight ?? minimumHeight;
  if (!Number.isFinite(height) || height < minimumHeight) throw new RangeError("RangeChart height must retain its complete authored row text.");
  const numbered = ticks.some(tick => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(tick)].length * 11 > (width - 64) / ticks.length - 4);
  if (numbered && (width - 64) / ticks.length < String(ticks.length).length * 7 + 4) throw new RangeError("RangeChart width must retain distinct ordinal tick labels.");
  const color = assignCategoricalColor(0);
  const headers = [labels.category, labels.from, labels.to, ...(hasStatus ? [labels.status!] : [])];
  return <ChartFrame title={title} description={description} fit={fit} width={width} height={height}
    table={{ headers, rows: rows.map(row => [row.label, row.from, row.to, ...(hasStatus ? [row.status?.label ?? ""] : [])]) }}
    tableFallbackLabel={labels.table} showSingleSeriesLegend legend={ticks.map((tick, index) => ({ label: `${index + 1} ${tick}`, color }))}
    className={cx("wrap-anywhere", className)} style={style}>
    {plot => {
      const x = linearScale([0, ticks.length], [plot.x, plot.x + plot.width]);
      let offset = 0;
      return <>
        <g data-chart-part="ticks" aria-hidden="true" fill={CHART_INLINE_AXIS_LABEL} fontSize={11} fontFamily={CHART_FONT_BODY}>
          {ticks.map((tick, index) => <text key={index} x={x(index + 0.5)} y={plot.y + plot.height + 16} textAnchor="middle">{numbered ? index + 1 : tick}</text>)}
        </g>
        {layouts.map(({ row, name, status, pitch }) => {
          const top = plot.y + offset;
          offset += pitch;
          const statusY = top + name.length * 14;
          const barY = statusY + (status.length ? 18 + (status.length - 1) * 14 : 0) + 4;
          return <g key={row.id} data-chart-part="range-row" data-chart-row-id={row.id} aria-hidden="true">
            <text data-chart-part="row-label" x={plot.x} y={top + 9} fill={CHART_INLINE_AXIS_LABEL} fontFamily={CHART_FONT_BODY} fontSize={11}>
              {name.map((line, index) => <tspan key={index} x={plot.x} dy={index ? 14 : 0}>{line}</tspan>)}
            </text>
            {row.status ? <g data-chart-part="status" data-tone={row.status.tone} transform={`translate(${plot.x} ${statusY})`}>
              <g aria-hidden="true" data-part="mark" data-shape={STATUS_SHAPE[row.status.tone]} className={STATUS_MARK_CLASSES[row.status.tone]}>
                {STATUS_GLYPH[STATUS_SHAPE[row.status.tone]]}
              </g>
              <text x={14} y={5} dominantBaseline="middle" className={STATUS_TEXT_CLASSES[row.status.tone]}
                fill="currentColor" fontFamily={CHART_FONT_BODY} fontSize={11}>
                {status.map((line, index) => <tspan key={index} x={14} dy={index ? 14 : 0}>{line}</tspan>)}
              </text>
            </g> : null}
            <rect data-chart-part="range" x={x(row.from)} y={barY} width={x(row.to) - x(row.from)} height={8}
              fill={color} style={{ rx: CHART_MARK_RADIUS } as CSSProperties} />
          </g>;
        })}
      </>;
    }}
  </ChartFrame>;
}
