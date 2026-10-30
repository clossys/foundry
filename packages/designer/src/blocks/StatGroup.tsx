import type { HTMLAttributes, ReactNode } from "react";
import { SECTION_CONTENT_STYLE } from "./internal/section-content-gutter.js";
import { cx } from "../components/internal/cx.js";
import { Stat, type StatProps } from "./Stat.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { StatsCount } from "./Stats/parts.js";
import { SemanticContent } from "../components/SemanticContent.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.stats", "foundry/sections.stats");

export type StatGroupLayout = "grid" | "row";
export interface StatGroupItem extends Omit<StatProps, "className" | "style"> {
  /** Stable key for the item. */
  id: string;
  /** Numeric target for a formatted value; omitted numeric values count directly. */
  countTo?: number;
  /** Optional transient visual formatting; the authored value remains accessible. */
  formatCount?: (value: number) => ReactNode;
}
export interface StatGroupProps extends Omit<HTMLAttributes<HTMLUListElement>, "children"> {
  /** The measurements, in reading order. Each renders one `Stat`. */
  items: readonly StatGroupItem[];
  /**
   * `grid` wraps into equal columns (two, then four); `row` keeps
   * one line that wraps only when it runs out of room. @default "grid"
   */
  layout?: StatGroupLayout;
  /** Opt-in, once-only count on viewport entry. Server HTML and reduced motion use final values. */
  motion?: "static" | "count";
}

const LAYOUT_CLASSES: Record<StatGroupLayout, string> = {
  grid: "grid grid-cols-2 gap-lg desktop:grid-cols-4",
  row: "flex flex-wrap gap-xl",
};

/**
 * A set of `Stat` measurements: the metrics strip above a dashboard or the
 * summary row of a report. Renders a list so the count is announced; every
 * item is a whole `Stat` (label, value, optional trend and description), so a
 * group never invents a second metric anatomy. Data is host-injected.
 */
export function StatGroup({ items, layout = "grid", motion = "static", className, style, ...rest }: StatGroupProps) {
  if (motion !== "static" && motion !== "count") throw new TypeError("StatGroup: unknown motion.");
  return (
    <SemanticContent as="ul" {...SECTION_STAMP} {...rest} role="list" data-layout={layout} data-motion={motion} className={cx("min-w-0 list-none", LAYOUT_CLASSES[layout], className)} style={{ ...SECTION_CONTENT_STYLE, ...style }}>
      {items.map(({ id, countTo, formatCount, ...stat }) => (
        <SemanticContent as="li" key={id} className="min-w-0 border-b border-line-base py-sm">
          <Stat {...stat} value={motion === "count" ? <StatsCount finalValue={stat.value} to={countTo ?? (typeof stat.value === "number" ? stat.value : undefined)} format={formatCount} /> : stat.value} />
        </SemanticContent>
      ))}
    </SemanticContent>
  );
}
