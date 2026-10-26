import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { SectionIntro, type SectionIntroProps } from "./SectionIntro.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

export type HeroHeadingLevel = 1 | 2;

/** How the hero's text lines up: along the start edge, or centred on the column. */
export type HeroAlign = "start" | "center";

/** Layout composition when `media` is present — media presence is not a layout. */
export type HeroComposition = "editorial" | "split";

export interface HeroProps extends HTMLAttributes<HTMLElement> {
  /** Small label above the heading ("New", a category name). */
  eyebrow?: ReactNode;
  /** Intro label ink. @default "accent" */
  eyebrowTone?: SectionIntroProps["eyebrowTone"];
  /** Intro headline/body measure. @default "prose" */
  measure?: SectionIntroProps["measure"];
  /** Intro type ramp. @default "default" */
  headingScale?: SectionIntroProps["headingScale"];
  /** The hero's own message. The only required prop. */
  heading: ReactNode;
  /** A line of supporting copy under the heading. */
  description?: ReactNode;
  /**
   * Slot for the hero's calls to action — typically one or more `Button`
   * components. Rendered below the description.
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
  /** Heading scale; `default` is a supported alias for `display`. @default "display" */
  size?: "display" | "compact" | "default";
  /** Semantic section ground; selects the complete matching surface and foreground policy. @default "base" */
  ground?: SectionGround;
  /**
   * How the eyebrow, heading, description and actions line up. `"center"`
   * centres each line and the actions row on the hero's column (an opening
   * hero over a backdrop). The text block is a `SectionIntro` at the
   * `display` emphasis, so it keeps to the prose measure with a balanced
   * heading either way. It applies to the text block only; a `split`
   * composition keeps its two columns.
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
 * page, sized and composed for a marketing/content page instead. The copy is
 * a `SectionIntro` at the `display` emphasis, the same anatomy every later
 * section uses at the `section` emphasis; `Hero` adds the ground and media.
 */
export function Hero({
  eyebrow,
  eyebrowTone,
  measure,
  headingScale,
  heading,
  description,
  actions,
  media,
  composition = "editorial",
  headingLevel = 1,
  size = "display",
  ground = "base",
  align = "start",
  className,
  style,
  ...rest
}: HeroProps) {
  const colors = SECTION_GROUND_CLASSES[ground];
  const splitLayout = Boolean(media) && composition === "split";
  const centred = align === "center";

  const content = (
    <SectionIntro
      emphasis={size === "compact" ? "section" : "display"}
      headingLevel={headingLevel}
      align={align}
      ground={ground}
      eyebrow={eyebrow}
      eyebrowTone={eyebrowTone}
      measure={measure}
      headingScale={headingScale}
      heading={<>{heading}</>}
      description={description}
      actions={actions}
    />
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
