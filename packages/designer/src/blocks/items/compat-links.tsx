import { ItemHeading, ItemIcon, ItemDescription } from "./anatomy.js";
import type { ReactNode } from "react";
import { cx } from "../../atoms/internal/cx.js";
import { UI_BORDER_HAIRLINE, UI_LAYOUT_TAP_TARGET } from "../../atoms/internal/ui-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";
import { assertNoNestedInteractive, cardLinkContainerClassName, type CardLinkFrame } from "../stretched-link.js";

import type { LinkGridItem, LinkGridProps } from "../LinkGrid.js";
const PLATE_CLASSES: Record<SectionGround, string> = {
  base: "bg-surface-sunken hover:bg-surface-raised active:bg-surface-raised",
  sunken: "bg-surface-base hover:bg-surface-raised active:bg-surface-raised",
  inverse: "bg-surface-inverse-raised",
};
const RULE_CLASSES: Record<SectionGround, string> = {
  base: "border-line-strong",
  sunken: "border-line-strong",
  inverse: "border-line-on-inverse",
};
const ACTIVE_RULE_CLASSES: Record<SectionGround, string> = {
  base: "active:before:bg-surface-sunken",
  sunken: "active:before:bg-surface-base",
  inverse: "active:before:bg-surface-inverse-raised",
};

/** Shared linked-tile content, including NavGrid's legacy control frame. Internal to the package. */
export function CompatLinkedTileContent({ item, variant: frame, ground, headingLevel }: {
  item: LinkGridItem;
  variant: CardLinkFrame;
  ground: SectionGround;
  headingLevel?: 3 | 4;
}) {
  if (frame === "control") assertNoNestedInteractive("NavGrid", item.id, [item.icon, item.title, item.description]);
  else assertNoNestedInteractive("LinkGrid", item.id, [item.icon, item.title, item.description]);
  const colors = SECTION_GROUND_CLASSES[ground];
  const control = frame === "control";
  const TitleTag = control ? "span" : headingLevel === 3 ? "h3" : headingLevel === 4 ? "h4" : "p";
  const DescriptionTag = control ? "span" : "p";
  return <>
    {item.icon ? <ItemIcon className={control ? "text-ink-muted" : cx("inline-flex link-grid-icon", colors.secondary)}>{item.icon}</ItemIcon> : null}
    <ItemHeading as={TitleTag} heading={item.title} href={item.href} variant={frame} ground={ground} className={cx("text-body font-body font-medium", control ? undefined : "m-0 leading-heading", colors.primary)} anchorClassName={control ? undefined : "active:decoration-current link-grid-active"} />
    {item.description ? <ItemDescription as={DescriptionTag} data-link-grid-description="" className={cx("text-body-s", control ? undefined : "m-0", colors.secondary)}>{item.description}</ItemDescription> : null}
  </>;
}

/**
 * A list of two to six destinations. Each title is one stretched link with
 * a decorative chevron and a ring around the whole tile; descriptions and
 * icons remain outside its accessible name. Nested interactive content and
 * mixed icon presence throw a TypeError. Server-safe: no hooks or events.
 *
 * One column below tablet, then a six-unit grid: two/four items take halves,
 * three/six take thirds, and five take three thirds followed by two halves.
 */
export function CompatLinkGrid({ items, surface, ground, headingLevel, className }: LinkGridProps & { surface: "plate" | "rule"; ground: SectionGround }) {
  if (items.length < 2 || items.length > 6) throw new RangeError(`LinkGrid: expected 2 to 6 items, got ${items.length}.`);
  const iconCount = items.filter((item) => Boolean(item.icon)).length;
  if (iconCount !== 0 && iconCount !== items.length) throw new TypeError("LinkGrid: give every item an icon or none.");
  const isRule = surface === "rule";
  const linkedContainer = cardLinkContainerClassName(surface, ground, "base");
  const frameClasses = isRule ? cx("border-t pt-lg", RULE_CLASSES[ground]) : cx("border border-transparent rounded-panel p-lg tablet-lg:p-xl", PLATE_CLASSES[ground]);
  return (
    <ul
      data-link-grid=""
      data-count={items.length}
      data-surface={surface}
      className={cx("m-0 list-none p-0 grid grid-cols-1 gap-lg tablet:grid-cols-6", isRule ? "tablet:gap-2xl" : undefined, className)}
    >
      {items.map((item, index) => (
        <li
          key={item.id}
          style={{ minBlockSize: UI_LAYOUT_TAP_TARGET, borderWidth: isRule ? undefined : UI_BORDER_HAIRLINE, borderBlockStartWidth: isRule ? UI_BORDER_HAIRLINE : undefined }}
          className={cx(
            "flex min-w-0 flex-col gap-sm",
            linkedContainer,
            items.length === 2 || items.length === 4 || (items.length === 5 && index >= 3) ? "tablet:col-span-3" : "tablet:col-span-2",
            frameClasses,
            isRule ? ACTIVE_RULE_CLASSES[ground] : undefined,
          )}
        >
          <CompatLinkedTileContent item={item} variant={surface} ground={ground} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}
