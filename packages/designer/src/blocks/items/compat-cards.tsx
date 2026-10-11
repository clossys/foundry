import { loneTabletThirds } from "./policies.js";
import { ItemHeading, ItemIcon, ItemDescription, ItemPlate } from "./anatomy.js";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { UI_BORDER_HAIRLINE } from "../../atoms/internal/ui-vars.js";
import { cx } from "../../atoms/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";
import { assertNoNestedInteractive, cardLinkContainerClassName } from "../stretched-link.js";

import type { CardGridProps, CardGridSpan, CardGridHeadingLevel } from "../CardGrid.js";
const HEADING_TAGS = { 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const satisfies Record<CardGridHeadingLevel, string>;

/** The one span name that is not a bare identifier: a computed key keeps the name out of the class scan. */
const TWO_THIRDS = "two-thirds" as const;

const RULE_BORDER_CLASSES: Record<SectionGround, string> = {
  base: "border-line-strong",
  sunken: "border-line-strong",
  inverse: "border-line-on-inverse",
};
const RULE_SPAN_CLASSES: Record<CardGridSpan, string> = {
  third: "tablet:col-span-6 tablet-lg:col-span-4",
  half: "tablet:col-span-6",
  [TWO_THIRDS]: "tablet:col-span-6 tablet-lg:col-span-8",
  full: "tablet:col-span-12",
};


/**
 * Span classes. One column below `tablet`; at `tablet` a two-thirds card
 * takes the full row and a third takes half; the 12-unit spans apply from
 * `tablet-lg`.
 */

const SPAN_CLASSES: Record<CardGridSpan, string> = {
  third: "tablet:col-span-6 tablet-lg:col-span-4",
  half: "tablet:col-span-6",
  [TWO_THIRDS]: "tablet:col-span-12 tablet-lg:col-span-8",
  full: "tablet:col-span-12",
};

/**
 * A third that would sit alone in its `tablet` row (thirds take half a row
 * there, so three thirds or a third beside a two-thirds card leave one
 * stranded) takes the full `tablet` row instead, back to its third from
 * `tablet-lg`.
 */
const LONE_THIRD_CLASSES = "tablet:col-span-12 tablet-lg:col-span-4";

/** Card icons carry the brand accent (`accent-on-inverse` on an inverse band): the icon marks the card, the words carry it. */
const ICON_ACCENT_CLASSES: Record<SectionGround, string> = {
  base: "text-accent",
  sunken: "text-accent",
  inverse: "text-accent-on-inverse",
};

/**
 * Throws unless the cards fill whole 12-unit rows in order: two-thirds and a
 * third (either order), three thirds, two halves, or one full card per row,
 * 2 to 6 cards in all.
 */

/**
 * A mixed grid of content cards where one item may deserve more room than
 * the rest, and each card may carry a small visual. Each card is a `Card`
 * plate (the other ground, `rounded-panel`, no stroke, no shadow)
 * rendered inside an `<article>` with a real heading, one level below the
 * section heading.
 *
 * Spans are a closed set and must fill whole 12-unit rows (validated: an
 * invalid sequence throws a `RangeError`, a data error rather than a layout
 * to draw). The grid is one column below `tablet`; at `tablet` a two-thirds
 * card takes the full row and thirds take halves, except a third that would
 * be left alone in its row, which takes the full row; the 12-unit spans
 * apply from `tablet-lg`, with `gap-lg` between cards.
 *
 * Card copy is set for reading: a `text-body` description, a `text-body-s`
 * medium eyebrow, and an icon in the brand accent.
 *
 * A card's text sits at the top and its `visual` is pinned to the bottom
 * (`mt-auto`), so headings line up across a row whatever the visuals hold.
 *
 * A card with `href` is one link: the heading carries the anchor and a
 * chevron at its end, visible at rest, and the anchor's hit area covers the
 * plate, so a click anywhere on the card (its padding, its copy, its visual)
 * follows the link and Tab stops once, with the focus ring around the
 * plate. Hover underlines the heading. Link every card or none, each to its
 * own destination; a linked card holding another link, button or field
 * throws a `TypeError`.
 *
 * Server-safe: no hooks.
 */
export function CompatCardGrid({ items, headingLevel, ground, treatment, className, style, ...rest }: CardGridProps & { headingLevel: CardGridHeadingLevel; ground: SectionGround; treatment: "plate" | "rule" }) {
  const HeadingTag = HEADING_TAGS[headingLevel];
  const colors = SECTION_GROUND_CLASSES[ground];
  const isRule = treatment === "rule";
  /** A linked card: the plate is the hit area and carries the ring. */
  const linkedContainer = cardLinkContainerClassName(treatment, ground);
  const lone = loneTabletThirds(items.map((item) => item.span));

  return (
    <div
      {...rest}
      data-card-grid=""
      data-treatment={treatment}
      className={cx("grid grid-cols-1 gap-lg tablet:grid-cols-12", isRule ? "tablet:gap-x-2xl tablet:gap-y-3xl" : undefined, className)}
      style={style}
    >
      {items.map((item, index) => {
        if (item.href !== undefined) assertNoNestedInteractive("CardGrid", item.id, [item.icon, item.eyebrow, item.heading, item.description, item.visual]);
        const isWideRule = isRule && item.span === TWO_THIRDS && Boolean(item.visual);
        const icon = item.icon ? (
                <ItemIcon className={cx("inline-flex", ICON_ACCENT_CLASSES[ground])}>{item.icon}</ItemIcon>
              ) : null;
        const copy = <div className="flex flex-col gap-xs">
                {item.eyebrow ? (
                  // Secondary, not muted: the plate is a raised or sunken fill, where muted ink is only AA-large.
                  <p className={cx(cx("text-body-s font-medium uppercase tracking-label", isRule ? "m-0" : undefined), colors.secondary)}>{item.eyebrow}</p>
                ) : null}
                {/* A linked title drops the display face's horizontal-scale transform: a transformed heading would become the
                    containing block of the link's stretched hit area and shrink it to the title. */}
                <ItemHeading as={HeadingTag} heading={item.heading} href={item.href} variant={treatment} ground={ground} iconSize="md" className={cx(cx("text-h2 font-display leading-heading text-balance", isRule ? "m-0" : undefined), colors.primary, item.href === undefined ? undefined : "transform-none")} />
                {item.description ? (
                  <ItemDescription className={cx(cx("text-body text-pretty", isRule ? "m-0" : undefined), colors.secondary)}>{item.description}</ItemDescription>
                ) : null}
              </div>;
        const visual = item.visual ? (
                <div data-card-grid-visual="" className={cx("mt-auto w-full min-w-0 pt-md", isWideRule ? "tablet-lg:mt-0 tablet-lg:pt-0" : undefined)}>
                  {item.visual}
                </div>
              ) : null;
        const body = <>{icon}{copy}{visual}</>;
        if (isRule) return <article key={item.id} data-card-grid-item="" data-span={item.span} className={cx("min-w-0 flex-col gap-lg border-t pt-lg", isWideRule ? "ledger-rule-wide" : "flex", RULE_BORDER_CLASSES[ground], RULE_SPAN_CLASSES[item.span], item.href === undefined ? undefined : linkedContainer)} style={{ borderBlockStartWidth: UI_BORDER_HAIRLINE }}><div data-card-grid-text="" className="min-w-0 flex flex-col gap-md">{icon}{copy}</div>{visual}</article>;
        return (
          <article
            key={item.id}
            data-card-grid-item=""
            data-span={item.span}
            className={cx("flex min-w-0", lone[index] ? LONE_THIRD_CLASSES : SPAN_CLASSES[item.span])}
          >
            <ItemPlate
              ground={ground}
              className={cx("flex w-full flex-col gap-md tablet:p-xl desktop:p-2xl", item.href === undefined ? undefined : linkedContainer)}
            >
              {body}
            </ItemPlate>
          </article>
        );
      })}
    </div>
  );
}
