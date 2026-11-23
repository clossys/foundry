import type { CSSProperties } from "react";
import { cx } from "./internal/cx.js";
import type { MeterEmphasis, MeterProps, MeterTone } from "./Meter.js";

export const FILL_CLASSES: Record<MeterTone, string> = {
  success: "bg-status-success",
  warning: "bg-status-warning-tint text-status-warning",
  danger: "bg-destructive",
  info: "bg-status-info-tint text-status-info",
  neutral: "bg-muted-foreground",
  accent: "bg-primary",
};

// Texture for the two tones a solid fill cannot tell apart in greyscale,
// drawn in `currentColor` (the tone colour set by the class above) at the
// stock two-unit rule weight (`--spacing(0.5)`), so a brand that re-scales
// its spacing re-weights these too.
export const FILL_TEXTURES: Partial<Record<MeterTone, string>> = {
  warning: "bg-[repeating-linear-gradient(-45deg,currentColor_0_--spacing(0.5),transparent_0_--spacing(1))]",
  info: "inset-ring-2 inset-ring-current",
};

/** The value row per emphasis: the row, the value, and the limit. */
export const VALUE_ROW_CLASSES: Record<MeterEmphasis, { row: string; value: string; limit: string }> = {
  default: {
    row: "flex flex-wrap items-baseline justify-between gap-x-2 text-sm",
    value: "text-foreground tabular-nums",
    limit: "text-muted-foreground tabular-nums",
  },
  figure: {
    row: "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1",
    value: "text-2xl @md:text-3xl font-normal leading-tight text-foreground tabular-nums",
    limit: "text-sm text-muted-foreground tabular-nums",
  },
};

/** The gap between the value row and the bar: a figure takes a little more air. */
export const ROOT_GAP_CLASSES: Record<MeterEmphasis, string> = { default: "gap-1", figure: "gap-2" };

function percentOf(amount: number, scaleMax: number): number {
  return Math.min(100, Math.max(0, (amount / scaleMax) * 100));
}

function assertFiniteNonNegative(name: string, amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`Meter: ${name} must be a finite number >= 0 (got ${String(amount)}).`);
  }
}

/** Class list of the bar's track, shared by the server and client `Meter`. */
export const METER_TRACK_CLASSES = "relative h-2 w-full overflow-hidden rounded-full bg-muted";

/** Class list of the root, shared by the server and client `Meter`. */
export function meterRootClassName(emphasis: MeterEmphasis, className: string | undefined): string {
  return cx("flex flex-col font-sans", ROOT_GAP_CLASSES[emphasis], className);
}

export interface ResolvedMeter {
  /** The scale direction after the `"max"` default, for the root's `data-direction`. */
  direction: NonNullable<MeterProps["direction"]>;
  valuePct: number;
  zoneStyle: CSSProperties | undefined;
  tickStyle: CSSProperties | undefined;
  previousStyle: CSSProperties | undefined;
}

/**
 * Validates a `Meter`'s numbers and resolves the bar geometry. Shared by the
 * server `Meter` (this file) and the client `Meter` (`Meter.tsx`), so both
 * throw the same errors for the same bad input and place the bar identically.
 */
export function resolveMeter({
  value,
  scaleMax,
  limit,
  previous,
  previousText,
  direction: requestedDirection,
}: Pick<MeterProps, "value" | "scaleMax" | "limit" | "previous" | "previousText" | "direction">): ResolvedMeter {
  const direction = requestedDirection ?? "max";
  if (!Number.isFinite(scaleMax) || scaleMax <= 0) {
    throw new RangeError(`Meter: scaleMax must be a finite number > 0 (got ${String(scaleMax)}).`);
  }
  assertFiniteNonNegative("value", value);
  if (limit !== undefined) assertFiniteNonNegative("limit", limit);
  if ((previous === undefined) !== (previousText === undefined)) throw new TypeError("Meter: previous and previousText must be supplied together.");
  if (previous !== undefined) {
    assertFiniteNonNegative("previous", previous);
    if (previous > scaleMax) throw new RangeError("Meter: previous must be within the scale.");
    if (typeof previousText !== "string" || !previousText.trim()) throw new TypeError("Meter: previousText must contain authored text.");
  }

  const valuePct = percentOf(value, scaleMax);
  const limitPct = limit === undefined ? undefined : percentOf(limit, scaleMax);
  const previousPct = previous === undefined ? undefined : percentOf(previous, scaleMax);
  // Placed inside a lane one marker narrower than the track (see `MeterBar`),
  // so the percentage alone keeps the marker inside the track at both ends.
  const previousStyle: CSSProperties | undefined = previousPct === undefined ? undefined : {
    insetInlineStart: `${previousPct}%`,
  };

  // The disallowed side of the limit: after it for a cap, before it for a floor.
  const zoneStyle: CSSProperties | undefined =
    limitPct === undefined
      ? undefined
      : direction === "max"
        ? { insetInlineStart: `${limitPct}%`, inlineSize: `${100 - limitPct}%` }
        : { insetInlineStart: "0%", inlineSize: `${limitPct}%` };

  // Keeps the tick inside the track at both ends: the tick sits in a lane one
  // tick narrower than the track (see `MeterBar`), so at 0% it starts at the
  // edge and at 100% it ends at the edge.
  const tickStyle: CSSProperties | undefined =
    limitPct === undefined
      ? undefined
      : { insetInlineStart: `${limitPct}%` };
  return { direction, valuePct, zoneStyle, tickStyle, previousStyle };
}

