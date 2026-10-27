import type { HTMLAttributes } from "react";
import { cx } from "../components/internal/cx.js";
import { Stat, type StatProps } from "./Stat.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.stats", "foundry/sections.stats");

export type StatGroupLayout = "grid" | "row";
export interface StatGroupItem extends Omit<StatProps, "className" | "style"> {
  /** Stable key for the item. */
  id: string;
}
export interface StatGroupProps extends Omit<HTMLAttributes<HTMLUListElement>, "children"> {
  /** The measurements, in reading order. Each renders one `Stat`. */
  items: readonly StatGroupItem[];
  /**
   * `grid` wraps into equal columns (one, then two, then four); `row` keeps
   * one line that wraps only when it runs out of room. @default "grid"
   */
  layout?: StatGroupLayout;
}

const LAYOUT_CLASSES: Record<StatGroupLayout, string> = {
  grid: "grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-4",
  row: "flex flex-wrap gap-xl",
};

/**
 * A set of `Stat` measurements: the metrics strip above a dashboard or the
 * summary row of a report. Renders a list so the count is announced; every
 * item is a whole `Stat` (label, value, optional trend and description), so a
 * group never invents a second metric anatomy. Data is host-injected.
 */
export function StatGroup({ items, layout = "grid", className, ...rest }: StatGroupProps) {
  return (
    <ul {...SECTION_STAMP} {...rest} role="list" data-layout={layout} className={cx(LAYOUT_CLASSES[layout], className)}>
      {items.map(({ id, ...stat }) => (
        <li key={id} className="min-w-0">
          <Stat {...stat} />
        </li>
      ))}
    </ul>
  );
}
