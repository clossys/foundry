import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Card } from "../atoms/Card.js";
import { cx } from "../atoms/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { assertNoNestedInteractive, CardLinkTitle, cardLinkContainerClassName } from "./stretched-link.js";

/** A card's share of a 12-unit row at the widest breakpoint. */
export type CardGridSpan = "third" | "half" | "two-thirds" | "full";

/** Which heading element each card's heading renders as. */
export type CardGridHeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface CardGridItem {
  /** Stable identifier: the React key. */
  id: string;
  /** Optional icon above the eyebrow. Decorative (`aria-hidden`). */
  icon?: ReactNode;
  /** Small label above the card heading. */
  eyebrow?: ReactNode;
  /** The card's heading, at `headingLevel`. */
  heading: ReactNode;
  /** Supporting copy under the heading. */
  description?: ReactNode;
  /** The card's share of its row. Spans must fill whole rows (see the component doc comment). */
  span: CardGridSpan;
  /**
   * Optional visual pinned to the bottom of the card (typically a one-part
   * `Specimen`, which carries its own accessible name).
   */
  visual?: ReactNode;
  /**
   * Links the whole card: the heading becomes the link (its name), with a
   * chevron, and the plate is the hit area. Link every card or none. The
   * card may then hold no other interactive element.
   */
  href?: string;
}

export interface CardGridProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** 2 to 6 cards whose spans fill whole rows. */
  items: readonly CardGridItem[];
  /** Which heading element each card heading uses: one below the section heading. @default 3 */
  headingLevel?: CardGridHeadingLevel;
  /** The ground the grid sits on; each card is a plate of the other ground. @default "base" */
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}

/** Units of a 12-unit row each span takes. */
export const CARD_GRID_SPAN_UNITS: Readonly<Record<CardGridSpan, number>> = {
  third: 4,
  half: 6,
  "two-thirds": 8,
  full: 12,
};

const HEADING_TAGS = { 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const satisfies Record<CardGridHeadingLevel, string>;

const ROW_UNITS = 12;
const MIN_CARDS = 2;
const MAX_CARDS = 6;

/**
 * Span classes. One column below `tablet`; at `tablet` a two-thirds card
 * takes the full row and a third takes half; the 12-unit spans apply from
 * `tablet-lg`.
 */
/** The one span name that is not a bare identifier: a computed key keeps the name out of the class scan. */
const TWO_THIRDS = "two-thirds" as const;

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

/** Units of a 12-unit row each span takes at `tablet`. */
const TABLET_UNITS: Readonly<Record<CardGridSpan, number>> = { third: 6, half: 6, [TWO_THIRDS]: 12, full: 12 };

/** For each card, whether it is a third left alone in its `tablet` row. */
function loneTabletThirds(spans: readonly CardGridSpan[]): boolean[] {
  const lone = spans.map(() => false);
  let index = 0;
  while (index < spans.length) {
    const span = spans[index] as CardGridSpan;
    const next = spans[index + 1];
    if (TABLET_UNITS[span] === 6 && (next === undefined || TABLET_UNITS[next] === 12)) {
      lone[index] = span === "third";
      index += 1;
    } else {
      index += TABLET_UNITS[span] === 6 ? 2 : 1;
    }
  }
  return lone;
}

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
export function assertCardGridSpans(spans: readonly CardGridSpan[]): void {
  if (spans.length < MIN_CARDS || spans.length > MAX_CARDS) {
    throw new RangeError("CardGrid: expected " + MIN_CARDS + " to " + MAX_CARDS + " cards, got " + spans.length + ".");
  }
  let filled = 0;
  spans.forEach((span, index) => {
    const units = CARD_GRID_SPAN_UNITS[span];
    if (units === undefined) throw new RangeError("CardGrid: card " + index + ' has an unknown span "' + String(span) + '".');
    filled += units;
    if (filled > ROW_UNITS) {
      throw new RangeError(
        "CardGrid: card " + index + " overflows its row; rows must be two-thirds + third, three thirds, two halves, or one full card.",
      );
    }
    if (filled === ROW_UNITS) filled = 0;
  });
  if (filled !== 0) {
    throw new RangeError(
      "CardGrid: the last row is not filled; rows must be two-thirds + third, three thirds, two halves, or one full card.",
    );
  }
}

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
export function CardGrid({ items, headingLevel = 3, ground = "base", className, style, ...rest }: CardGridProps) {
  assertCardGridSpans(items.map((item) => item.span));
  const HeadingTag = HEADING_TAGS[headingLevel];
  const colors = SECTION_GROUND_CLASSES[ground];
  /** A linked card: the plate is the hit area and carries the ring. */
  const linkedContainer = cardLinkContainerClassName("plate", ground);
  const lone = loneTabletThirds(items.map((item) => item.span));

  return (
    <div
      {...rest}
      data-card-grid=""
      className={cx("grid grid-cols-1 gap-lg tablet:grid-cols-12", className)}
      style={style}
    >
      {items.map((item, index) => {
        if (item.href !== undefined) assertNoNestedInteractive("CardGrid", item.id, [item.icon, item.eyebrow, item.heading, item.description, item.visual]);
        return (
          <article
            key={item.id}
            data-card-grid-item=""
            data-span={item.span}
            className={cx("flex min-w-0", lone[index] ? LONE_THIRD_CLASSES : SPAN_CLASSES[item.span])}
          >
            <Card
              variant="plate"
              ground={ground}
              className={cx("flex w-full flex-col gap-md tablet:p-xl desktop:p-2xl", item.href === undefined ? undefined : linkedContainer)}
            >
              {item.icon ? (
                <span aria-hidden="true" className={cx("inline-flex", ICON_ACCENT_CLASSES[ground])}>
                  {item.icon}
                </span>
              ) : null}
              <div className="flex flex-col gap-xs">
                {item.eyebrow ? (
                  // Secondary, not muted: the plate is a raised or sunken fill, where muted ink is only AA-large.
                  <p className={cx("text-body-s font-medium uppercase tracking-label", colors.secondary)}>{item.eyebrow}</p>
                ) : null}
                {/* A linked title drops the display face's horizontal-scale transform: a transformed heading would become the
                    containing block of the link's stretched hit area and shrink it to the title. */}
                <HeadingTag className={cx("text-h2 font-display leading-heading text-balance", colors.primary, item.href === undefined ? undefined : "transform-none")}>
                  {item.href === undefined ? (
                    item.heading
                  ) : (
                    <CardLinkTitle href={item.href} frame="plate" ground={ground} iconSize="md">
                      {item.heading}
                    </CardLinkTitle>
                  )}
                </HeadingTag>
                {item.description ? (
                  <p className={cx("text-body text-pretty", colors.secondary)}>{item.description}</p>
                ) : null}
              </div>
              {item.visual ? (
                <div data-card-grid-visual="" className="mt-auto w-full min-w-0 pt-md">
                  {item.visual}
                </div>
              ) : null}
            </Card>
          </article>
        );
      })}
    </div>
  );
}
