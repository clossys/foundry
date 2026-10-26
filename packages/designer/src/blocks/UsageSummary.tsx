import type { HTMLAttributes } from "react";
import { cx } from "../components/internal/cx.js";
import { EmptyState, type EmptyStateProps } from "./EmptyState.js";
import { UsageMeter, type UsageMeterProps } from "./UsageMeter.js";

/** One meter record; `id` is the meter's DOM id and React key, unique on the page. */
export type UsageSummaryMeter = UsageMeterProps & { id: string };

export interface UsageSummaryProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  "aria-label": string;
  /** Usage records, each drawn by UsageMeter in authored order. */
  meters: readonly UsageSummaryMeter[];
  /** Shown instead of the list when there are no meters; required for an empty list. */
  emptyState?: EmptyStateProps;
}

/** Usage for several limits at once: a responsive list of UsageMeter records. */
export function UsageSummary({ meters, emptyState, className, ...rest }: UsageSummaryProps) {
  if (meters.length === 0 && !emptyState) throw new RangeError("UsageSummary: meters is empty and no emptyState was supplied.");
  return (
    <section {...rest} className={cx("flex min-w-0 flex-col gap-md font-body", className)}>
      {meters.length === 0 && emptyState ? <EmptyState {...emptyState} /> : (
        <ul className="grid grid-cols-1 gap-lg tablet:grid-cols-2">
          {meters.map(meter => <li key={meter.id} className="min-w-0"><UsageMeter {...meter} /></li>)}
        </ul>
      )}
    </section>
  );
}
