import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

export type FeatureGridHeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface FeatureGridItem {
  /** Stable identifier — the React key. */
  id: string;
  /** Icon slot, rendered above the item's own heading. Decorative — see the component doc comment. */
  icon?: ReactNode;
  /** The feature's own name. */
  heading: ReactNode;
  /** Supporting copy under the item's heading. */
  description?: ReactNode;
}

export interface FeatureGridProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Small label above the grid's own heading. */
  eyebrow?: ReactNode;
  /** Optional heading above the grid. */
  heading?: ReactNode;
  /** A line of supporting copy under the heading. */
  description?: ReactNode;
  /** The features to render, as data — a homogeneous repeat (see the component doc comment). */
  items: readonly FeatureGridItem[];
  /**
   * Which heading element `heading` renders as — real and settable, the
   * same reasoning `SectionHeader`'s own `level` prop documents, so a
   * `FeatureGrid` sitting under a page's `<h1>` (`headingLevel={2}`,
   * the default) or nested one level deeper under a `SectionHeader`
   * (`headingLevel={3}`) keeps the document outline unbroken either way.
   * @default 2
   */
  headingLevel?: FeatureGridHeadingLevel;
  /** Semantic section ground; selects the complete matching surface and foreground policy. @default "base" */
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}

/**
 * A titled collection of features — an optional eyebrow/heading/description
 * region above a grid of feature items below: two regions that differ in
 * kind, which is what makes `FeatureGrid` a block and not an atom (this
 * package's README, "Placement rules", test 2), even though the ITEMS
 * inside it are a homogeneous repeat (each item plays the same role as any
 * other — swap two and nothing about the grid's job changes, the same
 * "list of similar things" shape `Breadcrumb`'s crumbs and `NavGrid`'s
 * cards already are elsewhere in this package). A page can hold two
 * `FeatureGrid`s (two separate feature groupings, e.g. under two different
 * `SectionHeader`s on a long page), which is what makes it a block rather
 * than a view (test 3).
 *
 * **Each item's `heading` is deliberately NOT a real heading element.**
 * The same reasoning `NavGrid`'s own section documents for its cards'
 * titles: `items` is a homogeneous repeat, not a set of named regions, so
 * giving every item its own `<h3>`/etc. would add N heading-navigation stops
 * with no corresponding independent section for a screen-reader user to
 * jump to — noise, not structure. The grid's own optional `heading` (via
 * `headingLevel`, above) is the real heading; item headings render as
 * plain, visually prominent text instead.
 *
 * `icon` is `aria-hidden` — decorative reinforcement for a heading that's
 * already the item's real content, not a second source of meaning a screen
 * reader needs to parse separately, the same treatment `NavGrid`'s own
 * `icon` slot gets.
 *
 * Items lay out one per row on narrow viewports, two from the `tablet`
 * breakpoint, three from `desktop` — the same plain Tailwind responsive
 * grid `NavGrid` uses, generated from this package's own breakpoint
 * tokens, no JS breakpoint state.
 */
export function FeatureGrid({
  eyebrow,
  heading,
  description,
  items,
  headingLevel = 2,
  ground = "base",
  className,
  style,
  ...rest
}: FeatureGridProps) {
  const HeadingTag = `h${headingLevel}` as `h${FeatureGridHeadingLevel}`;
  const colors = SECTION_GROUND_CLASSES[ground];
  const hasHeadingRegion = eyebrow !== undefined || heading !== undefined || description !== undefined;

  return (
    <div {...rest} className={cx("flex flex-col gap-lg", colors.surface, className)} style={style}>
      {hasHeadingRegion ? (
        <div className="flex flex-col gap-xs">
          {eyebrow ? (
            <p className={cx("text-caption uppercase tracking-label", colors.muted)}>{eyebrow}</p>
          ) : null}
          {heading ? (
            <HeadingTag className={cx("text-h2 font-display", colors.primary)}>{heading}</HeadingTag>
          ) : null}
          {description ? (
            <p className={cx("text-body", colors.secondary)}>{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3">
        {items.map((item) => (
          <div key={item.id} className="flex flex-col items-start gap-sm">
            {item.icon ? (
              <span aria-hidden="true" className={colors.muted}>
                {item.icon}
              </span>
            ) : null}
            <p className={cx("text-body font-body font-medium", colors.primary)}>{item.heading}</p>
            {item.description ? (
              <p className={cx("text-body-s", colors.secondary)}>{item.description}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
