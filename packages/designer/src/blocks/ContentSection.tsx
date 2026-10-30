import { Children, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { UI_BORDER_HAIRLINE } from "../components/internal/ui-vars.js";
import { SECTION_MEASURE_MAX } from "./internal/block-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { SectionIntro, type SectionIntroEmphasis } from "./SectionIntro.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.content", "foundry/sections.content");

export type ContentSectionHeadingLevel = 2 | 3 | 4 | 5 | 6;

/** How the header group lines up: along the start edge (a body section), or centred (an opening or closing band). */
export type ContentSectionAlign = "start" | "center";

/** One column, or a companion on the start/end side. `split` is a supported media-based alias. */
export type ContentSectionLayout = "stacked" | "split-start" | "split-end" | "split";

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
  /** Optional id on the real heading, for content named by it. */
  headingId?: string;
  /** A line of supporting copy under the heading: how. */
  description?: ReactNode;
  /**
   * The section's own actions, under the description: one or two
   * button-styled links (`buttonLinkClassName`), at most one `primary` and
   * the rest `outline`. An action closes what it follows, so where actions
   * go depends on the shape:
   * - A stacked section with modules or media after its header takes none,
   *   neither under the header nor after the modules: link the module's
   *   items (`href` on an `Item`, `Items` collection or
   *   `OrderedStepSequence` item), or put one link in the footnote.
   * - A header-only stacked section (a statement or frame band) takes them
   *   directly after its description, as its last element.
   * - A header-only section with actions takes no footnote: nothing follows
   *   an action, so fold the footnote's sentence into the description.
   * - A split takes them in its text column, after the description and
   *   before any text module, never under the visual.
   * The component renders what it is given; the Publisher contract refuses
   * the shapes above.
   */
  actions?: ReactNode;
  /**
   * An optional footnote: one short sentence after the body and takeaway in the
   * small step and the ground's secondary ink, for an aside (a contact
   * address, a policy pointer) that is not the band's next step. It may hold
   * at most one inline link, the only place a section body takes the
   * underlined link look. Stacked: after the modules and media, aligned like
   * the header. Split: at the end of the text column, never under the visual.
   */
  footnote?: ReactNode;
  /** Optional conclusion after the body, spanning the band with an accent start rule. */
  takeaway?: ReactNode;
  /** Optional authored attribution after the footnote, in the same column. */
  source?: ReactNode;
  /** Which heading element `heading` renders as. @default 2 */
  headingLevel?: ContentSectionHeadingLevel;
  /** The header group's scale (see `ContentSectionEmphasis`). Semantic level stays `headingLevel`. @default "section" */
  emphasis?: ContentSectionEmphasis;
  /**
   * Owns the frame's vertical padding and header scale when supplied.
   * Omit while an outer frame owns the padding: existing callers keep
   * their spacing and `emphasis`. Compact and standard use section scale;
   * display uses display scale. Spacing changes at tablet and desktop.
   */
  size?: "compact" | "standard" | "display";
  /** The ground the section sits on; selects the header group's ink. It paints no surface. @default "base" */
  ground?: SectionGround;
  /**
   * The module slot: one or more text modules (a `FeatureGrid`, a
   * `Items`, a `Matrix`, an `OrderedStepSequence`, an
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
export type ContentSectionSplitProps = ContentSectionBaseProps & { align?: undefined } & (
  | {
      layout: "split-start" | "split-end";
      /** The companion visual; otherwise children take its column, or the header splits. */
      media?: ReactNode;
      mediaSide?: undefined;
    }
  | {
      /** Supported media-based alias; `mediaSide` selects the visual side. */
      layout: "split";
      media: ReactNode;
      mediaSide?: ContentSectionMediaSide;
    }
);

export type ContentSectionProps = ContentSectionStackedProps | ContentSectionSplitProps;

/** One vertical step between the header group and the first module, and between modules. */
const MODULE_GAP = "gap-2xl tablet-lg:gap-3xl";

const TAKEAWAY_RULE_CLASSES: Record<SectionGround, string> = {
  base: "border-s-accent",
  sunken: "border-s-accent",
  inverse: "border-s-accent-on-inverse",
};

const SIZE_PADDING_CLASSES: Record<NonNullable<ContentSectionProps["size"]>, string> = {
  compact: "py-3xl tablet:py-4xl desktop:py-5xl",
  standard: "py-4xl tablet:py-5xl desktop:py-6xl",
  display: "py-5xl tablet:py-6xl desktop:py-frame-display",
};

