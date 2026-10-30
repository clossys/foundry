import { SectionHeader } from "./SectionHeader.js";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Badge } from "../components/Badge.js";
import { Card } from "../components/Card.js";
import { cx } from "../components/internal/cx.js";
import { Matrix } from "./Matrix.server.js";
import type { MatrixCellData, MatrixGridProps } from "./Matrix.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.pricing", "foundry/sections.pricing");

export type PricingTableHeadingLevel = 2 | 3 | 4 | 5 | 6;

interface PricingTierBase {
  /** Stable identifier — the React key. */
  id: string;
  /** The tier's own name ("Free", "Team"). */
  name: ReactNode;
  /** Supporting copy under the price ("per editor, billed monthly"). */
  description?: ReactNode;
  /** This tier's own feature list, one entry per list item. */
  features: readonly ReactNode[];
  /** Slot for this tier's own call to action — typically a `Button` component. */
  cta: ReactNode;
  /**
   * Marks this tier as the recommended one with an accent border and,
   * when comparison is supplied, a featured column. Pair with `badge` for
   * a visible, non-colour label; a border alone would make the distinction invisible to a
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
   * `@example/copy`), so there is nothing sensible to default this
   * to. Rendered regardless of `isHighlighted` if supplied — the two are
   * independent props, not a discriminated pair, so a tier can carry a
   * badge without the accent-border emphasis or vice versa if a consumer's
   * design genuinely wants that split.
   */
  badge?: ReactNode;
}

/** One interval's visible amount, spoken price and optional supporting note. */
export interface PricingTierPrice {
  amount: ReactNode;
  priceText: string;
  note?: ReactNode;
}

/** A tier supplies either a fixed price or amounts keyed by interval. */
export type PricingTier = PricingTierBase & (
  | { price: ReactNode; priceByInterval?: never }
  | { price?: never; priceByInterval: Readonly<Record<string, PricingTierPrice>> }
);

export type PricingCellData =
  | { kind: "mark"; included: boolean }
  | { kind: "text"; text: ReactNode };

export interface PricingComparisonRow {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  cells: Readonly<Record<string, PricingCellData>>;
}

export interface PricingComparisonGroup {
  id: string;
  label: ReactNode;
  rows: readonly PricingComparisonRow[];
}

export interface PricingComparison {
  groups: readonly PricingComparisonGroup[];
  featuredLabel?: ReactNode;
  markLabels?: readonly [ReactNode, ReactNode, ReactNode, ReactNode, ReactNode];
  keyLabel?: ReactNode;
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
  /** Selects an amount when a tier supplies interval prices. */
  interval?: string;
  /** One to four groups of tier comparison rows. */
  comparison?: PricingComparison;
  /** Host-owned controls between the heading region and tier grid. */
  controls?: ReactNode;
  /** Heading, description and comparison inks; tier surfaces stay raised. */
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}

function assertPrices(tiers: readonly PricingTier[], interval: string | undefined): void {
  let sharedKeys: readonly string[] | undefined;
  for (const tier of tiers) {
    const hasFixed = "price" in tier;
    const hasIntervals = tier.priceByInterval !== undefined;
    if (hasFixed === hasIntervals) throw new TypeError("PricingTable: each tier needs one price form.");
    if (!hasIntervals) continue;
    const prices = tier.priceByInterval!;
    const keys = Object.keys(prices);
    if (sharedKeys !== undefined && (keys.length !== sharedKeys.length || sharedKeys.some(key => !Object.hasOwn(prices, key)))) {
      throw new TypeError("PricingTable: interval price key sets must match.");
    }
    sharedKeys = keys;
    if (interval === undefined || !Object.hasOwn(prices, interval)) throw new TypeError("PricingTable: a known interval is required.");
    for (const price of Object.values(prices)) {
      if (!price || typeof price.priceText !== "string" || price.priceText.trim().length === 0) {
        throw new TypeError("PricingTable: interval prices need nonempty priceText.");
      }
    }
  }
  if (interval !== undefined && sharedKeys === undefined) throw new TypeError("PricingTable: interval requires interval prices.");
}

function comparisonCell(cell: PricingCellData): MatrixCellData {
  return cell.kind === "mark"
    ? { type: "mark", value: cell.included ? 4 : 0 }
    : { type: "text", text: cell.text };
}

function comparisonRows(group: PricingComparisonGroup): MatrixGridProps["rows"] {
  return group.rows.map(row => ({
    id: row.id,
    label: row.label,
    description: row.description,
    cells: Object.fromEntries(Object.entries(row.cells).map(([id, cell]) => [id, comparisonCell(cell)])),
  }));
}

