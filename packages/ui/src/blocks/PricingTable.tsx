import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Badge } from "../atoms/Badge.js";
import { Card } from "../atoms/Card.js";
import { cx } from "../atoms/internal/cx.js";

export type PricingTableHeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface PricingTier {
  /** Stable identifier — the React key. */
  id: string;
  /** The tier's own name ("Free", "Team"). */
  name: ReactNode;
  /** The price itself, exactly as it should render ("$12", "$0"). Format (currency, period suffix) is entirely the consumer's own composition. */
  price: ReactNode;
  /** Supporting copy under the price ("per editor, billed monthly"). */
  description?: ReactNode;
  /** This tier's own feature list, one entry per list item. */
  features: readonly ReactNode[];
  /** Slot for this tier's own call to action — typically a `Button` atom. */
  cta: ReactNode;
  /**
   * Marks this tier as the recommended one — drives emphasis styling
   * (an accent border) only. Pair with `badge` for a visible, non-colour
   * label; a border alone would make the distinction invisible to a
   * screen reader and disappear entirely in greyscale, the same
   * colour-is-never-the-only-channel reasoning `Stat`'s trend indicator
   * and `ConfirmDialog`'s `tone` documentation both give elsewhere in this
   * package.
   * @default false
   */
  isHighlighted?: boolean;
  /**
   * Slot for a highlight label ("Recommended", "Best value") shown on a
   * `isHighlighted` tier. A plain optional `ReactNode`, not a built-in
   * default string: this package ships no copy of its own (see this
   * package's README, "Public contract" — audience-facing words belong to
   * `@vespeneventures/copy`), so there is nothing sensible to default this
   * to. Rendered regardless of `isHighlighted` if supplied — the two are
   * independent props, not a discriminated pair, so a tier can carry a
   * badge without the accent-border emphasis or vice versa if a consumer's
   * design genuinely wants that split.
   */
  badge?: ReactNode;
}

export interface PricingTableProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Optional heading above the tier grid. */
  heading?: ReactNode;
  /** A line of supporting copy under the heading. */
  description?: ReactNode;
  /** The tiers to render, as data. */
  tiers: readonly PricingTier[];
  /**
   * Which heading element `heading` renders as — the same `SectionHeader`-
   * derived reasoning `FeatureGrid`'s own `headingLevel` documents.
   * @default 2
   */
  headingLevel?: PricingTableHeadingLevel;
  className?: string;
  style?: CSSProperties;
}

/**
 * A set of pricing tiers — an optional heading region above a grid of tier
 * cards below: two regions that differ in kind, which is what makes this a
 * block and not an atom (this package's README, "Placement rules", test 2),
 * even though the TIERS are a homogeneous repeat (each plays the same
 * "one plan" role, the same shape `FeatureGrid`'s items and `NavGrid`'s
 * cards already are). A page can hold two `PricingTable`s (a monthly/annual
 * toggle implemented as two tables a consumer switches between, or two
 * separate product lines each with their own pricing), which is what makes
 * it a block rather than a view (test 3).
 *
 * **Each tier's own name is deliberately NOT a real heading element**, the
 * same reasoning `FeatureGrid`'s own item headings document: `tiers` is a
 * homogeneous repeat, not a set of named page regions, so giving every
 * tier card its own heading would add N heading-navigation stops with no
 * independent section behind each one.
 *
 * **`features` is a plain list of `ReactNode`s, not a richer per-feature
 * shape** (no built-in "included/excluded" boolean, no icon slot per row):
 * this package ships no opinion about how a consumer wants to represent
 * "not included" (omit the row entirely, render it dimmed, render a
 * cross-out icon) — the same reasoning `DataTable`'s `columns` stays plain
 * `cell(row)` render functions rather than a fixed cell-type enum.
 * Composing a checkmark `Icon` (decorative — the feature TEXT already
 * carries the meaning) into a feature node is ordinary consumer code, not
 * something this block needs a prop for.
 *
 * **Built on this package's own `Card` atom** (blocks may compose atoms —
 * see this package's README) for each tier's raised surface; an
 * `isHighlighted` tier layers an accent border on top via `className`,
 * merged last so it always wins over `Card`'s own default styling.
 */
export function PricingTable({
  heading,
  description,
  tiers,
  headingLevel = 2,
  className,
  style,
  ...rest
}: PricingTableProps) {
  const HeadingTag = `h${headingLevel}` as `h${PricingTableHeadingLevel}`;
  const hasHeadingRegion = heading !== undefined || description !== undefined;

  return (
    <div {...rest} className={cx("flex flex-col gap-lg", className)} style={style}>
      {hasHeadingRegion ? (
        <div className="flex flex-col gap-xs">
          {heading ? (
            <HeadingTag className="text-h2 font-display text-ink-primary">{heading}</HeadingTag>
          ) : null}
          {description ? (
            <p className="text-body text-ink-secondary">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3">
        {tiers.map((tier) => (
          <Card
            key={tier.id}
            className={cx(
              "flex h-full flex-col items-start gap-md",
              tier.isHighlighted ? "border-2 border-accent" : undefined,
            )}
          >
            {tier.badge ? <Badge variant="info">{tier.badge}</Badge> : null}
            <p className="text-body font-body font-medium text-ink-primary">{tier.name}</p>
            <p className="text-h1 font-display text-ink-primary">{tier.price}</p>
            {tier.description ? (
              <p className="text-body-s text-ink-secondary">{tier.description}</p>
            ) : null}
            <ul className="flex flex-1 flex-col gap-xs">
              {/* Index as key: a feature list is fixed, ordered prose per
                  tier with no stable identity of its own — the same
                  reasoning `Faq`'s answer text and `DetailView`'s field
                  values need no separate id, since the whole tier re-renders
                  together as one unit rather than individual rows
                  reordering independently. */}
              {tier.features.map((feature, index) => (
                <li key={index} className="text-body-s text-ink-secondary">
                  {feature}
                </li>
              ))}
            </ul>
            <div className="w-full">{tier.cta}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
