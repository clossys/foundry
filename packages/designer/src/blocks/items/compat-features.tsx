import { ItemHeading, ItemIcon, ItemDescription } from "./anatomy.js";
import type { FeatureGridProps, FeatureGridItem, FeatureGridTreatment, FeatureGridHeadingLevel } from "../FeatureGrid.js";
import type { ReactNode } from "react";
import { cx } from "../../atoms/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";
import { assertNoNestedInteractive, cardLinkContainerClassName, type CardLinkFrame } from "../stretched-link.js";
import { Items } from "./Items.js";
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

export function CompatFeatureGrid({
  eyebrow,
  heading,
  description,
  items,
  headingLevel,
  ground,
  columns,
  treatment,
  emphasis,
  className,
  style,
  ...rest
}: FeatureGridProps & { headingLevel: FeatureGridHeadingLevel; ground: SectionGround }) {
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
        <Items items={items} arrangement="columns" columns={columns} treatment={treatment} emphasis={emphasis} ground={ground} />
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
