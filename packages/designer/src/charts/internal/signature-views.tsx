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
  statusIntervals,
} from "./signature-geometry.js";
import type {
  AreaChartProps,
  HeatmapProps,
  SignatureChartProps,
  SignatureChartLabels,
  StatusStripProps,
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
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

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

export function HeatmapView({
  props,
  interaction = staticInspection(props),
}: {
  props: HeatmapProps;
  interaction?: Inspection;
}) {
  const {
    title,
    description,
    width = 480,
    height = 280,
    rows,
    columns,
    values,
    loading,
    categorical = false,
    colorDomain,
    valueFormat = String,
    tableFallbackLabel,
    className,
    style,
  } = props;
  const labels = resolveLabels(props);
  assertSize(width, height);
  if (
    values.length !== rows.length ||
    values.some((row) => row.length !== columns.length)
  )
    throw new RangeError("Heatmap requires one value per row and column.");
  if (
    [...rows, ...columns].some((label) => !label.trim()) ||
    new Set(rows).size !== rows.length ||
    new Set(columns).size !== columns.length
  )
    throw new TypeError(
      "Heatmap requires unique nonempty row and column names.",
    );
  const flat = values.flat(),
    present = flat.filter((value) => value !== null);
  if (
    !categorical &&
    present.some(
      (value) => typeof value !== "number" || !Number.isFinite(value),
    )
  )
    throw new TypeError(
      "Sequential Heatmap values must be finite numbers or null.",
    );
  const categories = colorDomain ?? [...new Set(present.map(String))];
  if (
    categorical &&
    (categories.length > 8 ||
      new Set(categories).size !== categories.length ||
      present.some((value) => !categories.includes(String(value))))
  )
    throw new RangeError(
      "Heatmap categorical domain must contain every value and at most eight unique identities.",
    );
  const numeric = categorical ? [] : (present as number[]);
  const min = numeric.reduce(
    (result, value) => Math.min(result, value),
    Infinity,
  );
  const max = numeric.reduce(
    (result, value) => Math.max(result, value),
    -Infinity,
  );
  const empty = !rows.length || !columns.length;
  const active = inspected(interaction.active, flat.length);
  function name(index: number) {
    return `${rows[Math.floor(index / columns.length)]}, ${columns[index % columns.length]}, ${flat[index] === null ? labels.missing : valueFormat(flat[index]!)}`;
  }
  function fill(value: number | string | null) {
    if (value === null) return CHART_SURFACE;
    if (categorical)
      return assignCategoricalColor(categories.indexOf(String(value)));
    const fraction = min === max ? 0 : ((value as number) - min) / (max - min);
    return chartSequentialVar(
      CHART_SEQUENTIAL_STEPS[Math.round(fraction * 6)]!,
    );
  }
  function key(event: KeyboardEvent<SVGRectElement>, index: number) {
    const row = Math.floor(index / columns.length),
      column = index % columns.length;
    let next = index;
    if (event.key === "ArrowRight")
      next = row * columns.length + Math.min(columns.length - 1, column + 1);
    else if (event.key === "ArrowLeft")
      next = row * columns.length + Math.max(0, column - 1);
    else if (event.key === "ArrowDown")
      next = Math.min(rows.length - 1, row + 1) * columns.length + column;
    else if (event.key === "ArrowUp")
      next = Math.max(0, row - 1) * columns.length + column;
    else if (event.key === "Home")
      next = event.ctrlKey ? 0 : row * columns.length;
    else if (event.key === "End")
      next = event.ctrlKey ? flat.length - 1 : (row + 1) * columns.length - 1;
    else {
      stepKey(event, index, flat.length, interaction);
      return;
    }
    event.preventDefault();
    const cell = event.currentTarget
      .closest('[role="grid"]')
      ?.querySelectorAll<SVGRectElement>('[role="gridcell"]')[next];
    cell?.focus();
  }
  return (
    <div>
      <ChartFrame
        interactive={Boolean(interaction.inspect)}
        title={title}
        description={description}
        width={width}
        height={height}
        table={{
          headers: [labels.rowColumn, ...columns],
          rows: rows.map((row, index) => [
            row,
            ...values[index]!.map((value) =>
              value === null ? labels.missing : valueFormat(value),
            ),
          ]),
        }}
        tableFallbackLabel={tableFallbackLabel}
        className={className}
        style={style}
        xTicks={
          empty || loading
            ? []
            : columns.map((label, index) => ({
                label,
                position: 48 + ((index + 0.5) * (width - 64)) / columns.length,
              }))
        }
        yTicks={
          empty || loading
            ? []
            : rows.map((label, index) => ({
                label,
                position: 16 + ((index + 0.5) * (height - 48)) / rows.length,
              }))
        }
      >
        {(plot) => (
          <>
            <State loading={loading} empty={empty} labels={labels} />
            {!loading && !empty ? (
              <g
                role={interaction.inspect ? "grid" : undefined}
                aria-label={title}
                aria-rowcount={interaction.inspect ? rows.length : undefined}
                aria-colcount={interaction.inspect ? columns.length : undefined}
              >
                {rows.map((row, r) => (
                  <g role={interaction.inspect ? "row" : undefined} key={row}>
                    {columns.map((column, c) => {
                      const index = r * columns.length + c;
                      return (
                        <rect
                          key={column}
                          role={interaction.inspect ? "gridcell" : undefined}
                          aria-label={name(index)}
                          aria-rowindex={
                            interaction.inspect ? r + 1 : undefined
                          }
                          aria-colindex={
                            interaction.inspect ? c + 1 : undefined
                          }
                          aria-selected={
                            interaction.inspect
                              ? interaction.selected === index
                              : undefined
                          }
                          data-chart-part="cell"
                          tabIndex={
                            interaction.inspect
                              ? index === (active ?? 0)
                                ? 0
                                : -1
                              : undefined
                          }
                          className={focusClass}
                          x={plot.x + (c * plot.width) / columns.length}
                          y={plot.y + (r * plot.height) / rows.length}
                          width={plot.width / columns.length}
                          height={plot.height / rows.length}
                          fill={fill(values[r]![c]!)}
                          stroke={CHART_GRID}
                          strokeWidth={1}
                          onFocus={
                            interaction.inspect
                              ? () => interaction.inspect?.(index)
                              : undefined
                          }
                          onPointerEnter={
                            interaction.inspect
                              ? () => interaction.inspect?.(index)
                              : undefined
                          }
                          onClick={
                            interaction.select
                              ? () => interaction.select?.(index)
                              : undefined
                          }
                          onKeyDown={
                            interaction.inspect
                              ? (event) => key(event, index)
                              : undefined
                          }
                        />
                      );
                    })}
                  </g>
                ))}
              </g>
            ) : null}
            {!loading && !empty && active !== null ? <ChartFrame.Tooltip plot={plot}
              x={plot.x + ((active % columns.length) * plot.width) / columns.length}
              y={plot.y} text={name(active)} /> : null}
          </>
        )}
      </ChartFrame>
      {!loading && !empty ? (
        categorical ? (
          <ul
            data-chart-part="categorical-legend"
            className="flex flex-wrap gap-sm text-body-s font-body"
          >
            {categories.map((value, index) => (
              <li key={value}>
                <span
                  aria-hidden="true"
                  style={{ color: assignCategoricalColor(index) }}
                >
                  ■{" "}
                </span>
                {value}
              </li>
            ))}
          </ul>
        ) : (
          <div
            aria-label={labels.scale(Number.isFinite(min) ? valueFormat(min) : labels.missing, Number.isFinite(max) ? valueFormat(max) : labels.missing)}
            className="flex gap-xs text-body-s font-body"
          >
            <span>{Number.isFinite(min) ? valueFormat(min) : labels.missing}</span>
            {CHART_SEQUENTIAL_STEPS.map((step) => (
              <span
                key={step}
                data-chart-part="ramp-step"
                aria-hidden="true"
                className="inline-block h-3 w-3"
                style={{ backgroundColor: chartSequentialVar(step) }}
              />
            ))}
            <span>{Number.isFinite(max) ? valueFormat(max) : labels.missing}</span>
          </div>
        )
      ) : null}
      {active !== null && !loading && !empty ? (
        <output
          data-chart-part="readout"
          aria-live="polite"
          className="text-body-s text-ink-secondary font-body"
        >
          {name(active)}
        </output>
      ) : null}
    </div>
  );
}

export function StatusView({
  props,
  interaction = staticInspection(props),
}: {
  props: StatusStripProps;
  interaction?: Inspection;
}) {
  const {
    title,
    description,
    width = 480,
    height = 100,
    loading,
    intervalFormat = datumLabel,
    tableFallbackLabel,
    className,
    style,
  } = props;
  const id = useId();
  const labels = resolveLabels(props);
  assertSize(width, height);
  const intervals = statusIntervals(props),
    empty = !intervals.length;
  const active = inspected(interaction.active, intervals.length);
  const statuses = ["ok", "warn", "error", "unknown"] as const;
  const name = (index: number) => {
    const item = intervals[index]!;
    return `${labels.status(item.status)}: ${intervalFormat(item.from)}–${intervalFormat(item.to)}`;
  };
  const scale = linearScale(
    [
      coordinate(intervals[0]?.from ?? 0),
      coordinate(intervals.at(-1)?.to ?? 1),
    ],
    [48, width - 16],
  );
  return (
    <div>
      <ChartFrame
        interactive={Boolean(interaction.inspect)}
        title={title}
        description={description}
        width={width}
        height={height}
        table={{
          headers: [labels.fromColumn, labels.toColumn, labels.statusColumn],
          rows: intervals.map((item) => [
            intervalFormat(item.from),
            intervalFormat(item.to),
            labels.status(item.status),
          ]),
        }}
        tableFallbackLabel={tableFallbackLabel}
        className={className}
        style={style}
        xTicks={
          empty || loading
            ? []
            : [
                { position: 48, label: intervalFormat(intervals[0]!.from) },
                {
                  position: width - 16,
                  label: intervalFormat(intervals.at(-1)!.to),
                },
              ]
        }
      >
        {(plot) => (
          <>
            <State loading={loading} empty={empty} labels={labels} />
            {!loading && !empty ? (
              <>
                <defs>
                  {statuses.map((status, index) => (
                    <pattern
                      key={status}
                      id={`${id}-${status}`}
                      width={8}
                      height={8}
                      patternUnits="userSpaceOnUse"
                    >
                      <rect
                        width={8}
                        height={8}
                        fill={assignCategoricalColor(index)}
                      />
                      <path
                        d={
                          [
                            "M0,8 L8,0",
                            "M0,0 L8,8 M0,8 L8,0",
                            "M0,4 L8,4 M4,0 L4,8",
                            "M0,0 L0,8 M4,0 L4,8",
                          ][index]
                        }
                        stroke={CHART_AXIS_LABEL}
                        strokeWidth={1}
                      />
                    </pattern>
                  ))}
                </defs>
                {intervals.map((item, index) => (
                  <rect
                    key={`${coordinate(item.from)}:${coordinate(item.to)}`}
                    data-chart-part="segment"
                    x={scale(coordinate(item.from))}
                    y={plot.y}
                    width={
                      scale(coordinate(item.to)) - scale(coordinate(item.from))
                    }
                    height={plot.height}
                    fill={`url(#${id}-${item.status})`}
                    tabIndex={interaction.inspect ? 0 : undefined}
                    role={interaction.inspect ? "button" : undefined}
                    aria-label={name(index)}
                    aria-pressed={
                      interaction.inspect
                        ? interaction.selected === index
                        : undefined
                    }
                    className={focusClass}
                    onFocus={
                      interaction.inspect
                        ? () => interaction.inspect?.(index)
                        : undefined
                    }
                    onPointerEnter={
                      interaction.inspect
                        ? () => interaction.inspect?.(index)
                        : undefined
                    }
                    onBlur={
                      interaction.inspect
                        ? () => interaction.inspect?.(null)
                        : undefined
                    }
                    onClick={
                      interaction.select
                        ? () => interaction.select?.(index)
                        : undefined
                    }
                    onKeyDown={
                      interaction.inspect
                        ? (event) => {
                            stepKey(
                              event,
                              index,
                              intervals.length,
                              interaction,
                            );
                            if (
                              [
                                "ArrowLeft",
                                "ArrowRight",
                                "ArrowUp",
                                "ArrowDown",
                                "Home",
                                "End",
                              ].includes(event.key)
                            ) {
                              const next =
                                event.key === "Home"
                                  ? 0
                                  : event.key === "End"
                                    ? intervals.length - 1
                                    : Math.max(
                                        0,
                                        Math.min(
                                          intervals.length - 1,
                                          index +
                                            ([
                                              "ArrowRight",
                                              "ArrowDown",
                                            ].includes(event.key)
                                              ? 1
                                              : -1),
                                        ),
                                      );
                              event.currentTarget.parentElement
                                ?.querySelectorAll<SVGRectElement>(
                                  '[data-chart-part="segment"]',
                                )
                                [next]?.focus();
                            }
                          }
                        : undefined
                    }
                  />
                ))}
                {active !== null ? <ChartFrame.Tooltip plot={plot} x={scale(coordinate(intervals[active]!.from))} y={plot.y} text={name(active)} /> : null}
              </>
            ) : null}
          </>
        )}
      </ChartFrame>
      {!loading && !empty ? (
        <ul className="flex flex-wrap gap-sm text-body-s font-body">
          {statuses
            .filter((status) =>
              intervals.some((item) => item.status === status),
            )
            .map((status) => (
              <li data-chart-part="status-label" key={status}>
                {labels.status(status)}
              </li>
            ))}
        </ul>
      ) : null}
      {active !== null && !loading && !empty ? (
        <output
          data-chart-part="readout"
          aria-live="polite"
          className="text-body-s text-ink-secondary font-body"
        >
          {name(active)}
        </output>
      ) : null}
    </div>
  );
}
