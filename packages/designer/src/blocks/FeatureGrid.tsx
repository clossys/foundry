import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { FeatureSurface } from "./features/FeatureSurface.js";
import type { SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.features", "foundry/sections.features");

export type FeatureGridHeadingLevel = 2 | 3 | 4 | 5 | 6;
/** How the features are laid out: the responsive grid, one feature per row, or the heading region beside the grid. */
export type FeatureGridLayout = "grid" | "list" | "split";

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
   * `grid` is the published responsive grid (one, two, then three columns).
   * `list` puts one feature per row, its icon beside the heading and copy.
   * `split` sets the heading region beside a two-column feature grid from
   * desktop; with no heading region the grid keeps the full width.
   * @default "grid"
   */
  layout?: FeatureGridLayout;
  className?: string;
  style?: CSSProperties;
}

/** Published feature copy keeps its original count, heading and presence policy. */
export function FeatureGrid({ ground = "base", ...props }: FeatureGridProps) { return FeatureSurface({ mode: "public", props: { ...SECTION_STAMP, ...props, ground } }); }
