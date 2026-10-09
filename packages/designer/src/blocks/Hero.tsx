import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { DISPLAY_HEADING_CLASS, SECTION_MEASURE_MAX } from "./internal/block-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

/**
 * `class-scan.ts` skips `blocks/internal/` (where `DISPLAY_HEADING_CLASS`
 * lives). This literal keeps `text-display-l` in the compiled.css candidate
 * set so display headings stay styled on the tokens.css + compiled.css path.
 */
const COMPILED_CSS_CLASS_SCAN_ANCHOR = "text-display-l";
void COMPILED_CSS_CLASS_SCAN_ANCHOR;

export type HeroHeadingLevel = 1 | 2;

/** How the hero's text lines up: along the start edge, or centred on the column. */
export type HeroAlign = "start" | "center";

/** Layout composition when `media` is present — media presence is not a layout. */
export type HeroComposition = "editorial" | "split";

export interface HeroProps extends HTMLAttributes<HTMLElement> {
  /** Small label above the heading ("New", a category name). */
  eyebrow?: ReactNode;
  /** The hero's own message. The only required prop. */
  heading: ReactNode;
  /** A line of supporting copy under the heading. */
  description?: ReactNode;
  /**
   * Slot for the hero's calls to action — typically one or more `Button`
   * atoms. Rendered below the description.
   */
  actions?: ReactNode;
  /**
   * Slot for a visual companion to the text content — a screenshot, an
   * illustration, an embedded video. Omit for a text-and-CTA-only hero.
   * Passing `media` does not choose a layout — set `composition` explicitly.
   */
  media?: ReactNode;
  /**
   * Named layout when `media` is set. `editorial` stacks art in document
   * order (default for public marketing). `split` is the opt-in two-column
   * product-shot layout.
   * @default "editorial"
   */
  composition?: HeroComposition;
  /**
   * Which heading element `heading` renders as (`<h1>` or `<h2>`) — real
   * and settable, the same reasoning `SectionHeader`'s own `level` prop
   * documents. `Hero` defaults to `1`: on a marketing page it typically
   * IS the page's own top-of-content heading (no separate `PageHeader`
   * above it). A page that already has its own `<h1>` elsewhere (or a
   * second, later `Hero`-shaped section further down a long page — see
   * this package's README, "Placement rules", test 3: a page can
   * reasonably show two of these) needs `headingLevel={2}` instead, so the
   * document outline stays unbroken.
   * @default 1
   */
  headingLevel?: HeroHeadingLevel;
  /** Semantic section ground; selects the complete matching surface and foreground policy. @default "base" */
  ground?: SectionGround;
  /**
   * How the eyebrow, heading, description and actions line up. `"center"`
   * centres each line and the actions row on the hero's column (an opening
   * hero over a backdrop, a closing call to action), and narrows the text
   * block to the prose measure (`--ui-width-prose-max`) with a balanced
   * heading and a pretty-wrapped description, so a centred lockup wraps
   * sooner than the column it sits in. It applies to the text block only; a
   * `split` composition keeps its two columns.
   * @default "start"
   */
  align?: HeroAlign;
  className?: string;
  style?: CSSProperties;
}

/**
 * A page's primary above-the-fold message: an optional eyebrow, a heading,
 * an optional description, and an optional row of calls to action — the
 * same title/description/actions shape `PageHeader` gives an application
 * page, sized and composed for a marketing/content page instead.
 */
export function Hero({
  eyebrow,
  heading,
  description,
  actions,
  media,
  composition = "editorial",
  headingLevel = 1,
  ground = "base",
  align = "start",
  className,
  style,
  ...rest
}: HeroProps) {
  const HeadingTag = headingLevel === 1 ? "h1" : "h2";
  const colors = SECTION_GROUND_CLASSES[ground];
  const splitLayout = Boolean(media) && composition === "split";
  const centred = align === "center";

  const content = (
    <div
      className={centred ? "mx-auto flex w-full flex-col items-center gap-md text-center" : "flex flex-col items-start gap-md"}
      style={centred ? { maxWidth: SECTION_MEASURE_MAX.prose } : undefined}
    >
      {eyebrow ? (
        <p className={cx("text-caption uppercase tracking-label", colors.muted)}>{eyebrow}</p>
      ) : null}
      <HeadingTag className={cx(DISPLAY_HEADING_CLASS, colors.primary, centred ? "text-balance" : undefined)}>{heading}</HeadingTag>
      {description ? (
        <p className={cx("text-body-l max-w-display", colors.secondary, centred ? "text-pretty" : undefined)}>{description}</p>
      ) : null}
      {actions ? (
        <div className={centred ? "flex flex-wrap items-center justify-center gap-sm" : "flex flex-wrap items-center gap-sm"}>{actions}</div>
      ) : null}
    </div>
  );

  return (
    <section
      {...rest}
      className={cx(
        colors.surface,
        splitLayout
          ? "grid grid-cols-1 items-center gap-xl tablet:grid-cols-2"
          : "flex flex-col gap-xl",
        className,
      )}
      style={style}
    >
      {content}
      {media ? <div className={cx("w-full", splitLayout ? "" : "max-w-display", centred && !splitLayout ? "mx-auto" : "")}>{media}</div> : null}
    </section>
  );
}
