import { SectionHeader } from "../SectionHeader.js";
import { ItemHeading, ItemIcon, ItemDescription } from "./anatomy.js";
import type { FeatureGridLayout, FeatureGridProps } from "../FeatureGrid.js";
import { cx } from "../../components/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";
import { componentLeaf } from "../../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/**
 * Per-layout class policy. `grid` is the published markup, unchanged. `split`
 * only takes its two-region root when a heading region exists to sit beside
 * the features.
 */
const FEATURE_LAYOUT_CLASSES = {
  grid: { split: "", items: "grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3" },
  list: { split: "", items: "grid grid-cols-1 gap-lg" },
  split: { split: "desktop:grid desktop:grid-cols-2 desktop:items-start desktop:gap-2xl", items: "grid grid-cols-1 gap-lg tablet:grid-cols-2" },
} as const satisfies Readonly<Record<FeatureGridLayout, { split: string; items: string }>>;

/** The published feature shell preserves its historical presence and truthiness. */
export function CompatFeatureGrid({ eyebrow, heading, description, items, headingLevel = 2, ground, layout = "grid", className, style, ...rest }: FeatureGridProps & { ground: SectionGround }) {
  const colors = SECTION_GROUND_CLASSES[ground];
  const hasHeadingRegion = eyebrow !== undefined || heading !== undefined || description !== undefined;
  const policy = FEATURE_LAYOUT_CLASSES[layout];
  return (
    <SemanticContent as="div" {...rest} className={cx("flex flex-col gap-lg", hasHeadingRegion ? policy.split : undefined, colors.surface, className)} style={style}>
      {hasHeadingRegion ? (
        <SectionHeader density="standard" level={headingLevel} ground={ground} eyebrow={eyebrow} description={description} {...(heading ? { title: heading } : {})} />
      ) : null}
      <SemanticContent as="div" className={policy.items}>
        {items.map(item => {
          const icon = item.icon ? <ItemIcon className={colors.muted}>{item.icon}</ItemIcon> : null;
          const title = <ItemHeading as="p" heading={item.heading} variant="plain" ground={ground} className={cx("text-body font-body font-medium", colors.primary)} />;
          const body = item.description ? <ItemDescription className={cx("text-body-s", colors.secondary)}>{item.description}</ItemDescription> : null;
          // A list row sets the icon beside the copy; grid and split cells keep the published three child slots.
          return layout === "list"
            ? <SemanticContent as="div" key={item.id} className="flex items-start gap-md">{icon}<SemanticContent as="div" className="flex min-w-0 flex-col gap-sm">{title}{body}</SemanticContent></SemanticContent>
            : <SemanticContent as="div" key={item.id} className="flex flex-col items-start gap-sm">{icon}{title}{body}</SemanticContent>;
        })}
      </SemanticContent>
    </SemanticContent>
  );
}
