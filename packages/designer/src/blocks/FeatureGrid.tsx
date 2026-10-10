import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Card } from "../atoms/Card.js";
import { cx } from "../atoms/internal/cx.js";
import { UI_BORDER_RULE } from "../atoms/internal/ui-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { assertNoNestedInteractive, CardLinkTitle, cardLinkContainerClassName, type CardLinkFrame } from "./stretched-link.js";

export type FeatureGridHeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface FeatureGridItem {
  /** Stable identifier — the React key. */
  id: string;
  /** Icon slot, rendered above the item's own heading. Decorative — see the component doc comment. */
  icon?: ReactNode;
  /**
   * A short label above the item heading (an area, a role, a stage), set as
   * a caption in secondary ink. Optional: an item without one renders as
   * before.
   */
  eyebrow?: ReactNode;
  /** The feature's own name. */
  heading: ReactNode;
  /** Supporting copy under the item's heading. */
  description?: ReactNode;
  /**
   * Links the whole item: the heading becomes the link (its name), with a
   * chevron, and the item is the hit area. Link every item or none. Not with
   * `emphasis="statement"`. The item may then hold no other interactive
   * element.
   */
  href?: string;
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

/**
 * Plates are bounded shapes: the gap between them is the same both ways
 * (`gap-2xl`), so a wrapped row of plates reads as one grid. Plain and
 * rule items keep the wider row gap that separates unbounded copy.
 */
const TREATMENT_GAP_CLASSES: Record<FeatureGridTreatment, string | undefined> = {
  plain: undefined,
  rule: undefined,
  plate: "gap-y-2xl",
};

/**
 * The last item of an odd run takes the whole row at `tablet` (two
 * columns), so a three- or four-column grid never leaves one item beside an
 * empty half at tablet width; from `tablet-lg` it takes its own column again.
 */
const LONE_LAST_ITEM_CLASSES = "tablet:col-span-2 tablet-lg:col-span-1";

/** Catalog item icons carry the brand accent (`accent-on-inverse` on an inverse band): the icon marks the item, the words carry it. */
const ICON_ACCENT_CLASSES: Record<SectionGround, string> = {
  base: "text-accent",
  sunken: "text-accent",
  inverse: "text-accent-on-inverse",
};

/** The emphasis rule's colour per ground: `line-strong` on the light grounds, the inverse line on an inverse band. */
const RULE_BORDER_CLASSES: Record<SectionGround, string> = {
  base: "border-line-strong",
  sunken: "border-line-strong",
  inverse: "border-line-on-inverse",
};

function hasNode(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/**
 * The item heading, or the item eyebrow and heading as one tight group. The
 * eyebrow is secondary ink, not muted: on a plate muted ink is only
 * AA-large. Without an eyebrow the heading is emitted alone, unchanged.
 */
function withEyebrow(eyebrow: ReactNode, heading: ReactNode, ink: string, catalog = false): ReactNode {
  if (!hasNode(eyebrow)) return heading;
  return (
    <div data-feature-grid-eyebrow="" className="flex flex-col gap-xs">
      <p className={cx(catalog ? "text-body-s font-medium" : "text-caption", "uppercase tracking-label", ink)}>{eyebrow}</p>
      {heading}
    </div>
  );
}

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

/** The hover and hit-area shape of a linked item: the plate itself, or a hover plate around a bare item. */
const LINK_FRAMES: Record<FeatureGridTreatment, CardLinkFrame> = {
  plain: "plain",
  rule: "rule",
  plate: "plate",
};

/** An item's heading content: its text, or the item's link carrying it. Asserts a linked item holds nothing else interactive. */
function itemHeading(block: string, item: FeatureGridItem, frame: CardLinkFrame, ground: SectionGround): ReactNode {
  if (item.href === undefined) return item.heading;
  assertNoNestedInteractive(block, item.id, [item.icon, item.eyebrow, item.heading, item.description]);
  return (
    <CardLinkTitle href={item.href} frame={frame} ground={ground}>
      {item.heading}
    </CardLinkTitle>
  );
}

function CatalogGrid({ items, columns = 3, treatment = "plain", emphasis = "item", ground }: CatalogGridProps) {
  const colors = SECTION_GROUND_CLASSES[ground];
  const statement = emphasis === "statement";
  const showIcons = treatment !== "rule";
  const loneLast = columns > 2 && items.length % 2 === 1;
  const frame = LINK_FRAMES[treatment];
  if (statement && items.some((item) => item.href !== undefined)) {
    throw new TypeError("FeatureGrid: statement items are headlines, not destinations; drop their href and link the band another way.");
  }

  return (
    <div data-feature-grid-columns={columns} data-treatment={treatment} data-emphasis={emphasis} className={cx(CATALOG_COLUMN_CLASSES[columns], TREATMENT_GAP_CLASSES[treatment])}>
      {items.map((item, index) => {
        const span = loneLast && index === items.length - 1 ? LONE_LAST_ITEM_CLASSES : undefined;
        const linked = item.href === undefined ? undefined : cardLinkContainerClassName(frame, ground);
        const body = (
          <>
            {showIcons && item.icon ? (
              <span aria-hidden="true" className={cx("inline-flex", ICON_ACCENT_CLASSES[ground])}>
                {item.icon}
              </span>
            ) : null}
            {withEyebrow(
              item.eyebrow,
              <p
                className={cx(
                  statement ? "text-h1 font-display leading-heading text-balance" : "text-body-l font-body font-medium",
                  colors.primary,
                )}
              >
                {itemHeading("FeatureGrid", item, frame, ground)}
              </p>,
              colors.secondary,
              true,
            )}
            {item.description ? (
              <p className={cx(statement ? "text-body-l text-pretty" : "text-body text-pretty", colors.secondary)}>
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
              className={cx("flex h-full flex-col items-start gap-sm tablet:p-xl", linked, span)}
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
              className={cx("flex flex-col items-start gap-sm border-t pt-lg", RULE_BORDER_CLASSES[ground], linked, span)}
              style={{ borderBlockStartWidth: UI_BORDER_RULE }}
            >
              {body}
            </div>
          );
        }

        return (
          <div key={item.id} data-feature-grid-item="" className={cx("flex flex-col items-start gap-sm", linked, span)}>
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
 * `icon` slot gets. An item's optional `eyebrow` is a caption in secondary
 * ink directly above its heading, naming the item's area or role.
 *
 * Items lay out one per row on narrow viewports, two from the `tablet`
 * breakpoint, three from `desktop` — the same plain Tailwind responsive
 * grid `NavGrid` uses, generated from this package's own breakpoint
 * tokens, no JS breakpoint state.
 *
 * **Catalog layout.** Passing any of `columns`, `treatment` or `emphasis`
 * switches to the content-catalog grid: one column below `tablet`, two from
 * `tablet`, `columns` (default 3) from `tablet-lg`, `gap-x-2xl gap-y-3xl`
 * (`gap-2xl` both ways between plates).
 * `treatment="rule"` tops each item with a `--ui-border-rule` rule in
 * `line-strong` and `pt-lg`; `treatment="plate"` sets each item on a
 * `Card` plate (the other ground). `emphasis="statement"` sets each item
 * heading in the display font at `text-h1`, for a short run of principles;
 * `item` sets it at `text-body-l` medium over a `text-body` description.
 * Icons take the brand accent. With three or four columns, the last item
 * of an odd count spans the row at `tablet`, so no item sits alone.
 * Icons render only with `plain` and `plate`: a rule already marks the item,
 * so an icon under it is clutter and is dropped. With none of the three
 * props set the original markup is emitted byte for byte, so existing
 * compositions do not move.
 *
 * **Linked items.** An item with `href` is one link: its heading carries
 * the anchor (the link's name is the heading text) and a chevron at its
 * end, visible at rest, and the anchor's hit area covers the item, so a
 * click anywhere on it follows the link and Tab stops once, with the focus
 * ring around the whole item. A plate is its own hit area; a plain or rule
 * item gains a hover plate (the band's other ground) on hover and keyboard
 * focus. Hover underlines the heading. Link every item or none, each to its
 * own destination. A linked item may hold no other link, button or field (a
 * `TypeError`), and statement items take no `href` (a `TypeError`).
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
  /** The original grid's linked item: a bare item with a hover plate around it. */
  const linkedContainer = cardLinkContainerClassName(LINK_FRAMES.plain, ground);
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
            <div key={item.id} className={item.href === undefined ? "flex flex-col items-start gap-sm" : cx("flex flex-col items-start gap-sm", linkedContainer)}>
              {item.icon ? (
                <span aria-hidden="true" className={colors.muted}>
                  {item.icon}
                </span>
              ) : null}
              {withEyebrow(item.eyebrow, <p className={cx("text-body font-body font-medium", colors.primary)}>{itemHeading("FeatureGrid", item, LINK_FRAMES.plain, ground)}</p>, colors.secondary)}
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

