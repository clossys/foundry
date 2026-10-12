import { ItemHeading, ItemIcon, ItemDescription } from "./anatomy.js";
import type { FeatureGridProps, FeatureGridHeadingLevel } from "../FeatureGrid.js";
import { cx } from "../../atoms/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";

/** The published feature shell preserves its historical presence and truthiness. */
export function CompatFeatureGrid({ eyebrow, heading, description, items, headingLevel = 2, ground, className, style, ...rest }: FeatureGridProps & { ground: SectionGround }) {
  const HeadingTag = `h${headingLevel}` as `h${FeatureGridHeadingLevel}`;
  const colors = SECTION_GROUND_CLASSES[ground];
  const hasHeadingRegion = eyebrow !== undefined || heading !== undefined || description !== undefined;
  return (
    <div {...rest} className={cx("flex flex-col gap-lg", colors.surface, className)} style={style}>
      {hasHeadingRegion ? (
        <div className="flex flex-col gap-xs">
          {eyebrow ? <p className={cx("text-caption uppercase tracking-label", colors.muted)}>{eyebrow}</p> : null}
          {heading ? <HeadingTag className={cx("text-h2 font-display", colors.primary)}>{heading}</HeadingTag> : null}
          {description ? <p className={cx("text-body", colors.secondary)}>{description}</p> : null}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3">
        {items.map(item => (
          <div key={item.id} className="flex flex-col items-start gap-sm">
            {item.icon ? <ItemIcon className={colors.muted}>{item.icon}</ItemIcon> : null}
            <ItemHeading as="p" heading={item.heading} variant="plain" ground={ground} className={cx("text-body font-body font-medium", colors.primary)} />
            {item.description ? <ItemDescription className={cx("text-body-s", colors.secondary)}>{item.description}</ItemDescription> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
