import { Meter } from "../atoms/Meter.server.js";
import { StatusMark } from "../atoms/StatusMark.js";
import { cx } from "../atoms/internal/cx.js";
import type { UsageMeterProps, UsageMeterThreshold } from "./UsageMeter.js";

/**
 * Server-safe twin of the client `UsageMeter`: the same markup and classes,
 * built on the plain `Meter` atom instead of react-aria-components' Meter,
 * which cannot load under React's `react-server` condition. The server meter
 * has no role or ARIA value attributes; the client one adds them. A parity
 * test pins the two to the same structure.
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
      aria-labelledby={labelId ?? rest["aria-labelledby"]}
      data-size={size}
      className={cx("flex min-w-0 flex-col break-words font-body", gapClass, className)}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-sm gap-y-xs">
        <div id={labelId} className="m-0 min-w-0 text-body font-semibold text-ink-primary">{label}</div>
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