function hasContent(node: ReactNode): boolean {
  return Children.toArray(node).some((child) => child !== "");
}

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
 * band around it (ground and column) is the caller's `SectionFrame`.
 * An explicit `size` owns vertical padding; omitted size preserves the
 * outer frame's padding.
 *
 * Unlike `SectionHeader` (settings scale, `text-h3`, a title row with
 * trailing actions) this is marketing scale (the section-title step); unlike
 * `MarketingChapter` it paints no band of its own, takes an eyebrow and
 * actions, and holds any number of modules. Renders a plain `<div>`; the
 * section's landmark, if any, is the caller's.
 *
 * `stacked` (the default) runs header group, text module and
 * then the optional `media` visual down one column. A split puts the header
 * group and text module in a 5/12 column beside the visual's 7/12, `gap-x-4xl`
 * apart and vertically centred, from `tablet-lg` up; below that it stacks in
 * the same order. The DOM order is always header, text module, visual:
 * `split-start` moves the companion with `col-start-*`/`row-start-1` only,
 * so the reading order never changes. Without media, children occupy the
 * companion column. Without either, the eyebrow and heading keep the 5/12
 * column while description, actions and footnote occupy the 7/12 column.
 * The supported `split`/`mediaSide` aliases render media beside the header
 * and module, and require media.
 *
 * An optional `takeaway` follows the body across the full band. The
 * `footnote` and `source` follow in the footnote column. Without either new
 * slot, the footnote keeps its existing placement and markup.
 */
