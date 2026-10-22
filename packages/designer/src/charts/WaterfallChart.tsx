import type { CSSProperties } from "react";
import { cx } from "../atoms/internal/cx.js";
import { ChartFrame, type ChartFrameProps } from "./ChartFrame.js";
import { CHART_DIVERGING_NEGATIVE, CHART_DIVERGING_NEUTRAL, CHART_DIVERGING_POSITIVE, CHART_FONT_BODY, CHART_GRID } from "./internal/chart-vars.js";
import { CHART_HAIRLINE, CHART_INLINE_AXIS_LABEL, CHART_LABEL_BACKDROP, CHART_MARK_RADIUS } from "./internal/marks.js";
import { bandScale, formatTickValue, linearScale, niceTicks } from "./internal/scale.js";

/** A static bridge of opening total, authored changes, and derived closing total. */
export interface WaterfallChartProps {
  start: { readonly label: string; readonly value: number };
  steps: readonly { readonly id: string; readonly label: string; readonly value: number }[];
  /** Optional value is an assertion against the accumulated total, never a separate closing geometry. */
  end: { readonly label: string; readonly value?: number };
  labels: { readonly table: string; readonly category: string; readonly value: string };
  title: string;
  description?: string;
  /** @default "fluid" */
  fit?: ChartFrameProps["fit"];
  /** @default 360 */
  width?: number;
  /** @default 280 */
  height?: number;
  /** Formats unsigned magnitude; the chart owns visible signs. */
  valueFormat?: (value: number) => string;
  className?: string;
  style?: CSSProperties;
}

interface Stage {
  key: string;
  label: string;
  from: number;
  to: number;
  value: number;
  total: boolean;
}

function finite(value: number) {
  if (!Number.isFinite(value)) throw new RangeError("WaterfallChart requires finite values and accumulated totals.");
}

