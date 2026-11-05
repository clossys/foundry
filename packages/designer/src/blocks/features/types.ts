import type { ReactNode } from "react";
import type { FeatureGridItem, FeatureGridLayout, FeatureGridProps } from "../FeatureGrid.js";
import type { ItemSpan } from "../items/types.js";
import type { SectionGround } from "../section-ground.js";

/** Section runtime members extend the published three-layout FeatureGrid adapter. */
export type FeatureMemberLayout = "bento" | "tabs" | "alternating" | "scroll";
export type FeatureSectionLayout = FeatureGridLayout | FeatureMemberLayout;
export interface FeatureLayoutItem extends FeatureGridItem {
  visual?: ReactNode;
  span?: ItemSpan;
}
export type FeatureLayoutProps = Omit<FeatureGridProps, "items" | "layout"> & {
  items: readonly FeatureLayoutItem[];
  ground: SectionGround;
  layout: FeatureMemberLayout;
};
