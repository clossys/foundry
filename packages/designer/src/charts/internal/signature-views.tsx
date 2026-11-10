import { useId, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { ChartFrame } from "../ChartFrame.js";
import { resolveLabels } from "./signature-labels.js";
import {
  CHART_AXIS_LABEL,
  CHART_FONT_BODY,
  CHART_GRID,
  CHART_SEQUENTIAL_STEPS,
  CHART_SURFACE,
  assignCategoricalColor,
  chartSequentialVar,
  resolveSeriesColor,
} from "./chart-vars.js";
import { formatTickValue, linearScale, niceTicks } from "./scale.js";
import {
  areaGeometry,
  areaPaths,
  assertSize,
  coordinate,
  datumLabel,
} from "./signature-geometry.js";
import type {
  AreaChartProps,
  SignatureChartProps,
  SignatureChartLabels,
} from "./signature-types.js";

export interface Inspection {
  active: number | null;
  selected: number | null;
  inspect?: (index: number | null) => void;
  select?: (index: number | null) => void;
}
export function staticInspection(props: SignatureChartProps): Inspection {
  return {
    active: props.activeIndex ?? null,
    selected: props.selectedIndex ?? null,
  };
}
const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function State({ loading, empty, labels }: { loading?: boolean; empty: boolean; labels: SignatureChartLabels }) {
  return loading || empty ? (
    <text
      role="status"
      x={48}
      y={32}
      fill={CHART_AXIS_LABEL}
      fontFamily={CHART_FONT_BODY}
      fontSize={12}
    >
      {loading ? labels.loading : labels.empty}
    </text>
  ) : null;
}

function inspected(index: number | null, length: number): number | null {
  return index !== null &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < length
    ? index
    : null;
}

function stepKey(
  event: KeyboardEvent<SVGElement>,
  index: number,
  length: number,
  interaction: Inspection,
) {
  let next = index;
  if (event.key === "ArrowRight" || event.key === "ArrowDown")
    next = Math.min(length - 1, index + 1);
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
    next = Math.max(0, index - 1);
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = length - 1;
  else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (inspected(index, length) !== null) interaction.select?.(index);
    return;
  } else if (event.key === "Escape") {
    interaction.inspect?.(null);
    return;
  } else return;
  event.preventDefault();
  interaction.inspect?.(next);
}