export function ContentSection({
  eyebrow,
  heading,
  headingId,
  description,
  actions,
  footnote,
  takeaway,
  source,
  headingLevel = 2,
  emphasis,
  size,
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
  const padding = size === undefined ? undefined : SIZE_PADDING_CLASSES[size];
  const footnoteCentred = align === "center";
  const footnoteNode =
    footnote === undefined || footnote === null || footnote === false ? null : (
      <SemanticContent as="p"
        data-content-section-footnote=""
        className={cx("text-body-s text-pretty", SECTION_GROUND_CLASSES[ground].secondary, footnoteCentred ? "text-center" : undefined)}
        style={{ maxWidth: SECTION_MEASURE_MAX.prose }}
      >
        {footnote}
      </SemanticContent>
    );

  const hasTakeaway = hasContent(takeaway);
  const hasSource = hasContent(source);
  const hasClosing = hasTakeaway || hasSource;
  const inlineFootnoteNode = hasClosing ? null : footnoteNode;
  const takeawayNode = hasTakeaway ? (
    <SemanticContent as="div"
      data-content-section-takeaway=""
      className={cx("w-full min-w-0 wrap-anywhere border-s ps-lg text-body-l font-semibold", SECTION_GROUND_CLASSES[ground].primary, TAKEAWAY_RULE_CLASSES[ground])}
      style={{ borderInlineStartWidth: UI_BORDER_HAIRLINE }}
    >
      {takeaway}
    </SemanticContent>
  ) : null;
  const sourceNode = hasSource ? (
    <SemanticContent as="div"
      data-content-section-source=""
      className={cx("text-caption wrap-anywhere", SECTION_GROUND_CLASSES[ground].secondary, footnoteCentred ? "text-center" : undefined)}
      style={{ maxWidth: SECTION_MEASURE_MAX.prose }}
    >
      {source}
    </SemanticContent>
  ) : null;
  const closingNode = (notesColumn?: string) => {
    const notes = footnoteNode || sourceNode ? (
      <SemanticContent as="div" data-content-section-notes="" className={cx("flex min-w-0 flex-col gap-sm", notesColumn, footnoteCentred ? "items-center" : undefined)}>
        {footnoteNode}
        {sourceNode}
      </SemanticContent>
    ) : null;
    return (
      <SemanticContent as="div" data-content-section-closing="" className={cx("flex w-full min-w-0 flex-col", MODULE_GAP, notesColumn ? "tablet-lg:col-span-12" : undefined)}>
        {takeawayNode}
        {notes ? notesColumn ? <SemanticContent as="div" className="grid w-full min-w-0 grid-cols-1 tablet-lg:grid-cols-12 tablet-lg:gap-x-4xl">{notes}</SemanticContent> : notes : null}
      </SemanticContent>
    );
  };

  if (layout === "split-start" || layout === "split-end") {
    const atStart = layout === "split-start";
    if (!hasMedia) {
      const headerSplit = !hasContent(children);
      const hasSupportIntro = hasContent(description) || hasContent(actions);
      const hasCompanion = !headerSplit || hasSupportIntro || (!hasClosing && hasContent(footnote));
      return (
        <SemanticContent as="div"
          {...SECTION_STAMP} {...rest}
          data-content-section=""
          data-layout={layout}
          className={cx("grid w-full grid-cols-1 gap-y-2xl tablet-lg:grid-cols-12 tablet-lg:items-start tablet-lg:gap-x-4xl", hasClosing ? "tablet-lg:gap-y-3xl" : "tablet-lg:gap-y-0", padding, className)}
          style={style}
        >
          <SemanticContent as="div"
            data-content-section-text=""
            className={cx("flex min-w-0 flex-col items-start tablet-lg:col-span-5", MODULE_GAP, atStart ? "tablet-lg:col-start-8 tablet-lg:row-start-1" : undefined)}
          >
            {hasHeader ? (
              <SectionIntro
                data-content-section-header=""
                emphasis={size === undefined ? emphasis : size === "display" ? "display" : "section"}
                headingLevel={headingLevel}
                ground={ground}
                eyebrow={eyebrow}
                heading={heading}
                headingId={headingId}
                description={headerSplit ? undefined : description}
                actions={headerSplit ? undefined : actions}
              />
            ) : null}
            {headerSplit ? null : inlineFootnoteNode}
          </SemanticContent>
          {hasCompanion ? <SemanticContent as="div"
            {...(headerSplit ? { "data-content-section-support": "" } : { "data-content-section-modules": "" })}
            className={cx("flex min-w-0 flex-col tablet-lg:col-span-7", headerSplit ? "items-start" : "items-stretch", MODULE_GAP, atStart ? "tablet-lg:col-start-1 tablet-lg:row-start-1" : undefined)}
          >
            {headerSplit ? (
              <>
                {hasSupportIntro ? (
                  <SectionIntro
                    emphasis={size === undefined ? emphasis : size === "display" ? "display" : "section"}
                    ground={ground}
                    // SectionIntro uses truthiness; the fragment preserves an authored numeric zero.
                    description={description === 0 ? <>{description}</> : description}
                    actions={actions === 0 ? <>{actions}</> : actions}
                  />
                ) : null}
                {inlineFootnoteNode}
              </>
            ) : children}
          </SemanticContent> : null}
          {hasClosing ? closingNode(cx(headerSplit
            ? atStart ? "tablet-lg:col-span-7 tablet-lg:col-start-1" : "tablet-lg:col-span-7 tablet-lg:col-start-6"
            : atStart ? "tablet-lg:col-span-5 tablet-lg:col-start-8" : "tablet-lg:col-span-5 tablet-lg:col-start-1")) : null}
        </SemanticContent>
      );
    }
  }

  if (layout === "split" || layout === "split-start" || layout === "split-end") {
    if (!hasMedia) {
      throw new TypeError("ContentSection: a split layout needs media; use the stacked layout for a text-only section.");
    }
    const atStart = layout === "split-start" || layout === "split" && mediaSide === "start";
    return (
      <SemanticContent as="div"
        {...SECTION_STAMP} {...rest}
        data-content-section=""
        data-layout={layout === "split-start" ? "split-start" : layout === "split-end" ? "split-end" : "split"}
        data-media-side={layout === "split" ? atStart ? "start" : "end" : undefined}
        className={cx(
          "grid w-full grid-cols-1 gap-y-2xl tablet-lg:grid-cols-12 tablet-lg:items-center tablet-lg:gap-x-4xl",
          hasClosing ? "tablet-lg:gap-y-3xl" : "tablet-lg:gap-y-0",
          padding,
          className,
        )}
        style={style}
      >
        <SemanticContent as="div"
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
              emphasis={size === undefined ? emphasis : size === "display" ? "display" : "section"}
              headingLevel={headingLevel}
              align="start"
              ground={ground}
              eyebrow={eyebrow}
              heading={heading}
              headingId={headingId}
              description={description}
              actions={actions}
            />
          ) : null}
          {hasModules ? (
            <SemanticContent as="div" data-content-section-modules="" className={cx("flex w-full flex-col", MODULE_GAP)}>
              {children}
            </SemanticContent>
          ) : null}
          {inlineFootnoteNode}
        </SemanticContent>
        <SemanticContent as="div"
          data-content-section-media=""
          className={cx(
            "min-w-0 tablet-lg:col-span-7",
            atStart ? "tablet-lg:col-start-1 tablet-lg:row-start-1" : undefined,
          )}
        >
          {media}
        </SemanticContent>
        {hasClosing ? closingNode(cx(atStart ? "tablet-lg:col-span-5 tablet-lg:col-start-8" : "tablet-lg:col-span-5 tablet-lg:col-start-1")) : null}
      </SemanticContent>
    );
  }

  const centred = align === "center";

  return (
    <SemanticContent as="div"
      {...SECTION_STAMP} {...rest}
      data-content-section=""
      className={cx("flex w-full flex-col", MODULE_GAP, centred ? "items-center" : "items-start", padding, className)}
      style={style}
    >
      {hasHeader ? (
        <SectionIntro
          data-content-section-header=""
          emphasis={size === undefined ? emphasis : size === "display" ? "display" : "section"}
          headingLevel={headingLevel}
          align={centred ? "center" : "start"}
          ground={ground}
          eyebrow={eyebrow}
          heading={heading}
          headingId={headingId}
          description={description}
          actions={actions}
        />
      ) : null}
      {hasModules || hasMedia ? (
        <SemanticContent as="div" data-content-section-modules="" className={cx("flex w-full flex-col", MODULE_GAP)}>
          {children}
          {hasMedia ? (
            <SemanticContent as="div" data-content-section-media="" className="w-full min-w-0">
              {media}
            </SemanticContent>
          ) : null}
        </SemanticContent>
      ) : null}
      {hasClosing ? closingNode() : footnoteNode}
    </SemanticContent>
  );
}
