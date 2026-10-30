import type { HTMLAttributes, ReactNode } from "react";
import type { StatProps } from "./Stat.js";
import { StatGroupSurface } from "./Stats/surface.js";

export type StatGroupLayout = "grid" | "row";
export interface StatGroupItem extends Omit<StatProps, "className" | "style"> {
  /** Stable key for the item. */
  id: string;
  /** Numeric target for a formatted value. Numeric values count directly. */
  countTo?: number;
  /** Transient visual formatting; the authored value remains accessible. */
  formatCount?: (value: number) => ReactNode;
}
export interface StatGroupProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The measurements, in reading order. Each renders one `Stat`. */
  items: readonly StatGroupItem[];
  /**
   * `grid` wraps into equal columns (two, then four); `row` keeps
   * one line that wraps only when it runs out of room. @default "grid"
   */
  layout?: StatGroupLayout;
  /** Opt-in once-only viewport count; SSR and reduced motion retain final values. */
  motion?: "static" | "count";
}

/**
 * A set of `Stat` measurements: the metrics strip above a dashboard or the
 * summary row of a report. Renders a list so the count is announced; every
 * item is a whole `Stat` (label, value, optional trend and description), so a
 * group never invents a second metric anatomy. Data is host-injected.
 */
export function StatGroup(props: StatGroupProps) {
  return StatGroupSurface({ mode: "measurements", props });
}
