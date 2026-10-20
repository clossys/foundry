"use client";
import { useState } from "react";
import { AreaView } from "./internal/signature-views.js";
import { useInspection } from "./internal/use-inspection.js";
import type { AreaChartProps } from "./internal/signature-types.js";
export type {
  AreaChartProps,
  AreaChartSeries,
} from "./internal/signature-types.js";

/** Filled category or time series, optionally stacked or normalized to 100 percent. */
export function AreaChart(props: AreaChartProps) {
  const interaction = useInspection(props);
  const [localHidden, setLocalHidden] = useState<readonly string[]>([]);
  const hidden = props.hiddenSeries ?? localHidden;
  function toggle(name: string) {
    const next = hidden.includes(name)
      ? hidden.filter((item) => item !== name)
      : [...hidden, name];
    if (props.hiddenSeries === undefined) setLocalHidden(next);
    props.onHiddenSeriesChange?.(next);
  }
  return (
    <AreaView
      props={props}
      interaction={interaction}
      hidden={hidden}
      toggle={toggle}
    />
  );
}
