import type { CSSProperties } from "react";
import { ChartFrame, type ChartFrameProps, type ChartTableSpec } from "./ChartFrame.js";
import type { LineChartProps } from "./LineChart.js";
import { CHART_FONT_BODY, CHART_GRID, MAX_CATEGORICAL_SERIES } from "./internal/chart-vars.js";
import { CHART_HAIRLINE, CHART_INLINE_AXIS_LABEL, CHART_LABEL_BACKDROP, CHART_MARK_RADIUS } from "./internal/marks.js";
import { createLineData, createLinePlot, createLineMark, defaultLineXFormat } from "./internal/line-geometry.js";
import { formatTickValue } from "./internal/scale.js";

/** Static line geometry with the published data and formatting props. */
export function LineChart({
  x, series, colorDomain, title, description,
  /** @default "fixed" */
  fit = "fixed", width: authoredWidth, height = 280,
  valueFormat = formatTickValue, xFormat = defaultLineXFormat,
  /** @default "X" */
  xColumnLabel = "X", tableFallbackLabel, className, style,
}: LineChartProps & Pick<ChartFrameProps, "fit">) {
  const width = authoredWidth ?? (fit === "fluid" ? 360 : 480);
  if (series.length > MAX_CATEGORICAL_SERIES && typeof console !== "undefined") {
    console.warn(
      `LineChart: ${series.length} series were passed but this palette supports at most ${MAX_CATEGORICAL_SERIES} ` +
        `(see assignCategoricalColor). Series past the ${MAX_CATEGORICAL_SERIES}th were dropped.`,
    );
  }
  const data = createLineData({ x, series, colorDomain });
  const table: ChartTableSpec = {
    headers: [xColumnLabel, ...data.visibleSeries.map(item => item.name)],
    rows: x.map((value, index) => [xFormat(value), ...data.visibleSeries.map(item => valueFormat(item.values[index] ?? 0))]),
  };

  return (
    <ChartFrame title={title} description={description} width={width} height={height} fit={fit}
      legend={data.legend} showSingleSeriesLegend table={table} tableFallbackLabel={tableFallbackLabel}
      className={className} style={style} xTicks={[]} yTicks={[]}>
      {plot => {
        const { y, xScale, xTickValues } = createLinePlot(x, data, plot);
        const yTicks = data.yTicks.filter(tick => tick >= data.domainMin && tick <= data.domainMax);
        const marks = data.visibleSeries.map(item => createLineMark(x, item.values, xScale, y));
        const directLabels = data.showDirectLabels ? data.visibleSeries.flatMap((item, index) => {
          const last = marks[index]!.last;
          return last ? [{ item, index, last, text: `${item.name} ${valueFormat(item.values[x.length - 1] ?? 0)}`,
            y: Math.max(plot.y + 12, last[1] - 12) }] : [];
        }) : [];
        const orderedLabels = [...directLabels].sort((a, b) => a.y - b.y || a.index - b.index);
        const labelTop = plot.y + 12;
        const labelBottom = plot.y + plot.height - 12;
        if (directLabels.some(label => label.text.length * 11 > plot.width - 12) ||
          labelBottom - labelTop < (orderedLabels.length - 1) * 14) {
          // Conservative character widths keep cramped labels in the complete legend and table.
          directLabels.length = 0;
        } else {
          for (let index = 1; index < orderedLabels.length; index++) {
            orderedLabels[index]!.y = Math.max(orderedLabels[index]!.y, orderedLabels[index - 1]!.y + 14);
          }
          for (let index = orderedLabels.length - 1; index >= 0; index--) {
            const limit = index === orderedLabels.length - 1 ? labelBottom : orderedLabels[index + 1]!.y - 14;
            orderedLabels[index]!.y = Math.min(orderedLabels[index]!.y, limit);
          }
        }
        return (
          <>
            <g data-chart-part="grid" aria-hidden="true">
              {yTicks.map(tick => (
                <line key={tick} x1={plot.x} x2={plot.x + plot.width} y1={y(tick)} y2={y(tick)}
                  stroke={CHART_GRID} strokeWidth={CHART_HAIRLINE} />
              ))}
            </g>
            <g data-chart-part="ticks" aria-hidden="true" fontSize={11}
              fill={CHART_INLINE_AXIS_LABEL} fontFamily={CHART_FONT_BODY}>
              {yTicks.map(tick => (
                <text key={`y-${tick}`} x={plot.x - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                  {valueFormat(tick)}
                </text>
              ))}
              {xTickValues.map((value, index) => (
                <text key={index} x={xScale(value as never)} y={plot.y + plot.height + 16}
                  textAnchor={xTickValues.length > 1 && index === xTickValues.length - 1 ? "end" : "middle"}>
                  {xFormat(value as Date | number)}
                </text>
              ))}
            </g>
            {data.visibleSeries.map((item, index) => {
              const { d, last } = marks[index]!;
              const color = data.legend[index]!.color;
              return (
                <g key={item.name} data-chart-part="series" aria-hidden="true">
                  <path d={d} fill="none" stroke={color} strokeWidth={CHART_HAIRLINE}
                    strokeLinejoin="round" strokeLinecap="round" />
                  {last ? <circle cx={last[0]} cy={last[1]} fill={color}
                    style={{ r: CHART_MARK_RADIUS } as CSSProperties} /> : null}
                </g>
              );
            })}
            <g data-chart-part="direct-labels" aria-hidden="true">
              {directLabels.map(({ item, last, text, y: labelY }) => (
                <text key={item.name} data-chart-part="direct-label" x={last[0] <= plot.x ? last[0] + 6 : last[0] - 6} y={labelY}
                  textAnchor={last[0] <= plot.x ? "start" : "end"} dominantBaseline="middle" fontSize={11}
                  fill={CHART_INLINE_AXIS_LABEL} fontFamily={CHART_FONT_BODY}
                  stroke={CHART_LABEL_BACKDROP} strokeWidth={CHART_HAIRLINE} style={{ paintOrder: "stroke" }}>
                  {text}
                </text>
              ))}
            </g>
          </>
        );
      }}
    </ChartFrame>
  );
}
