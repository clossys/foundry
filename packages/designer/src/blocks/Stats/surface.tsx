import type { StatGroupProps, StatGroupLayout } from "../StatGroup.js";
import { SECTION_CONTENT_STYLE } from "../internal/section-content-gutter.js";
import { cx } from "../../components/internal/cx.js";
import { Stat } from "../Stat.js";
import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../../runtime/component-leaf.js";
import { StatsCount } from "./parts.js";
const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const SECTION_STAMP = dsAttrs("sections", "sections.stats", "foundry/sections.stats");

type StatGroupSurfaceInput = { readonly mode: "measurements"; readonly props: StatGroupProps }
  | { readonly mode: "state"; readonly label: string; readonly state: "loading" | "empty" | "error"; readonly stateLabel: string; readonly description?: string };

const LAYOUT_CLASSES: Record<StatGroupLayout, string> = {
  grid: "grid grid-cols-2 gap-lg desktop:grid-cols-4",
  row: "flex flex-wrap gap-xl",
};

export function StatGroupSurface(input: StatGroupSurfaceInput) {
  if (input.mode === "state") {
    const { label, state, stateLabel, description } = input;
    return <SemanticContent as="section" {...SECTION_STAMP} aria-label={label} aria-busy={state === "loading" || undefined}>
      <SemanticContent as="p" role={state === "error" ? "alert" : "status"} className="text-body text-ink-primary">{stateLabel}</SemanticContent>
      {description === undefined ? null : <SemanticContent as="p" className="text-body-s text-ink-secondary">{String(description)}</SemanticContent>}
    </SemanticContent>;
  }
  const { items, layout = "grid", motion = "static", className, style, ...rest } = input.props;
  if (motion !== "static" && motion !== "count") throw new TypeError("StatGroup: unknown motion");
  if (layout !== "grid" && layout !== "row") throw new TypeError("StatGroup: unknown layout");
  return (
    <SemanticContent as="section" {...SECTION_STAMP} {...rest} data-layout={layout} data-motion={motion} className={cx("min-w-0", className)} style={{ ...SECTION_CONTENT_STYLE, ...style }}>
    <SemanticContent as="ul" role="list" aria-label={rest["aria-label"]} className={cx("min-w-0 list-none", LAYOUT_CLASSES[layout])}>
      {items.map(({ id, countTo, formatCount, ...stat }) => (
        <SemanticContent as="li" key={id} className="min-w-0">
          <Stat {...stat} value={motion === "count" ? <StatsCount finalValue={stat.value} to={countTo ?? (typeof stat.value === "number" ? stat.value : undefined)} format={formatCount} /> : stat.value} />
        </SemanticContent>
      ))}
    </SemanticContent>
    </SemanticContent>
  );
}
