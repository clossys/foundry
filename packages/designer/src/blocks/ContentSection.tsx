import { Children, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { SectionIntro } from "./SectionIntro.js";
import type { SectionGround } from "./section-ground.js";

export type ContentSectionHeadingLevel = 2 | 3 | 4 | 5 | 6;

/** How the header group lines up: along the start edge (a body section), or centred (an opening or closing band). */
export type ContentSectionAlign = "start" | "center";

export interface ContentSectionProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /**
   * Small label above the heading: what the section is about. Optional so
   * nothing crashes, but every section carries one by convention.
   */
  eyebrow?: ReactNode;
  /** The section's heading, at `headingLevel`: why it matters. */
  heading?: ReactNode;
  /** A line of supporting copy under the heading: how. */
  description?: ReactNode;
  /** The section's own actions, under the description (typically button-styled links). */
  actions?: ReactNode;
  /** Which heading element `heading` renders as. @default 2 */
  headingLevel?: ContentSectionHeadingLevel;
  /** How the header group lines up. Modules always take the full column. @default "start" */
  align?: ContentSectionAlign;
  /** The ground the section sits on; selects the header group's ink. It paints no surface. @default "base" */
  ground?: SectionGround;
  /**
   * The module slot: one or more content modules (a `FeatureGrid`, a
   * `StatusList`, an `OrderedStepSequence`, an `Faq`, a `MediaFigure`, or a
   * combination), each rendered without its own heading region.
   */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** One vertical step between the header group and the first module, and between modules. */
const MODULE_GAP = "gap-2xl tablet-lg:gap-3xl";

/**
 * One section anatomy for long-form marketing pages: a header group
 * (eyebrow = what, heading = why, description = how, then actions) followed
 * by a module slot (the content). A section without an eyebrow still
 * renders; by convention every section has one.
 *
 * Spacing is fixed here so sections cannot drift: the header group is a
 * `SectionIntro` at the `section` emphasis (the section-title step at
 * `leading-heading`, its own rhythm, the prose measure: the same anatomy a
 * `Hero` uses at the `display` emphasis); the header group and each module
 * sit one step apart (`gap-2xl`, `gap-3xl` from `tablet-lg`); modules take
 * the full column. The
 * band around it (ground, padding, column) is the caller's `SectionFrame`.
 *
 * Unlike `SectionHeader` (settings scale, `text-h3`, a title row with
 * trailing actions) this is marketing scale (the section-title step); unlike
 * `MarketingChapter` it paints no band of its own, takes an eyebrow and
 * actions, and holds any number of modules. Renders a plain `<div>`; the
 * section's landmark, if any, is the caller's.
 */
export function ContentSection({
  eyebrow,
  heading,
  description,
  actions,
  headingLevel = 2,
  align = "start",
  ground = "base",
  children,
  className,
  style,
  ...rest
}: ContentSectionProps) {
  const centred = align === "center";
  const hasHeader = eyebrow !== undefined || heading !== undefined || description !== undefined || actions !== undefined;
  const hasModules = Children.toArray(children).length > 0;

  return (
    <div
      {...rest}
      data-content-section=""
      className={cx("flex w-full flex-col", MODULE_GAP, centred ? "items-center" : "items-start", className)}
      style={style}
    >
      {hasHeader ? (
        <SectionIntro
          data-content-section-header=""
          emphasis="section"
          headingLevel={headingLevel}
          align={align}
          ground={ground}
          eyebrow={eyebrow}
          heading={heading}
          description={description}
          actions={actions}
        />
      ) : null}
      {hasModules ? (
        <div data-content-section-modules="" className={cx("flex w-full flex-col", MODULE_GAP)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
