import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { SectionGround } from "./section-ground.js";
import { CompatCardGrid } from "./items/compat-cards.js";
import { ITEM_SPAN_UNITS, assertOrderedRows } from "./items/policies.js";

/** A card's share of a 12-unit row at the widest breakpoint. */
export type CardGridSpan = "third" | "half" | "two-thirds" | "full";

/** Which heading element each card's heading renders as. */
export type CardGridHeadingLevel = 2 | 3 | 4 | 5 | 6;

export type CardGridTreatment = "plate" | "rule";

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
  /** Unboxed cards on hairlines, or the original plate treatment. @default "plate" */
  treatment?: CardGridTreatment;
  className?: string;
  style?: CSSProperties;
}

export const CARD_GRID_SPAN_UNITS = ITEM_SPAN_UNITS;
/** The existing CardGrid span diagnostics, backed by the shared ordered-row policy. */
export function assertCardGridSpans(spans: readonly CardGridSpan[]): void {
  assertOrderedRows(spans, {
    count: (n) => "CardGrid: expected 2 to 6 cards, got " + n + ".",
    unknown: (i, span) => "CardGrid: card " + i + ' has an unknown span "' + String(span) + '".',
    overflow: (i) => "CardGrid: card " + i + " overflows its row; rows must be two-thirds + third, three thirds, two halves, or one full card.",
    incomplete: "CardGrid: the last row is not filled; rows must be two-thirds + third, three thirds, two halves, or one full card.",
  });
}
export function CardGrid({ headingLevel = 3, ground = "base", treatment = "plate", ...props }: CardGridProps) {
  assertCardGridSpans(props.items.map((item) => item.span));
  return <CompatCardGrid {...props} headingLevel={headingLevel} ground={ground} treatment={treatment} />;
}
