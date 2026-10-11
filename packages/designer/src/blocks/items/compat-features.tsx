import { ItemHeading, ItemIcon, ItemDescription, ItemPlate } from "./anatomy.js";
import type { FeatureGridProps, FeatureGridItem, FeatureGridTreatment, FeatureGridHeadingLevel, FeatureGridColumns, FeatureGridEmphasis } from "../FeatureGrid.js";
import type { ReactNode } from "react";
import { cx } from "../../atoms/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";
import { assertNoNestedInteractive, cardLinkContainerClassName, type CardLinkFrame } from "../stretched-link.js";
import { Items } from "./Items.js";
import { assertItems, hasContent } from "./policies.js";
import type { ItemsProps } from "./types.js";
import { UI_BORDER_RULE } from "../../atoms/internal/ui-vars.js";
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

const LINK_FRAMES: Record<FeatureGridTreatment, CardLinkFrame> = {
  plain: "plain",
  rule: "rule",
  plate: "plate",
};

/** An item's heading content: its text, or the item's link carrying it. Asserts a linked item holds nothing else interactive. */
function itemHeading(block: string, item: FeatureGridItem, frame: CardLinkFrame, ground: SectionGround): ReactNode {
  if (item.href === undefined) return item.heading;
  assertNoNestedInteractive(block, item.id, [item.icon, item.eyebrow, item.heading, item.description]);
  return item.heading;
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

function LegacyCatalogGrid({ items, columns = 3, treatment = "plain", emphasis = "item", ground }: CatalogGridProps) {
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
              <ItemIcon className={cx("inline-flex", ICON_ACCENT_CLASSES[ground])}>
                {item.icon}
              </ItemIcon>
            ) : null}
            {withEyebrow(
              item.eyebrow,
              <ItemHeading as="p" href={item.href} heading={itemHeading("FeatureGrid", item, frame, ground)} variant={frame} ground={ground}
                className={cx(
                  statement ? "text-h1 font-display leading-heading text-balance" : "text-body-l font-body font-medium",
                  colors.primary,
                )}
              />,
              colors.secondary,
              true,
            )}
            {item.description ? (
              <ItemDescription className={cx(statement ? "text-body-l text-pretty" : "text-body text-pretty", colors.secondary)}>
                {item.description}
              </ItemDescription>
            ) : null}
          </>
        );

        if (treatment === "plate") {
          return (
            <ItemPlate
              key={item.id}
              ground={ground}
              data-feature-grid-item=""
              className={cx("flex h-full flex-col items-start gap-sm tablet:p-xl", linked, span)}
            >
              {body}
            </ItemPlate>
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

/** A temporary compatibility seam until all catalog consumers use canonical counts and slots. */
function refusesCanonicalCatalog(props: ItemsProps): boolean {
  try { assertItems(props); return false; }
  catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return true;
    throw error;
  }
}

export function CompatFeatureGrid({
  eyebrow,
  heading,
  description,
  items,
  headingLevel: requestedHeadingLevel,
  ground,
  columns,
  treatment,
  emphasis,
  className,
  style,
  ...rest
}: FeatureGridProps & { ground: SectionGround }) {
  const catalog = columns !== undefined || treatment !== undefined || emphasis !== undefined;
  const headingLevel = requestedHeadingLevel === undefined ? 2 : requestedHeadingLevel;
  const headlessCatalog = catalog && requestedHeadingLevel === undefined && !hasContent(heading);
  const canonicalProps: ItemsProps = { items, arrangement: "columns", columns: columns as ItemsProps["columns"], treatment, emphasis, ground, headingLevel: headingLevel >= 3 ? 4 : 3 };
  const legacyCatalog = catalog && (headlessCatalog || refusesCanonicalCatalog(canonicalProps));
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
        legacyCatalog ? <LegacyCatalogGrid items={items} columns={columns} treatment={treatment} emphasis={emphasis} ground={ground} /> : <Items {...canonicalProps} />
      ) : (
        <div className="grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className={item.href === undefined ? "flex flex-col items-start gap-sm" : cx("flex flex-col items-start gap-sm", linkedContainer)}>
              {item.icon ? (
                <ItemIcon className={colors.muted}>{item.icon}</ItemIcon>
              ) : null}
              {withEyebrow(item.eyebrow, <ItemHeading as="p" heading={itemHeading("FeatureGrid", item, LINK_FRAMES.plain, ground)} href={item.href} variant="plain" ground={ground} className={cx("text-body font-body font-medium", colors.primary)} />, colors.secondary)}
              {item.description ? (
                <ItemDescription className={cx("text-body-s", colors.secondary)}>{item.description}</ItemDescription>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
