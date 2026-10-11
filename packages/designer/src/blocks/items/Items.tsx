import { useId } from "react";
import { cx } from "../../atoms/internal/cx.js";
import { SECTION_GROUND_CLASSES } from "../section-ground.js";
import { assertItems, loneTabletThirds } from "./policies.js";
import { ItemRenderer } from "./render.js";
import type { ItemSpan, ItemsProps } from "./types.js";

const COLUMN_CLASSES: Record<2 | 3, string> = {
  2: "grid grid-cols-1 gap-x-2xl gap-y-3xl tablet:grid-cols-2",
  3: "grid grid-cols-1 gap-x-2xl gap-y-3xl tablet:grid-cols-2 tablet-lg:grid-cols-3",
};
const ROW_CLASSES: Record<1 | 2, string> = {
  1: "grid grid-cols-1 gap-y-lg", 2: "grid grid-cols-1 gap-y-lg tablet:grid-cols-2 tablet:gap-x-3xl"
};
const TWO_THIRDS = "two-thirds" as const;
const BENTO_SPAN_CLASSES: Record<ItemSpan, string> = {
  third: "tablet:col-span-6 tablet-lg:col-span-4", half: "tablet:col-span-6", [TWO_THIRDS]: "tablet:col-span-12 tablet-lg:col-span-8", full: "tablet:col-span-12"
};
function renderItems(props: ItemsProps, columns: number | undefined) {
  const { arrangement, treatment = "plain", size = "standard", ground = "base", emphasis = "item", headingLevel = 3 } = props;
  const spans = arrangement === "bento" ? props.items.map(item => item.span === undefined ? "half" : item.span) : [];
  const tabletLone = loneTabletThirds(spans);
  return props.items.map((item, index) => {
    const span = spans[index];
    const lone = arrangement === "columns" && columns === 3 && props.items.length % 2 === 1 && index === props.items.length - 1;
    const spanClassName = span !== undefined ? (tabletLone[index] ? "tablet:col-span-12 tablet-lg:col-span-4" : BENTO_SPAN_CLASSES[span]) : lone ? "tablet:col-span-2 tablet-lg:col-span-1" : undefined;
    return <ItemRenderer key={item.id} item={item} treatment={treatment} size={arrangement === "bento" ? "display" : size} ground={ground} statement={emphasis === "statement"} headingLevel={headingLevel} span={span} className={spanClassName} />;
  });
}
/** Group labels are caption paragraphs naming sections; item headings keep the explicit h3/h4 outline. */
function GroupedItems({ props, columns }: { props: ItemsProps; columns: number }) {
  const prefix = useId();
  const groupGround = props.ground === undefined ? "base" : props.ground;
  const groupColors = SECTION_GROUND_CLASSES[groupGround];
  const items = new Map(props.items.map((item) => [item.id, item]));
  return <div data-items="" data-arrangement="rows" data-columns={columns} className={cx(ROW_CLASSES[columns as 1 | 2], props.className)}>
    {props.groups!.map((group, index) => {
      const id = `${prefix}-items-group-${index}`;
      const groupProps = { ...props, groups: undefined, items: group.items.map((itemId) => items.get(itemId)!) };
      return <section key={group.id} aria-labelledby={id} className="flex min-w-0 flex-col gap-md">
        <p id={id} className={cx("m-0 text-caption font-mono uppercase tracking-label", groupColors.secondary)}>{group.label}</p>
        <div className="flex flex-col gap-lg">{renderItems(groupProps, 1)}</div>
      </section>;
    })}
  </div>;
}
/** A bounded collection of items, with one canonical validation and rendering path. */
export function Items(props: ItemsProps) {
  const columns = assertItems(props);
  if (props.groups !== undefined) return <GroupedItems props={props} columns={columns!} />;
  const { arrangement, treatment = "plain" } = props;
  const layout = arrangement === "columns" ? COLUMN_CLASSES[columns as 2 | 3] : arrangement === "rows" ? ROW_CLASSES[columns as 1 | 2] : arrangement === "bento" ? "grid grid-cols-1 gap-lg tablet:grid-cols-12" : "flex flex-col gap-2xl";
  const plateGap = arrangement === "columns" && treatment === "plate" ? "gap-y-2xl" : undefined;
  return <div data-items="" data-arrangement={arrangement} data-columns={columns} data-treatment={treatment} className={cx(layout, plateGap, props.className)}>{renderItems(props, columns)}</div>;
}
