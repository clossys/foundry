import { SectionHeader } from "../SectionHeader.js";
import { ItemHeading, ItemIcon, ItemDescription } from "./anatomy.js";
import type { FeatureGridProps } from "../FeatureGrid.js";
import { cx } from "../../components/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";

/** The published feature shell preserves its historical presence and truthiness. */
export function CompatFeatureGrid({ eyebrow, heading, description, items, headingLevel = 2, ground, className, style, ...rest }: FeatureGridProps & { ground: SectionGround }) {
  const colors = SECTION_GROUND_CLASSES[ground];
  const hasHeadingRegion = eyebrow !== undefined || heading !== undefined || description !== undefined;
  return (
    <div {...rest} className={cx("flex flex-col gap-lg", colors.surface, className)} style={style}>
      {hasHeadingRegion ? (
        <SectionHeader density="standard" level={headingLevel} ground={ground} eyebrow={eyebrow} description={description} {...(heading ? { title: heading } : {})} />
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