export function AreaView({
  props,
  interaction = staticInspection(props),
  hidden = props.hiddenSeries ?? [],
  toggle,
}: {
  props: AreaChartProps;
  interaction?: Inspection;
  hidden?: readonly string[];
  toggle?: (name: string) => void;
}) {
  const {
    title,
    description,
    width = 480,
    height = 280,
    loading,
    x,
    series,
    normalized = false,
    smooth = false,
    colorDomain,
    valueFormat = formatTickValue,
    xFormat = datumLabel,
    tableFallbackLabel,
    className,
    style,
  } = props;
  const labels = resolveLabels(props);
  assertSize(width, height);
  const active = inspected(interaction.active, x.length);
  const empty = !x.length || !series.length;
  const geometry = areaGeometry(
    { ...props, hiddenSeries: hidden },
    { x: 48, y: 16, width: width - 64, height: height - 48 },
  );
  const ticks = niceTicks(geometry.min, geometry.max);
  const table = {
    headers: [labels.xColumn, ...series.map((item) => item.name)],
    rows: x.map((value, index) => [
      xFormat(value),
      ...series.map((item) =>
        item.values[index] === null
          ? labels.missing
          : valueFormat(item.values[index]!),
      ),
    ]),
  };
  const label =
    active === null
      ? ""
      : `${xFormat(x[active]!)}: ${geometry.layers.map((layer) => `${layer.name} ${layer.values[active] === null ? labels.missing : valueFormat(layer.values[active]!)}`).join(", ")}`;
  function pointerIndex(event: PointerEvent<SVGRectElement> | MouseEvent<SVGRectElement>) {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!bounds || !x.length) return null;
    const local =
      (event.clientX - bounds.left) *
      (bounds.width > 0 ? width / bounds.width : 1);
    let closest = 0;
    geometry.px.forEach((value, index) => {
      if (Math.abs(value - local) < Math.abs(geometry.px[closest]! - local))
        closest = index;
    });
    return closest;
  }
  function pointer(event: PointerEvent<SVGRectElement>) {
    const index = pointerIndex(event);
    if (index !== null) interaction.inspect?.(index);
  }
  return (
    <div>
      <ChartFrame
        interactive={Boolean(interaction.inspect)}
        title={title}
        description={description}
        width={width}
        height={height}
        table={table}
        tableFallbackLabel={tableFallbackLabel}
        className={className}
        style={style}
        xTicks={
          empty || loading
            ? []
            : x.map((value, index) => ({
                position: geometry.px[index]!,
                label: xFormat(value),
              }))
        }
        yTicks={
          empty || loading
            ? []
            : ticks.map((value) => ({
                position: geometry.y(value),
                label: normalized ? `${value}%` : valueFormat(value),
              }))
        }
      >
        {(plot) => (
          <>
            <State loading={loading} empty={empty} labels={labels} />
            {!empty && !loading ? (
              <>
                {geometry.layers.map((layer) =>
                  areaPaths(layer.points, geometry.px, geometry.y, smooth).map(
                    (path, index) => (
                      <path
                        key={`${layer.name}:${index}`}
                        data-chart-part="area"
                        data-series={layer.name}
                        d={path}
                        fill={resolveSeriesColor(
                          layer.name,
                          layer.index,
                          colorDomain,
                          layer.color,
                        )}
                        fillOpacity={0.45}
                        stroke={resolveSeriesColor(
                          layer.name,
                          layer.index,
                          colorDomain,
                          layer.color,
                        )}
                        strokeWidth={1}
                      />
                    ),
                  ),
                )}
                {active !== null ? (
                  <line
                    data-chart-part="crosshair"
                    x1={geometry.px[active]}
                    x2={geometry.px[active]}
                    y1={plot.y}
                    y2={plot.y + plot.height}
                    stroke={CHART_AXIS_LABEL}
                  />
                ) : null}
                <rect
                  data-chart-part="hover-overlay"
                  x={plot.x}
                  y={plot.y}
                  width={plot.width}
                  height={plot.height}
                  fill="transparent"
                  tabIndex={interaction.inspect ? 0 : undefined}
                  role={interaction.inspect ? "button" : undefined}
                  aria-label={
                    interaction.inspect
                      ? labels.inspection(title)
                      : undefined
                  }
                  aria-pressed={
                    interaction.inspect
                      ? interaction.selected !== null
                      : undefined
                  }
                  className={focusClass}
                  onFocus={
                    interaction.inspect
                      ? () => interaction.inspect?.(active ?? 0)
                      : undefined
                  }
                  onBlur={
                    interaction.inspect
                      ? () => interaction.inspect?.(null)
                      : undefined
                  }
                  onPointerMove={interaction.inspect ? pointer : undefined}
                  onPointerLeave={
                    interaction.inspect
                      ? () => interaction.inspect?.(null)
                      : undefined
                  }
                  onKeyDown={
                    interaction.inspect
                      ? (event) =>
                          stepKey(event, active ?? -1, x.length, interaction)
                      : undefined
                  }
                  onClick={
                    interaction.select
                      ? (event) => {
                          const index = pointerIndex(event);
                          if (index !== null) {
                            interaction.inspect?.(index);
                            interaction.select?.(index);
                          }
                        }
                      : undefined
                  }
                />
                {active !== null ? <ChartFrame.Tooltip plot={plot} x={geometry.px[active]!} y={plot.y} text={label} /> : null}
              </>
            ) : null}
          </>
        )}
      </ChartFrame>
      {series.length > 0 && !loading ? (
        <div
          role="group"
          aria-label={labels.series(title)}
          className="flex flex-wrap gap-sm"
        >
          {series.map((item, index) =>
            toggle ? (
              <button
                key={item.name}
                type="button"
                aria-pressed={!hidden.includes(item.name)}
                onClick={() => toggle(item.name)}
                className={`text-body-s font-body ${focusClass}`}
              >
                <span
                  aria-hidden="true"
                  style={{
                    color: resolveSeriesColor(
                      item.name,
                      index,
                      colorDomain,
                      item.color,
                    ),
                  }}
                >
                  ■{" "}
                </span>
                {item.name}
              </button>
            ) : (
              <span key={item.name} className="text-body-s font-body">
                {item.name}
              </span>
            ),
          )}
        </div>
      ) : null}
      {active !== null && !loading && !empty ? (
        <output
          data-chart-part="readout"
          aria-live="polite"
          className="text-body-s text-ink-secondary font-body"
        >
          {label}
        </output>
      ) : null}
    </div>
  );
}
