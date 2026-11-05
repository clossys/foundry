import type { HTMLAttributes } from "react";
import { Label, Meter as AriaMeter } from "react-aria-components";
import { MeterBar, VALUE_ROW_CLASSES, meterRootClassName, resolveMeter } from "./Meter.server.js";

/**
 * Fill colour and texture. The four status tones repeat a state; `neutral`
 * is a plain quantity; `accent` is a plain quantity in the brand accent (a
 * share of a whole, an allocation), never a state. `warning` fills with
 * diagonal hatching and `info` with a tinted bar inside a ring, so those two
 * read apart from a solid fill when the brand is greyscale; `danger` is the
 * darkest solid and `success` a lighter solid.
 */
export type MeterTone = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

/**
 * `default`: value and limit as one row of body text above the bar.
 * `figure`: the value set large and light (`text-h1`, `text-h0` once its
 * container reaches 28rem via `@md:text-h0`, normal weight, tabular) as the panel's focal
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
  /** Prior measurement within the scale; requires authored previousText. */
  previous?: number;
  /** Visible alternative to the decorative prior marker. Required with previous. */
  previousText?: string;
  /** @default "max" */
  direction?: MeterDirection;
  /** Colour of the filled part. Repeats what `valueText` (or a nearby `StatusMark`) says. */
  tone: MeterTone;
  /**
   * Required. The value as visible text ("3.4x", "42%"). The bar is
   * decoration (`aria-hidden`); this text carries the meaning, and is also
   * the meter's accessible name and `aria-valuetext`.
   */
  valueText: string;
  /**
   * Optional accessible name for the meter: what it measures ("API
   * requests"). When given, it names the meter in place of the value text;
   * `valueText` stays the visible value and the `aria-valuetext`. Omit it and
   * the visible `valueText` names the meter. An empty or whitespace-only
   * `label` counts as omitted, so it can never leave the meter with an empty
   * name. The server `Meter` has no role and ignores it.
   */
  label?: string;
  /** Optional visible limit text ("limit 3.0x"), shown after the value. */
  limitText?: string;
  /** @default "default" */
  emphasis?: MeterEmphasis;
}

/**
 * A value drawn against a scale, optionally against a limit: a covenant
 * ratio against its threshold, a share of a whole, used capacity against
 * a cap. One row of visible text (value, then limit) above a thin bar;
 * `emphasis="figure"` sets the value as the focal number of its panel.
 *
 * Built on react-aria-components' own `Meter`, which supplies the root's
 * `role="meter progressbar"` (the meter role with a progressbar fallback for
 * browsers that lack it) and the `aria-valuenow`/`aria-valuemin`/
 * `aria-valuemax` wiring. The visible `valueText` is rendered through its
 * `Label`, so it names the meter, and it is also passed as the value label,
 * so a screen reader announces the same words a sighted reader sees rather
 * than a derived percentage. With a `label`, that text becomes the meter's
 * `aria-label` instead and the value text is a plain `<span>`, so the name
 * says what is measured and the value text stays the value. The bar stays
 * `aria-hidden`: it is decoration.
 * Bar positions use logical inline properties, so the bar fills from the
 * inline start in both writing directions.
 *
 * This client `Meter` imports react-aria-components, which cannot load under
 * React's `react-server` condition. The server-safe `Meter` exported from
 * `@clossys/designer/components/server` is `Meter.server.tsx`: same props and
 * markup, but with no meter role. Both share their class tables, validation
 * and bar from that file.
 *
 * Attribute forwarding follows react-aria-components: `id`, `data-*`, the
 * `aria-label`/`aria-labelledby`/`aria-describedby`/`aria-details` set, `dir`,
 * `lang`, `hidden` and the common pointer/mouse/scroll/animation handlers
 * reach the root; other native attributes (for example `title` or
 * `tabIndex`) do not.
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
  direction,
  tone,
  valueText,
  label,
  limitText,
  emphasis = "default",
  className,
  ...rest
}: MeterProps) {
  const resolved = resolveMeter({ value, scaleMax, limit, previous, previousText, direction });
  // An empty or blank label is treated as absent: an empty aria-label would give the meter no name.
  const name = label !== undefined && label.trim() !== "" ? label : undefined;
  return (
    <AriaMeter
      {...rest}
      {...(name === undefined ? {} : { "aria-label": name })}
      value={value}
      minValue={0}
      maxValue={scaleMax}
      valueLabel={valueText}
      data-direction={resolved.direction}
      data-tone={tone}
      data-emphasis={emphasis}
      className={meterRootClassName(emphasis, className)}
    >
      <div className={VALUE_ROW_CLASSES[emphasis].row}>
        {name === undefined
          ? <Label className={VALUE_ROW_CLASSES[emphasis].value}>{valueText}</Label>
          : <span className={VALUE_ROW_CLASSES[emphasis].value}>{valueText}</span>}
        {limitText ? <span className={VALUE_ROW_CLASSES[emphasis].limit}>{limitText}</span> : null}
      </div>
      {previousText !== undefined ? <p className="m-0 text-body-s text-ink-secondary tabular-nums">{previousText}</p> : null}
      <MeterBar tone={tone} {...resolved} />
    </AriaMeter>
  );
}