/** Computes exact running endpoints before rendering; all marks and text share this accumulation. */
export function WaterfallChart({ start, steps, end, labels, title, description,
  fit = "fluid", width = 360, height = 280, valueFormat = formatTickValue, className, style,
}: WaterfallChartProps) {
  if (!labels || [labels.table, labels.category, labels.value].some(value => typeof value !== "string" || !value.trim())) {
    throw new TypeError("WaterfallChart requires authored table, category, and value labels.");
  }
  finite(start.value);
  let running = start.value;
  let sumAbs = Math.abs(start.value);
  let low = Math.min(0, start.value);
  let high = Math.max(0, start.value);
  const ids = new Set<string>();
  const stages: Stage[] = [{ key: "start", label: start.label, from: 0, to: running, value: running, total: true }];
  for (const step of steps) {
    if (!step.id.trim() || ids.has(step.id)) throw new RangeError("WaterfallChart requires unique nonblank step IDs.");
    ids.add(step.id);
    finite(step.value);
    const from = running;
    running += step.value;
    sumAbs += Math.abs(step.value);
    finite(running);
    finite(sumAbs);
    low = Math.min(low, running);
    high = Math.max(high, running);
    stages.push({ key: `step:${step.id}`, label: step.label, from, to: running, value: step.value, total: false });
  }
  if (end.value !== undefined) {
    finite(end.value);
    const tolerance = steps.length ? Number.EPSILON * sumAbs * steps.length : 0;
    finite(tolerance);
    if (Math.abs(end.value - running) > tolerance) throw new RangeError("WaterfallChart closing value must equal its accumulated total.");
  }
  stages.push({ key: "end", label: end.label, from: 0, to: running, value: running, total: true });
  const display = (value: number, signed = true) => value < 0 ? `−${valueFormat(Math.abs(value))}`
    : value > 0 && signed ? `+${valueFormat(value)}` : valueFormat(value === 0 ? 0 : value);
  const color = (stage: Stage) => stage.total || stage.value === 0 ? CHART_DIVERGING_NEUTRAL
    : stage.value > 0 ? CHART_DIVERGING_POSITIVE : CHART_DIVERGING_NEGATIVE;
  const domain: [number, number] = low === high ? [0, 1] : [low, high];
  finite(domain[1] - domain[0]);
  const magnitude = Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
  const normalized = niceTicks(domain[0] / magnitude, domain[1] / magnitude)
    .filter(value => value >= domain[0] / magnitude && value <= domain[1] / magnitude);
  const ticks = [...new Set(normalized.map(value => value * magnitude).filter(Number.isFinite).map(value => value === 0 ? 0 : value))];
  const slotWidth = (width - 64) / stages.length;
  const numbered = stages.some(stage => stage.label.length * 6 > slotWidth - 4);
  const legend = numbered ? stages.map((stage, index) => ({ label: `${index + 1} ${stage.label}`, color: color(stage) })) : undefined;
  return (
    <ChartFrame title={title} description={description} fit={fit} width={width} height={height}
      table={{ headers: [labels.category, labels.value], rows: stages.map(stage => [stage.label, display(stage.value)]) }}
      tableFallbackLabel={labels.table} legend={legend} className={cx("wrap-anywhere", className)} style={style}>
      {plot => {
        const y = linearScale(domain, [plot.y + plot.height, plot.y]);
        const bands = bandScale(stages.map(stage => stage.key), [plot.x, plot.x + plot.width], 0.3);
        const barWidth = Math.min(24, bands.bandwidth);
        const marks = stages.map(stage => ({ stage, x: bands(stage.key) + (bands.bandwidth - barWidth) / 2,
          top: Math.min(y(stage.from), y(stage.to)), height: Math.abs(y(stage.to) - y(stage.from)) }));
        return <>
          <g data-chart-part="grid" aria-hidden="true">
            {ticks.map(tick => <line key={tick} x1={plot.x} x2={plot.x + plot.width} y1={y(tick)} y2={y(tick)}
              stroke={CHART_GRID} strokeWidth={CHART_HAIRLINE} />)}
          </g>
          <g data-chart-part="ticks" aria-hidden="true" fontSize={11} fontFamily={CHART_FONT_BODY} fill={CHART_INLINE_AXIS_LABEL}>
            {ticks.map(tick => <text key={`y-${tick}`} x={plot.x - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">{display(tick, false)}</text>)}
            {marks.map(({ stage, x }, index) => <text key={stage.key} x={x + barWidth / 2} y={plot.y + plot.height + 16} textAnchor="middle">{numbered ? index + 1 : stage.label}</text>)}
          </g>
          <g aria-hidden="true">
            {marks.slice(0, -1).map(({ stage, x }, index) => <line key={stage.key} x1={x + barWidth} x2={marks[index + 1]!.x}
              y1={y(stage.to)} y2={y(stage.to)} stroke={CHART_INLINE_AXIS_LABEL} strokeWidth={CHART_HAIRLINE} />)}
            {marks.map(({ stage, x, top, height: barHeight }) => <rect key={stage.key} x={x} y={top} width={barWidth} height={barHeight}
              fill={color(stage)} stroke={stage.total ? CHART_INLINE_AXIS_LABEL : undefined} strokeWidth={stage.total ? CHART_HAIRLINE : undefined}
              vectorEffect={stage.total ? "non-scaling-stroke" : undefined} style={{ rx: CHART_MARK_RADIUS } as CSSProperties} />)}
          </g>
          <g aria-hidden="true" fontSize={11} fontFamily={CHART_FONT_BODY} fill={CHART_INLINE_AXIS_LABEL}>
            {marks.map(({ stage, x, top }) => <text key={stage.key} x={x + barWidth / 2}
              y={top - 7} textAnchor="middle" dominantBaseline="middle"
              stroke={CHART_LABEL_BACKDROP} strokeWidth={CHART_HAIRLINE} style={{ paintOrder: "stroke" }}>{display(stage.value)}</text>)}
          </g>
        </>;
      }}
    </ChartFrame>
  );
}