/**
 * A set of pricing tiers — an optional heading region above a grid of tier
 * cards below: two regions that differ in kind, which is what makes this a
 * block and not an component (this package's README, "Placement rules", test 2),
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
 * **Built on this package's own `Card` component** (blocks may compose components —
 * see this package's README) for each tier's raised surface; an
 * `isHighlighted` tier layers an accent border on top via `className`,
 * merged last so it always wins over `Card`'s own default styling. When
 * `comparison` is supplied each group is a `Matrix` grid, and `ground`
 * selects the shared section-ground inks for the heading region.
 */
export function PricingTable({
  heading,
  description,
  tiers,
  headingLevel = 2,
  interval,
  comparison,
  controls,
  ground = "base",
  className,
  style,
  ...rest
}: PricingTableProps) {
  assertPrices(tiers, interval);
  const hasHeadingRegion = heading !== undefined || description !== undefined;
  const colors = SECTION_GROUND_CLASSES[ground];
  const groupHeadingLevel = Math.min(headingLevel + 1, 6) as PricingTableHeadingLevel;
  const GroupHeading = `h${groupHeadingLevel}` as `h${PricingTableHeadingLevel}`;
  const rowHeadingLevel = Math.min(headingLevel + 2, 6) as PricingTableHeadingLevel;
  const highlighted = tiers.filter(tier => tier.isHighlighted);
  const featuredTier = highlighted[0];
  const comparisonHasMarks = comparison?.groups.some(group => group.rows.some(row => Object.values(row.cells).some(cell => cell.kind === "mark"))) ?? false;
  if (comparison !== undefined) {
    if (comparison.groups.length < 1 || comparison.groups.length > 4) throw new TypeError("PricingTable: comparison needs one to four groups.");
    if (new Set(comparison.groups.map(group => group.id)).size !== comparison.groups.length) throw new TypeError("PricingTable: comparison group ids must be distinct.");
    if (highlighted.length > 1) throw new TypeError("PricingTable: comparison supports one highlighted tier.");
  }

  return (
    <div {...SECTION_STAMP} {...rest} className={cx("flex flex-col gap-lg", className)} style={style}>
      {hasHeadingRegion ? (
        <SectionHeader density="standard" level={headingLevel} ground={ground} description={description} {...(heading ? { title: heading } : {})} />
      ) : null}
      {controls !== undefined ? <div className="flex justify-center">{controls}</div> : null}
      <div className="grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3">
        {tiers.map((tier) => {
          const selected = tier.priceByInterval !== undefined ? tier.priceByInterval[interval!] : undefined;
          return (
            <Card
              key={tier.id}
              className={cx(
                "flex h-full flex-col items-start gap-md",
                tier.isHighlighted ? "border-2 border-accent" : undefined,
              )}
            >
              {tier.badge ? <Badge variant="info">{tier.badge}</Badge> : null}
              <p className="text-body font-body font-medium text-ink-primary">{tier.name}</p>
              {selected !== undefined ? <>
                <p className="text-h1 font-display text-ink-primary"><span aria-hidden="true">{selected.amount}</span><span className="sr-only">{selected.priceText}</span></p>
                {selected.note !== undefined ? <p className="text-body-s text-ink-secondary">{selected.note}</p> : null}
              </> : <p className="text-h1 font-display text-ink-primary">{tier.price}</p>}
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
          );
        })}
      </div>
      {comparison !== undefined ? <div className="flex flex-col gap-xl">
        {comparison.groups.map(group => {
          const rows = comparisonRows(group);
          const hasMarks = rows.some(row => Object.values(row.cells).some(cell => cell.type === "mark"));
          const forwardMarkLabels = hasMarks || !comparisonHasMarks;
          return <div key={group.id} className="flex flex-col gap-md">
            <GroupHeading className={cx("text-h3 font-display", colors.primary)}>{group.label}</GroupHeading>
            <Matrix
              arrangement="grid"
              columns={tiers.map(tier => ({ id: tier.id, label: tier.name }))}
              rows={rows}
              headingLevel={rowHeadingLevel}
              ground={ground}
              featured={featuredTier !== undefined ? { column: featuredTier.id } : undefined}
              featuredLabel={comparison.featuredLabel}
              markLabels={forwardMarkLabels ? comparison.markLabels : undefined}
              keyLabel={forwardMarkLabels ? comparison.keyLabel : undefined}
            />
          </div>;
        })}
      </div> : null}
    </div>
  );
}
