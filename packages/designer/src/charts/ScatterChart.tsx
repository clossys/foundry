import type { CSSProperties } from "react";
import { cx } from "../components/internal/cx.js";
import { ChartFrame, type ChartFrameProps } from "./ChartFrame.js";
import { CHART_FONT_BODY, CHART_GRID, assignCategoricalColor } from "./internal/chart-vars.js";
import { CHART_HAIRLINE, CHART_INLINE_AXIS_LABEL, CHART_LABEL_BACKDROP } from "./internal/marks.js";
import { formatTickValue } from "./internal/scale.js";
import { scatterAxis, scatterGlyph, type ScatterMark } from "./internal/scatter-geometry.js";

/** Static numeric observations with optional area-scaled, equal-area series glyphs. */
export interface ScatterChartProps {
  points: readonly { readonly id: string; readonly label: string; readonly x: number; readonly y: number;
    readonly size?: number; readonly series?: string; readonly labelSide?: "start" | "end" | "above" | "below" }[];
  x: { readonly label: string; readonly min?: number; readonly max?: number };
  y: { readonly label: string; readonly min?: number; readonly max?: number };
  size?: { readonly label: string };
  series?: readonly { readonly id: string; readonly name: string }[];
  labels: { readonly table: string; readonly category: string };
  title: string;
  description?: string;
  /** @default "fluid" */
  fit?: ChartFrameProps["fit"];
  /** @default 360 */
  width?: number;
  /** @default 300 */
  height?: number;
  valueFormat?: (value: number) => string;
  className?: string;
  style?: CSSProperties;
}
const SHAPES: readonly ScatterMark[] = ["circle", "square", "diamond", "triangle"];
function authored(value: unknown) { return typeof value === "string" && Boolean(value.trim()); }
function graphemes(text: string) { return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(part => part.segment); }
function axisLines(text: string, maximum = 16) {
  const characters = graphemes(text), result: string[] = [];
  for (let index = 0; index < characters.length; index += maximum) result.push(characters.slice(index, index + maximum).join(""));
  return result;
}

