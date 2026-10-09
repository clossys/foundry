import { Children, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { SectionIntro, type SectionIntroEmphasis } from "./SectionIntro.js";
import type { SectionGround } from "./section-ground.js";

export type ContentSectionHeadingLevel = 2 | 3 | 4 | 5 | 6;

/** How the header group lines up: along the start edge (a body section), or centred (an opening or closing band). */
export type ContentSectionAlign = "start" | "center";

/** How the section lays out: one column, or text beside a visual. */
export type ContentSectionLayout = "stacked" | "split";

/** Which side of a `split` the visual sits on, from `tablet-lg` up. */
export type ContentSectionMediaSide = "end" | "start";

/**
 * The header group's scale. `section`: the section title step. `display`:
 * the display step and its wider rhythm, for a statement band whose header
 * is its content (no module, no media), so the band carries a moment of
 * scale instead of reading as a thin strip.
 */
export type ContentSectionEmphasis = SectionIntroEmphasis;

interface ContentSectionBaseProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
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
  /** The header group's scale (see `ContentSectionEmphasis`). Semantic level stays `headingLevel`. @default "section" */
  emphasis?: ContentSectionEmphasis;
  /** The ground the section sits on; selects the header group's ink. It paints no surface. @default "base" */
  ground?: SectionGround;
  /**
   * The module slot: one or more text modules (a `FeatureGrid`, a
   * `CardGrid`, a `Comparison`, a `TopicList`, an `OrderedStepSequence`, an
   * `Faq`, a `StatusList`, or a combination), each rendered without its own
   * heading region.
   */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** One column: header group, then the text module, then the visual. */
export interface ContentSectionStackedProps extends ContentSectionBaseProps {
  /** @default "stacked" */
  layout?: "stacked";
  /** How the header group lines up. Modules always take the full column. @default "start" */
  align?: ContentSectionAlign;
  /** Optional visual module (a `Specimen`, a `MediaFigure`), rendered after the text module. */
  media?: ReactNode;
  mediaSide?: undefined;
}

/**
 * Text beside a visual: the header group and text module share a 5/12
 * column, the visual takes the other 7/12. The ratio is fixed so every
 * split band on a page lines up on the same column.
 */
export interface ContentSectionSplitProps extends ContentSectionBaseProps {
  layout: "split";
  /** Required. The visual module for the 7/12 column. A split without a visual is a stacked section. */
  media: ReactNode;
  /** Which side the visual sits on from `tablet-lg` up. Reading order never changes. @default "end" */
  mediaSide?: ContentSectionMediaSide;
  align?: undefined;
}

export type ContentSectionProps = ContentSectionStackedProps | ContentSectionSplitProps;

/** One vertical step between the header group and the first module, and between modules. */
const MODULE_GAP = "gap-2xl tablet-lg:gap-3xl";

/**
 * One section anatomy for long-form marketing pages: a header group
 * (eyebrow = what, heading = why, description = how, then actions) followed
 * by a module slot (the content). A section without an eyebrow still
 * renders; by convention every section has one.
 *
 * Spacing is fixed here so sections cannot drift: the header group is a
 * `SectionIntro` at the `section` emphasis by default (the section-title
 * step at `leading-heading`, its own rhythm, the prose measure: the same
 * anatomy a `Hero` uses at the `display` emphasis; `emphasis="display"`
 * gives a statement band that step); the header group and each module
 * sit one step apart (`gap-2xl`, `gap-3xl` from `tablet-lg`); modules take
 * the full column. The
 * band around it (ground, padding, column) is the caller's `SectionFrame`.
 *
 * Unlike `SectionHeader` (settings scale, `text-h3`, a title row with
 * trailing actions) this is marketing scale (the section-title step); unlike
 * `MarketingChapter` it paints no band of its own, takes an eyebrow and
 * actions, and holds any number of modules. Renders a plain `<div>`; the
 * section's landmark, if any, is the caller's.
 *
 * Two layouts. `stacked` (the default) runs header group, text module and
 * then the optional `media` visual down one column. `split` puts the header
 * group and text module in a 5/12 column beside the visual's 7/12, `gap-x-4xl`
 * apart and vertically centred, from `tablet-lg` up; below that it stacks in
 * the same order. The DOM order is always header, text module, visual:
 * `mediaSide="start"` moves the visual with `col-start-*`/`row-start-1` only,
 * so the reading order never changes. A split without media throws a
 * `TypeError` (the types already forbid it): a text-only band is stacked.
 */
export function ContentSection({
  eyebrow,
  heading,
  description,
  actions,
  headingLevel = 2,
  emphasis,
  align,
  ground = "base",
  layout = "stacked",
  media,
  mediaSide,
  children,
  className,
  style,
  ...rest
}: ContentSectionProps) {
  const hasHeader = eyebrow !== undefined || heading !== undefined || description !== undefined || actions !== undefined;
  const hasModules = Children.toArray(children).length > 0;
  const hasMedia = media !== undefined && media !== null && media !== false;

  if (layout === "split") {
    if (!hasMedia) {
      throw new TypeError("ContentSection: a split layout needs media; use the stacked layout for a text-only section.");
    }
    const atStart = mediaSide === "start";
    return (
      <div
        {...rest}
        data-content-section=""
        data-layout="split"
        data-media-side={atStart ? "start" : "end"}
        className={cx(
          "grid w-full grid-cols-1 gap-y-2xl tablet-lg:grid-cols-12 tablet-lg:items-center tablet-lg:gap-x-4xl tablet-lg:gap-y-0",
          className,
        )}
        style={style}
      >
        <div
          data-content-section-text=""
          className={cx(
            "flex min-w-0 flex-col items-start tablet-lg:col-span-5",
            MODULE_GAP,
            atStart ? "tablet-lg:col-start-8 tablet-lg:row-start-1" : undefined,
          )}
        >
          {hasHeader ? (
            <SectionIntro
              data-content-section-header=""
              emphasis={emphasis}
              headingLevel={headingLevel}
              align="start"
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
        <div
          data-content-section-media=""
          className={cx(
            "min-w-0 tablet-lg:col-span-7",
            atStart ? "tablet-lg:col-start-1 tablet-lg:row-start-1" : undefined,
          )}
        >
          {media}
        </div>
      </div>
    );
  }

  const centred = align === "center";

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
          emphasis={emphasis}
          headingLevel={headingLevel}
          align={centred ? "center" : "start"}
          ground={ground}
          eyebrow={eyebrow}
          heading={heading}
          description={description}
          actions={actions}
        />
      ) : null}
      {hasModules || hasMedia ? (
        <div data-content-section-modules="" className={cx("flex w-full flex-col", MODULE_GAP)}>
          {children}
          {hasMedia ? (
            <div data-content-section-media="" className="w-full min-w-0">
              {media}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
