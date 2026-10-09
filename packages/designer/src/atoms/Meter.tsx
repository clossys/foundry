import type { CSSProperties, HTMLAttributes } from "react";
import { cx } from "./internal/cx.js";
import { UI_BORDER_RULE } from "./internal/ui-vars.js";

/**
 * Fill colour. The four status tones repeat a state; `neutral` is a plain
 * quantity; `accent` is a plain quantity in the brand accent (a share of a
 * whole, an allocation), never a state.
 */
export type MeterTone = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

/**
 * `default`: value and limit as one row of body text above the bar.
 * `figure`: the value set large and light (`text-h1`, `text-h0` once its
 * container is `@md` wide, normal weight, tabular) as the panel's focal
 * number, the limit beside it in secondary ink, the bar under both.
 */
export type MeterEmphasis = "default" | "figure";

/**
 * Which side of the limit is allowed. `"max"`: the value should stay at or
 * below the limit (a cap, such as leverage). `"min"`: the value should stay
 * at or above it (a floor, such as cover). Only drawn when `limit` is set.
 */
export type MeterDirection = "max" | "min";

export interface MeterProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** The measured value, in the same unit as `scaleMax` and `limit`. Finite, `>= 0`. */
  value: number;
  /** The value at the far end of the bar. Finite, `> 0`. Values beyond it draw a full bar. */
  scaleMax: number;
  /** Optional limit, drawn as a tick, with the disallowed side shaded. Finite, `>= 0`. */
  limit?: number;
  /** @default "max" */
  direction?: MeterDirection;
  /** Colour of the filled part. Repeats what `valueText` (or a nearby `StatusMark`) says. */
  tone: MeterTone;
  /**
   * Required. The value as visible text ("3.4x", "42%"). The bar is
   * decoration (`aria-hidden`); this text carries the meaning.
   */
  valueText: string;
  /** Optional visible limit text ("limit 3.0x"), shown after the value. */
  limitText?: string;
  /** @default "default" */
  emphasis?: MeterEmphasis;
}

const FILL_CLASSES: Record<MeterTone, string> = {
  success: "bg-status-success",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
  info: "bg-status-info",
  neutral: "bg-ink-secondary",
  accent: "bg-accent",
};

/** The value row per emphasis: the row, the value, and the limit. */
const VALUE_ROW_CLASSES: Record<MeterEmphasis, { row: string; value: string; limit: string }> = {
  default: {
    row: "flex flex-wrap items-baseline justify-between gap-x-sm text-body-s",
    value: "text-ink-primary tabular-nums",
    limit: "text-ink-secondary tabular-nums",
  },
  figure: {
    row: "flex flex-wrap items-baseline justify-between gap-x-md gap-y-xs",
    value: "text-h1 @md:text-h0 font-normal leading-heading text-ink-primary tabular-nums",
    limit: "text-body-s text-ink-secondary tabular-nums",
  },
};

/** The gap between the value row and the bar: a figure takes a little more air. */
const ROOT_GAP_CLASSES: Record<MeterEmphasis, string> = { default: "gap-xs", figure: "gap-sm" };

function percentOf(amount: number, scaleMax: number): number {
  return Math.min(100, Math.max(0, (amount / scaleMax) * 100));
}

function assertFiniteNonNegative(name: string, amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`Meter: ${name} must be a finite number >= 0 (got ${String(amount)}).`);
  }
}

/**
 * A value drawn against a scale, optionally against a limit: a covenant
 * ratio against its threshold, a share of a whole, used capacity against
 * a cap. One row of visible text (value, then limit) above a thin bar;
 * `emphasis="figure"` sets the value as the focal number of its panel.
 *
 * The bar is `aria-hidden` and there is no `<meter>` element: the visible
 * `valueText`/`limitText` carry the meaning for every reader, and a
 * screen reader hears the same words a sighted reader sees. Bar positions
 * use logical inline properties, so the bar fills from the inline start in
 * both writing directions. Not interactive, composes no other atom and
 * uses no hooks, so it is server-safe (re-exported from `atoms/server.ts`).
 *
 * Throws a `RangeError` for a non-finite or non-positive `scaleMax`, or a
 * non-finite or negative `value`/`limit`: a meter with no scale is a data
 * error, not something to draw.
 */
export function Meter({
  value,
  scaleMax,
  limit,
  direction = "max",
  tone,
  valueText,
  limitText,
  emphasis = "default",
  className,
  ...rest
}: MeterProps) {
  if (!Number.isFinite(scaleMax) || scaleMax <= 0) {
    throw new RangeError(`Meter: scaleMax must be a finite number > 0 (got ${String(scaleMax)}).`);
  }
  assertFiniteNonNegative("value", value);
  if (limit !== undefined) assertFiniteNonNegative("limit", limit);

  const valuePct = percentOf(value, scaleMax);
  const limitPct = limit === undefined ? undefined : percentOf(limit, scaleMax);

  // The disallowed side of the limit: after it for a cap, before it for a floor.
  const zoneStyle: CSSProperties | undefined =
    limitPct === undefined
      ? undefined
      : direction === "max"
        ? { insetInlineStart: `${limitPct}%`, inlineSize: `${100 - limitPct}%` }
        : { insetInlineStart: "0%", inlineSize: `${limitPct}%` };

  // Keeps the tick inside the track at both ends: at 0% it starts at the
  // edge, at 100% it ends at the edge.
  const tickStyle: CSSProperties | undefined =
    limitPct === undefined
      ? undefined
      : {
          insetInlineStart: `calc(${limitPct}% - ${limitPct / 100} * ${UI_BORDER_RULE})`,
          inlineSize: UI_BORDER_RULE,
        };

  return (
    <div
      {...rest}
      data-direction={direction}
      data-tone={tone}
      data-emphasis={emphasis}
      className={cx("flex flex-col font-body", ROOT_GAP_CLASSES[emphasis], className)}
    >
      <div className={VALUE_ROW_CLASSES[emphasis].row}>
        <span className={VALUE_ROW_CLASSES[emphasis].value}>{valueText}</span>
        {limitText ? <span className={VALUE_ROW_CLASSES[emphasis].limit}>{limitText}</span> : null}
      </div>
      <div aria-hidden="true" className="relative h-2 w-full overflow-hidden rounded-pill bg-surface-sunken">
        {zoneStyle ? <span data-part="zone" className="absolute inset-y-0 bg-line-base" style={zoneStyle} /> : null}
        <span
          data-part="fill"
          className={cx("absolute inset-y-0 rounded-pill", FILL_CLASSES[tone])}
          style={{ insetInlineStart: "0%", inlineSize: `${valuePct}%` }}
        />
        {tickStyle ? <span data-part="limit" className="absolute inset-y-0 bg-ink-primary" style={tickStyle} /> : null}
      </div>
    </div>
  );
}
