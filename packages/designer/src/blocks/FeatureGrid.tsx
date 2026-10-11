import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { SectionGround } from "./section-ground.js";
import { CompatFeatureGrid } from "./items/compat-features.js";

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

/** Canonical grids use two or three columns; four retains existing catalog compatibility. */
export type FeatureGridColumns = 2 | 3 | 4;

/**
 * How each item is set apart: `plain` (type on the ground), `rule` (a token-width
 * `line-strong` rule above each item), or `plate` (each item on a `Card`
 * plate, the other ground).
 */
export type FeatureGridTreatment = "plain" | "rule" | "plate";

/** `item`: the item heading at body scale. `statement`: the item heading in the display font at `text-h2`, for a few principles. */
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
   * grid unchanged, including its original item counts.
   */
  columns?: FeatureGridColumns;
  /** @default "plain" (catalog layout only) */
  treatment?: FeatureGridTreatment;
  /** @default "item" (catalog layout only) */
  emphasis?: FeatureGridEmphasis;
  className?: string;
  style?: CSSProperties;
}

/** Published default markup stays unchanged; accepted catalog inputs use canonical Items, with a temporary legacy fallback. */
export function FeatureGrid({ ground = "base", ...props }: FeatureGridProps) { return <CompatFeatureGrid {...props} ground={ground} />; }
