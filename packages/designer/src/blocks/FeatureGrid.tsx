import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Card } from "../atoms/Card.js";
import { cx } from "../atoms/internal/cx.js";
import { UI_BORDER_RULE } from "../atoms/internal/ui-vars.js";
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

/** How many columns the grid reaches at its widest. */
export type FeatureGridColumns = 2 | 3 | 4;

/**
 * How each item is set apart: `plain` (type on the ground), `rule` (a 2px
 * `line-strong` rule above each item), or `plate` (each item on a `Card`
 * plate, the other ground).
 */
export type FeatureGridTreatment = "plain" | "rule" | "plate";

/** `item`: the item heading at body scale. `statement`: the item heading in the display font at `text-h1`, for a few principles. */
export type FeatureGridEmphasis = "item" | "statement";

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
  /**
   * Columns at the widest breakpoint (two from `tablet`, one below). Setting
   * `columns`, `treatment` or `emphasis` opts into the catalog layout (see
   * the component doc comment); leaving all three unset keeps the original
   * grid unchanged.
   */
  columns?: FeatureGridColumns;
  /** @default "plain" (catalog layout only) */
  treatment?: FeatureGridTreatment;
  /** @default "item" (catalog layout only) */
  emphasis?: FeatureGridEmphasis;
  className?: string;
  style?: CSSProperties;
}

const CATALOG_COLUMN_CLASSES: Record<FeatureGridColumns, string> = {
  2: "grid grid-cols-1 gap-x-2xl gap-y-3xl tablet:grid-cols-2",
  3: "grid grid-cols-1 gap-x-2xl gap-y-3xl tablet:grid-cols-2 tablet-lg:grid-cols-3",
  4: "grid grid-cols-1 gap-x-2xl gap-y-3xl tablet:grid-cols-2 tablet-lg:grid-cols-4",
};

/** The emphasis rule's colour per ground: `line-strong` on the light grounds, the inverse line on an inverse band. */
const RULE_BORDER_CLASSES: Record<SectionGround, string> = {
  base: "border-line-strong",
  sunken: "border-line-strong",
  inverse: "border-line-on-inverse",
};

interface CatalogGridProps {
  items: readonly FeatureGridItem[];
  /** @default 3 */
  columns?: FeatureGridColumns | undefined;
  /** @default "plain" */
  treatment?: FeatureGridTreatment | undefined;
  /** @default "item" */
  emphasis?: FeatureGridEmphasis | undefined;
  ground: SectionGround;
}

function CatalogGrid({ items, columns = 3, treatment = "plain", emphasis = "item", ground }: CatalogGridProps) {
  const colors = SECTION_GROUND_CLASSES[ground];
  const statement = emphasis === "statement";
  const showIcons = treatment !== "rule";

  return (
    <div data-feature-grid-columns={columns} data-treatment={treatment} data-emphasis={emphasis} className={CATALOG_COLUMN_CLASSES[columns]}>
      {items.map((item) => {
        const body = (
          <>
            {showIcons && item.icon ? (
              <span aria-hidden="true" className={cx("inline-flex", colors.muted)}>
                {item.icon}
              </span>
            ) : null}
            <p
              className={cx(
                statement ? "text-h1 font-display leading-heading text-balance" : "text-body font-body font-medium",
                colors.primary,
              )}
            >
              {item.heading}
            </p>
            {item.description ? (
              <p className={cx(statement ? "text-body text-pretty" : "text-body-s text-pretty", colors.secondary)}>
                {item.description}
              </p>
            ) : null}
          </>
        );

        if (treatment === "plate") {
          return (
            <Card
              key={item.id}
              variant="plate"
              ground={ground}
              data-feature-grid-item=""
              className="flex h-full flex-col items-start gap-sm tablet:p-xl"
            >
              {body}
            </Card>
          );
        }

        if (treatment === "rule") {
          return (
            <div
              key={item.id}
              data-feature-grid-item=""
              className={cx("flex flex-col items-start gap-sm border-t pt-lg", RULE_BORDER_CLASSES[ground])}
              style={{ borderBlockStartWidth: UI_BORDER_RULE }}
            >
              {body}
            </div>
          );
        }

        return (
          <div key={item.id} data-feature-grid-item="" className="flex flex-col items-start gap-sm">
            {body}
          </div>
        );
      })}
    </div>
  );
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
 *
 * **Catalog layout.** Passing any of `columns`, `treatment` or `emphasis`
 * switches to the content-catalog grid: one column below `tablet`, two from
 * `tablet`, `columns` (default 3) from `tablet-lg`, `gap-x-2xl gap-y-3xl`.
 * `treatment="rule"` tops each item with a `--ui-border-rule` rule in
 * `line-strong` and `pt-lg`; `treatment="plate"` sets each item on a
 * `Card` plate (the other ground). `emphasis="statement"` sets each item
 * heading in the display font at `text-h1`, for a short run of principles.
 * Icons render only with `plain` and `plate`: a rule already marks the item,
 * so an icon under it is clutter and is dropped. With none of the three
 * props set the original markup is emitted byte for byte, so existing
 * compositions do not move.
 */
export function FeatureGrid({
  eyebrow,
  heading,
  description,
  items,
  headingLevel = 2,
  ground = "base",
  columns,
  treatment,
  emphasis,
  className,
  style,
  ...rest
}: FeatureGridProps) {
  const catalog = columns !== undefined || treatment !== undefined || emphasis !== undefined;
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
      {catalog ? (
        <CatalogGrid
          items={items}
          columns={columns}
          treatment={treatment}
          emphasis={emphasis}
          ground={ground}
        />
      ) : (
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
      )}
    </div>
  );
}