/** Each shape has equal unit area; size scales its lengths by a square root. */
export function ScatterChart({ points, x, y, size, series, labels, title, description,
  fit = "fluid", width = 360, height = 300, valueFormat = formatTickValue, className, style,
}: ScatterChartProps) {
  if (!labels || !authored(labels.table) || !authored(labels.category) || !authored(x.label) || !authored(y.label) || size && !authored(size.label)) {
    throw new TypeError("ScatterChart requires authored table, category, and axis labels.");
  }
  if (graphemes(x.label).length > 32 || graphemes(y.label).length > 32) throw new RangeError("ScatterChart axis titles must contain at most thirty-two graphemes.");
  if (points.length < 3 || points.length > 12 || (series?.length ?? 0) > 4) {
    throw new RangeError("ScatterChart requires three to twelve points and at most four declared series.");
  }
  const ids = new Set<string>(), seriesIds = new Map<string, number>();
  for (const [index, entry] of (series ?? []).entries()) {
    if (!authored(entry.id) || !authored(entry.name) || seriesIds.has(entry.id)) throw new RangeError("ScatterChart requires unique nonblank series IDs and nonblank names.");
    seriesIds.set(entry.id, index);
  }
  for (const point of points) {
    if (!authored(point.id) || !authored(point.label) || ids.has(point.id)) throw new RangeError("ScatterChart requires unique nonblank point IDs and authored labels.");
    ids.add(point.id);
    if (graphemes(point.label).length > 20) throw new RangeError("ScatterChart point labels must contain at most twenty graphemes.");
    if (seriesIds.size ? !point.series || !seriesIds.has(point.series) : point.series !== undefined) throw new RangeError("ScatterChart point series must match its declared series domain.");
    if (size ? point.size === undefined || !Number.isFinite(point.size) || point.size < 0 : point.size !== undefined) throw new RangeError("ScatterChart sizing requires a finite nonnegative size on every point.");
    if (point.labelSide !== undefined && !["start", "end", "above", "below"].includes(point.labelSide)) throw new RangeError("ScatterChart label side must be authored as a supported side.");
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 240 || height < 240) throw new RangeError("ScatterChart dimensions must contain its plot and glyphs.");
  const horizontal = scatterAxis(points.map(point => point.x), x.min, x.max);
  const vertical = scatterAxis(points.map(point => point.y), y.min, y.max);
  const verticalTitle = axisLines(y.label);
  const horizontalTitle = axisLines(x.label, Math.max(1, Math.floor((width - 8) / 11)));
  const longestTick = Math.max(...vertical.ticks.map(value => graphemes(valueFormat(value)).length));
  const left = 60 + (verticalTitle.length - 1) * 14 + Math.max(0, longestTick * 11 - 24);
  if (left + 32 >= width) throw new RangeError("ScatterChart dimensions must retain its complete tick labels and plot.");
  const tickBoxes = horizontal.ticks.map(value => {
    const position = horizontal.position(value, left, width - 16);
    const tickWidth = graphemes(valueFormat(value)).length * 11;
    const start = value === horizontal.ticks[0] ? position : value === horizontal.ticks[horizontal.ticks.length - 1] ? position - tickWidth : position - tickWidth / 2;
    return { value, start, end: start + tickWidth };
  });
  const firstTick = tickBoxes[0]!, lastTick = tickBoxes[tickBoxes.length - 1]!;
  if (firstTick.end + 4 > lastTick.start) throw new RangeError("ScatterChart dimensions must retain distinct complete endpoint tick labels.");
  const visibleXTicks = [firstTick.value];
  let previousTickEnd = firstTick.end;
  for (const tick of tickBoxes.slice(1, -1)) {
    if (tick.start >= previousTickEnd + 4 && tick.end + 4 <= lastTick.start) {
      visibleXTicks.push(tick.value);
      previousTickEnd = tick.end;
    }
  }
  visibleXTicks.push(lastTick.value);
  const maximum = size ? Math.max(...points.map(point => point.size!)) : 0;
  const legend = (series ?? []).map((entry, index) => ({ label: entry.name, color: assignCategoricalColor(index), mark: SHAPES[index]! }));
  const headers = [labels.category, x.label, y.label, ...(size ? [size.label] : [])];
  const rows = points.map(point => {
    const index = point.series === undefined ? undefined : seriesIds.get(point.series);
    const name = index === undefined ? point.label : `${point.label} (${series![index]!.name})`;
    return [name, valueFormat(point.x), valueFormat(point.y), ...(size ? [valueFormat(point.size!)] : [])];
  });
  const frame = <ChartFrame interactive title={title} description={description} fit={fit} width={width} height={height}
    margin={{ top: 32, bottom: 64 + (horizontalTitle.length - 1) * 14, left }} table={{ headers, rows }} tableFallbackLabel={labels.table} legend={legend} className={cx("wrap-anywhere", className)} style={style}>
    {plot => {
      const px = (value: number) => horizontal.position(value, plot.x, plot.x + plot.width);
      const py = (value: number) => vertical.position(value, plot.y + plot.height, plot.y);
      return <>
        <g data-chart-part="grid" aria-hidden="true">
          {vertical.ticks.map(value => <line key={value} x1={plot.x} x2={plot.x + plot.width} y1={py(value)} y2={py(value)} stroke={CHART_GRID} strokeWidth={CHART_HAIRLINE} />)}
        </g>
        <g aria-hidden="true" fill={CHART_INLINE_AXIS_LABEL} fontSize={11} fontFamily={CHART_FONT_BODY}>
          <g data-chart-part="x-ticks">{visibleXTicks.map(value => <text key={value} x={px(value)} y={plot.y + plot.height + 40} textAnchor={value === visibleXTicks[0] ? "start" : value === visibleXTicks[visibleXTicks.length - 1] ? "end" : "middle"}>{valueFormat(value)}</text>)}</g>
          <g data-chart-part="y-ticks">{vertical.ticks.map(value => <text key={value} x={plot.x - 20} y={py(value)} textAnchor="end" dominantBaseline="middle">{valueFormat(value)}</text>)}</g>
          <text x={width / 2} y={height - 3 - (horizontalTitle.length - 1) * 14} textAnchor="middle">
            {horizontalTitle.map((line, index) => <tspan key={index} x={width / 2} dy={index ? 14 : 0}>{line}</tspan>)}
          </text>
          <text x={12} y={plot.y + plot.height / 2} textAnchor="middle" transform={`rotate(-90 12 ${plot.y + plot.height / 2})`}>
            {verticalTitle.map((line, index) => <tspan key={index} x={12} dy={index ? 14 : 0}>{line}</tspan>)}
          </text>
        </g>
        {points.map(point => {
          const index = point.series === undefined ? 0 : seriesIds.get(point.series)!;
          const mark = SHAPES[index]!, fill = assignCategoricalColor(index), centerX = px(point.x), centerY = py(point.y);
          const scale = size ? maximum === 0 ? 0 : 16 * (Math.sqrt(point.size!) / Math.sqrt(maximum)) : 8;
          const glyph = scatterGlyph(mark, centerX, centerY, scale);
          const textWidth = graphemes(point.label).length * 11;
          const startRoom = centerX - glyph.left - plot.x - 6, endRoom = plot.x + plot.width - centerX - glyph.right - 6;
          const preferred = centerX > plot.x + plot.width / 2 ? "start" : "end";
          const side = point.labelSide ?? (preferred === "start" && startRoom >= textWidth ? "start"
            : preferred === "end" && endRoom >= textWidth ? "end" : startRoom >= textWidth ? "start" : endRoom >= textWidth ? "end" : "above");
          if (point.labelSide === "start" && startRoom < textWidth || point.labelSide === "end" && endRoom < textWidth) throw new RangeError("ScatterChart authored label side must have space for its complete text.");
          const centeredLabelX = Math.max(4 + textWidth / 2, Math.min(width - 4 - textWidth / 2, centerX));
          const labelX = side === "start" ? centerX - glyph.left - 6 : side === "end" ? centerX + glyph.right + 6 : centeredLabelX;
          const labelY = side === "above" ? centerY - glyph.top - 8 : side === "below" ? centerY + glyph.bottom + 9 : centerY;
          return <ChartFrame.Tooltip key={point.id} plot={plot} x={centerX} y={centerY}
            text={`${point.label}: ${x.label} ${valueFormat(point.x)}; ${y.label} ${valueFormat(point.y)}${size ? `; ${size.label} ${valueFormat(point.size!)}` : ""}${point.series ? `; ${series![index]!.name}` : ""}`}>
            <g data-chart-point={point.id} aria-hidden="true">
            {mark === "circle" ? <circle data-chart-marker={mark} cx={centerX} cy={centerY} r={glyph.radius} fill={fill} />
              : <path data-chart-marker={mark} d={glyph.path} fill={fill} />}
            <text data-chart-part="point-label" x={labelX} y={labelY} textAnchor={side === "start" ? "end" : side === "end" ? "start" : "middle"}
              dominantBaseline="middle" fontSize={11} fontFamily={CHART_FONT_BODY} fill={CHART_INLINE_AXIS_LABEL}
              stroke={CHART_LABEL_BACKDROP} strokeWidth={CHART_HAIRLINE} style={{ paintOrder: "stroke" }}>{point.label}</text>
          </g></ChartFrame.Tooltip>;
        })}
      </>;
    }}
  </ChartFrame>;
  return size ? <div className="flex flex-col gap-sm"><p data-chart-part="size-label" className="m-0 text-body-s text-ink-secondary font-body wrap-anywhere">{size.label}</p>{frame}</div> : frame;
}
