import type { HTMLAttributes, ReactNode } from "react";
import { Meter } from "../atoms/Meter.js";
import { StatusMark } from "../atoms/StatusMark.js";
import { cx } from "../atoms/internal/cx.js";

export interface UsageMeterThreshold {
  /** Fraction of the limit; finite, positive and strictly ascending. */
  at: number;
  tone: "info" | "warning" | "danger";
  /** Host-authored state text for the highest matched threshold. */
  message: string;
}

export interface UsageMeterProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  label: ReactNode;
  /** Finite and nonnegative, in the same unit as limit. */
  used: number;
  /** Finite and positive. */
  limit: number;
  usedText: string;
  limitText: string;
  periodText: string;
  thresholds?: readonly UsageMeterThreshold[];
  projectedText?: string;
  action?: ReactNode;
  size?: "default" | "compact";
}

/**
 * Draft usage against a limit for a period. The host supplies every visible
 * fact and state message; Meter draws the quantity and StatusMark repeats the
 * highest threshold in shape and text. Static and server-safe.
 */
export function UsageMeter({
  label, used, limit, usedText, limitText, periodText, thresholds = [],
  projectedText, action, size = "default", id, className, ...rest
}: UsageMeterProps) {
  if (!Number.isFinite(used) || used < 0) {
    throw new RangeError("UsageMeter: used must be finite and nonnegative.");
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new RangeError("UsageMeter: limit must be finite and positive.");
  }
  let previousAt = 0;
  let matched: UsageMeterThreshold | undefined;
  const fraction = used / limit;
  for (const threshold of thresholds) {
    if (!Number.isFinite(threshold.at) || threshold.at <= previousAt) {
      throw new RangeError("UsageMeter: thresholds must be finite, positive and strictly ascending.");
    }
    previousAt = threshold.at;
    if (fraction >= threshold.at) matched = threshold;
  }
  const labelId = id === undefined ? undefined : `${id}-label`;
  const gapClass = size === "compact" ? "gap-xs" : "gap-sm";

  return (
    <section
      {...rest}
      id={id}
      aria-labelledby={labelId}
      data-size={size}
      className={cx("flex min-w-0 flex-col break-words font-body", gapClass, className)}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-sm gap-y-xs">
        <p id={labelId} className="m-0 min-w-0 text-body font-semibold text-ink-primary">{label}</p>
        <p className="m-0 min-w-0 text-body-s text-ink-secondary">{periodText}</p>
      </div>
      <Meter
        className="min-w-0"
        value={used}
        scaleMax={Math.max(limit, used)}
        limit={limit}
        direction="max"
        valueText={usedText}
        limitText={limitText}
        tone={matched ? matched.tone : "accent"}
      />
      {matched ? <StatusMark className="min-w-0" tone={matched.tone}>{matched.message}</StatusMark> : null}
      {size !== "compact" && projectedText !== undefined ? <p className="m-0 min-w-0 text-body-s text-ink-secondary">{projectedText}</p> : null}
      {action != null ? <div className="min-w-0">{action}</div> : null}
    </section>
  );
}