export interface MeterBarProps extends ResolvedMeter {
  tone: MeterTone;
}

/**
 * The decorative bar (track, zone, fill, limit tick, previous marker). Pure
 * markup with no hooks, so the client `Meter` renders the very same element.
 */
export function MeterBar({ tone, valuePct, zoneStyle, tickStyle, previousStyle }: MeterBarProps) {
  return (
    <div aria-hidden="true" className={METER_TRACK_CLASSES}>
      {zoneStyle ? <span data-part="zone" className="absolute inset-y-0 bg-border" style={zoneStyle} /> : null}
      <span
        data-part="fill"
        className={cx("absolute inset-y-0 rounded-full", FILL_CLASSES[tone], FILL_TEXTURES[tone])}
        style={{ insetInlineStart: "0%", inlineSize: `${valuePct}%` }}
      />
      {tickStyle ? <span className="absolute inset-y-0 start-0 end-0.5"><span data-part="limit" className="absolute inset-y-0 w-0.5 bg-foreground" style={tickStyle} /></span> : null}
      {previousStyle ? <span className="absolute inset-y-0 start-0 end-px"><span data-part="previous" className="absolute inset-y-0 box-border w-px border-0 border-s border-dashed border-muted-foreground bg-background" style={previousStyle} /></span> : null}
    </div>
  );
}

/**
 * The server-safe `Meter`, re-exported as `Meter` from
 * `@clossys/designer/components/server` and used by the server-safe `Specimen`
 * blocks. Same props, geometry, classes and visible text as the client
 * `Meter`, without react-aria-components (which cannot load under React's
 * `react-server` condition): the bar is `aria-hidden` and there is no
 * `role="meter"` element, so the visible `valueText`/`limitText` carry the
 * meaning on their own, and the optional `label` (the client meter's
 * accessible name) is accepted and not rendered. The client `Meter` (`Meter.tsx`) is built on
 * react-aria-components' `Meter` and adds the meter role; a parity
 * test pins the two to the same markup apart from that role wiring.
 *
 * Throws a `RangeError` for a non-finite or non-positive `scaleMax`, or a
 * non-finite or negative `value`/`limit`: a meter with no scale is a data
 * error, not something to draw.
 */
export function Meter({
  value,
  scaleMax,
  limit,
  previous,
  previousText,
  direction = "max",
  tone,
  valueText,
  label: _label,
  limitText,
  emphasis = "default",
  className,
  ...rest
}: MeterProps) {
  const resolved = resolveMeter({ value, scaleMax, limit, previous, previousText, direction });
  return (
    <div
      {...rest}
      data-direction={direction}
      data-tone={tone}
      data-emphasis={emphasis}
      className={meterRootClassName(emphasis, className)}
    >
      <div className={VALUE_ROW_CLASSES[emphasis].row}>
        <span className={VALUE_ROW_CLASSES[emphasis].value}>{valueText}</span>
        {limitText ? <span className={VALUE_ROW_CLASSES[emphasis].limit}>{limitText}</span> : null}
      </div>
      {previousText !== undefined ? <p className="m-0 text-sm text-muted-foreground tabular-nums">{previousText}</p> : null}
      <MeterBar tone={tone} {...resolved} />
    </div>
  );
}
