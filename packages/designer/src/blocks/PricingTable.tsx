import type { ComponentType, CSSProperties, HTMLAttributes, ReactNode } from "react";

import { cx } from "../components/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const Badge = componentLeaf<typeof import("../components/preview-runtime/components/badge/badge.js").Badge>("components.badge");
type Part = ComponentType<HTMLAttributes<HTMLElement>>;
const Card = componentLeaf<typeof import("../components/preview-runtime/components/card/card.js").Card>("components.card");
const CardHeader = componentLeaf<Part>("components.card", "CardHeader");
const CardContent = componentLeaf<Part>("components.card", "CardContent");
const CardFooter = componentLeaf<Part>("components.card", "CardFooter");
const Table = componentLeaf<Part>("components.table");
const TableHeader = componentLeaf<Part>("components.table", "TableHeader");
const TableBody = componentLeaf<Part>("components.table", "TableBody");
const TableRow = componentLeaf<ComponentType<HTMLAttributes<HTMLElement> & { textValue?: string }>>("components.table", "TableRow");
const TableHead = componentLeaf<ComponentType<HTMLAttributes<HTMLElement> & { isRowHeader?: boolean }>>("components.table", "TableHead");
const TableCell = componentLeaf<Part>("components.table", "TableCell");
const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

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

/** A tier supplies a fixed price, null for a generic plan comparison, or interval amounts. */
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
  /** One to four groups of tier comparison rows through the selected Table leaf. */
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
 * `comparison` is supplied each group uses the selected Table sub-parts, and `ground`
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
  const highlighted = tiers.filter(tier => tier.isHighlighted);
  const featuredTier = highlighted[0];
  if (comparison !== undefined) {
    if (comparison.groups.length < 1 || comparison.groups.length > 4) throw new TypeError("PricingTable: comparison needs one to four groups.");
    if (new Set(comparison.groups.map(group => group.id)).size !== comparison.groups.length) throw new TypeError("PricingTable: comparison group ids must be distinct.");
    if (highlighted.length > 1) throw new TypeError("PricingTable: comparison supports one highlighted tier.");
    if (featuredTier && comparison.featuredLabel === undefined) throw new TypeError("PricingTable: featuredLabel is required.");
    const hasMarks = comparison.groups.some(group => group.rows.some(row => Object.values(row.cells).some(cell => cell.kind === "mark")));
    if (hasMarks && (!comparison.markLabels || comparison.keyLabel === undefined)) throw new TypeError("PricingTable: mark cells need markLabels and keyLabel.");
    if (!hasMarks && comparison.markLabels) throw new TypeError("PricingTable: unused markLabels.");
    for (const group of comparison.groups) for (const row of group.rows) {
      if (Object.keys(row.cells).length !== tiers.length || tiers.some(tier => !Object.hasOwn(row.cells, tier.id))) throw new TypeError("PricingTable: row cells must match tier ids.");
    }
  }

  return (
    <SemanticContent as="div" {...SECTION_STAMP} {...rest} className={cx("flex flex-col gap-lg", className)} style={style}>
      {hasHeadingRegion ? (
        <SemanticContent as="div" className="flex flex-col gap-xs">
          {heading ? <SemanticContent as={`h${headingLevel}`} className={cx("text-h2 font-display", colors.primary)}>{heading}</SemanticContent> : null}
          {description !== undefined ? <SemanticContent as="p" className={cx("text-body", colors.secondary)}>{description}</SemanticContent> : null}
        </SemanticContent>
      ) : null}
      {controls !== undefined ? <SemanticContent as="div" className="flex justify-center">{controls}</SemanticContent> : null}
      <SemanticContent as="div" className="grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3">
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
              <CardHeader>
              {tier.badge ? <Badge>{tier.badge}</Badge> : null}
              <SemanticContent as="p" className="text-body font-body font-medium text-ink-primary">{tier.name}</SemanticContent>
              {selected !== undefined ? <>
                <SemanticContent as="p" className="text-h1 font-display text-ink-primary"><SemanticContent as="span" aria-hidden="true">{selected.amount}</SemanticContent><SemanticContent as="span" className="sr-only">{selected.priceText}</SemanticContent></SemanticContent>
                {selected.note !== undefined ? <SemanticContent as="p" className="text-body-s text-ink-secondary">{selected.note}</SemanticContent> : null}
              </> : tier.price !== null ? <SemanticContent as="p" className="text-h1 font-display text-ink-primary">{tier.price}</SemanticContent> : null}
              {tier.description ? (
                <SemanticContent as="p" className="text-body-s text-ink-secondary">{tier.description}</SemanticContent>
              ) : null}
              </CardHeader>
              <CardContent className="flex-1">
              <SemanticContent as="ul" className="flex flex-col gap-xs">
                {/* Index as key: a feature list is fixed, ordered prose per
                    tier with no stable identity of its own — the same
                    reasoning `Faq`'s answer text and `DetailView`'s field
                    values need no separate id, since the whole tier re-renders
                    together as one unit rather than individual rows
                    reordering independently. */}
                {tier.features.map((feature, index) => (
                  <SemanticContent as="li" key={index} className="text-body-s text-ink-secondary">
                    {feature}
                  </SemanticContent>
                ))}
              </SemanticContent>
              </CardContent>
              <CardFooter className="w-full">{tier.cta}</CardFooter>
            </Card>
          );
        })}
      </SemanticContent>
      {comparison !== undefined ? <SemanticContent as="div" className="flex flex-col gap-xl">
        {comparison.keyLabel !== undefined ? <SemanticContent as="p" className={colors.secondary}>{comparison.keyLabel}</SemanticContent> : null}
        {comparison.groups.map(group => {
          return <SemanticContent as="div" key={group.id} className="flex flex-col gap-md">
            <SemanticContent as={GroupHeading} className={cx("text-h3 font-display", colors.primary)}>{group.label}</SemanticContent>
            <Table aria-label={typeof group.label === "string" ? group.label : undefined}>
              <TableHeader>
                <TableHead id="feature" isRowHeader>{group.label}</TableHead>
                {tiers.map(tier => <TableHead key={tier.id} id={tier.id}>{tier.name}{tier.id === featuredTier?.id ? comparison.featuredLabel : null}</TableHead>)}
              </TableHeader>
              <TableBody>{group.rows.map(row => <TableRow key={row.id} id={row.id} textValue={typeof row.label === "string" ? row.label : undefined}>
                <TableCell>{row.label}{row.description !== undefined ? <SemanticContent as="p">{row.description}</SemanticContent> : null}</TableCell>
                {tiers.map(tier => {
                  const cell = row.cells[tier.id];
                  if (!cell) throw new TypeError("PricingTable: row cells must include every tier.");
                  if (cell.kind === "mark" && !comparison.markLabels) throw new TypeError("PricingTable: mark cells need mark labels.");
                  return <TableCell key={tier.id}>{cell.kind === "text" ? cell.text : comparison.markLabels![cell.included ? 4 : 0]}</TableCell>;
                })}
              </TableRow>)}</TableBody>
            </Table>
          </SemanticContent>;
        })}
      </SemanticContent> : null}
    </SemanticContent>
  );
}
