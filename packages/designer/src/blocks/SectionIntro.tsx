import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { SemanticContent } from "../components/SemanticContent.js";
import { cx } from "../components/internal/cx.js";
import { SECTION_MEASURE_MAX, UI_WIDTH_HERO_WIDE } from "./internal/block-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

export type SectionIntroHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * How much the intro stands out. `display` is a page's opening (a `Hero`):
 * the largest heading step. `section` is everything after it (a body band,
 * a closing call to action): the section-title step.
 */
export type SectionIntroEmphasis = "display" | "section";

/** How the intro's lines line up: along the start edge, or centred on the column. */
export type SectionIntroAlign = "start" | "center";

export interface SectionIntroProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Small label above the heading. */
  eyebrow?: ReactNode;
  /** Accent label ink or the ground's secondary text ink. @default "accent" */
  eyebrowTone?: "accent" | "muted";
  /** Prose cap, or an uncapped headline with a wide body. @default "prose" */
  measure?: "prose" | "wide";
  /** Opt into the larger responsive display ramp. @default "default" */
  headingScale?: "default" | "display";
  /** The heading, at `headingLevel`. */
  heading?: ReactNode;
  /** Optional id on the real heading, for content named by it. */
  headingId?: string;
  /** A line of supporting copy under the heading. */
  description?: ReactNode;
  /**
   * Calls to action under the description, typically button-styled links
   * (`buttonLinkClassName`). The row carries the ground's primary ink, so an
   * `outline` button (which takes the surrounding ink) reads on every ground.
   */
  actions?: ReactNode;
  /**
   * Which heading element `heading` renders as. Semantic only: the size
   * comes from `emphasis`. Keep one `<h1>` per page (the opening).
   * @default 2
   */
  headingLevel?: SectionIntroHeadingLevel;
  /** The heading step and the rhythm around it. @default "section" */
  emphasis?: SectionIntroEmphasis;
  /** @default "start" */
  align?: SectionIntroAlign;
  /** The ground the intro sits on; selects its ink. It paints no surface. @default "base" */
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}

/**
 * The heading per emphasis. Each carries its own leading role (the `--text-*`
 * ramp is font-size only), tight so a wrapped heading reads as one block:
 * the display step is display-m on a phone and display-l from tablet at
 * `leading-display`; the section title runs h1, h0, display-m with the
 * viewport at `leading-heading`, always a step under the display heading.
 */
const HEADING_CLASSES: Record<SectionIntroEmphasis, string> = {
  display: "text-display-m tablet:text-display-l font-display leading-display text-balance",
  section: "text-h1 tablet:text-h0 tablet-lg:text-display-m font-display leading-heading text-balance",
};

/**
 * The eyebrow per ground: `text-body-s` medium, tracked uppercase, in the
 * brand's accent text ink (`accent-on-inverse` on an inverse band). The
 * eyebrow is where a page states its sections' topics, so it carries the
 * accent instead of a 12px muted caption that reads as chrome.
 */
const EYEBROW_CLASSES: Record<SectionGround, string> = {
  base: "text-body-s font-medium uppercase tracking-label text-accent-text",
  sunken: "text-body-s font-medium uppercase tracking-label text-accent-text",
  inverse: "text-body-s font-medium uppercase tracking-label text-accent-on-inverse",
};

/**
 * The vertical rhythm per emphasis: eyebrow to heading is the smallest step;
 * heading to description is clearly wider than the gap between the
 * heading's own wrapped lines (at least half the heading's size), so the
 * heading reads as one block and the description as the next; description
 * to actions is wider again. The lockup reads label, message, support,
 * action, and the steps scale with the emphasis.
 */
const RHYTHM_CLASSES: Record<SectionIntroEmphasis, { heading: string; description: string; actions: string }> = {
  display: { heading: "mt-sm", description: "mt-2xl", actions: "mt-3xl" },
  section: { heading: "mt-sm", description: "mt-xl", actions: "mt-2xl" },
};

/**
 * One intro anatomy for marketing sections, in this order: the eyebrow says
 * what the section is about, the heading why it matters, the description
 * how, then optional actions; the section's content module follows the
 * intro. Every prop is optional so nothing crashes, but by convention each
 * section after the opening carries an eyebrow (a section without one reads
 * as a continuation of the previous band). `Hero` (the
 * opening) and `ContentSection` (every band after it, including a closing
 * call to action) both compose it, so their type steps, rhythm and measure
 * come from one place; only `emphasis` and `headingLevel` differ.
 *
 * By default the lines stay within the prose measure (`--ui-width-prose-max`);
 * `measure="wide"` uncaps the headline and caps only the body at 64rem.
 * a centred intro sits in the middle of its column with a balanced heading
 * and a pretty-wrapped description. Renders a plain `<div>`.
 */
export function SectionIntro({
  eyebrow,
  eyebrowTone = "accent",
  measure = "prose",
  headingScale = "default",
  heading,
  headingId,
  description,
  actions,
  headingLevel = 2,
  emphasis = "section",
  align = "start",
  ground = "base",
  className,
  style,
  ...rest
}: SectionIntroProps) {
  const headingTag: `h${SectionIntroHeadingLevel}` = `h${headingLevel}`;
  const colors = SECTION_GROUND_CLASSES[ground];
  const centred = align === "center";
  const rhythm = RHYTHM_CLASSES[emphasis];
  const displayHeading = headingScale === "display";
  const hasEyebrow = Boolean(eyebrow);
  const hasHeading = Boolean(heading);
  const hasDescription = Boolean(description);

  return (
    <SemanticContent as="div"
      {...rest}
      data-section-intro={emphasis}
      className={cx("flex w-full flex-col", centred ? "mx-auto items-center text-center" : "items-start", className)}
      style={{ maxWidth: measure === "wide" ? "none" : SECTION_MEASURE_MAX.prose, ...style }}
    >
      {hasEyebrow ? (
        <SemanticContent as="p" className={eyebrowTone === "muted" ? cx("text-body-s font-medium uppercase tracking-label", colors.secondary) : EYEBROW_CLASSES[ground]}>
          {eyebrow}
        </SemanticContent>
      ) : null}
      {hasHeading ? (
        <SemanticContent as={headingTag}
          id={headingId}
          className={cx(
            displayHeading
              ? "text-display-m tablet:text-display-l tablet-lg:text-display-xl font-display leading-display text-balance"
              : HEADING_CLASSES[emphasis],
            colors.primary,
            hasEyebrow ? rhythm.heading : undefined,
          )}
        >
          {heading}
        </SemanticContent>
      ) : null}
      {hasDescription ? (
        <SemanticContent as="p"
          className={cx("text-body-l text-pretty", colors.secondary, hasEyebrow || hasHeading ? rhythm.description : undefined)}
          style={measure === "wide" ? { maxWidth: UI_WIDTH_HERO_WIDE } : undefined}
        >
          {description}
        </SemanticContent>
      ) : null}
      {actions ? (
        <SemanticContent as="div"
          data-section-intro-actions=""
          className={cx(
            "flex flex-wrap items-center gap-x-lg gap-y-sm",
            colors.primary,
            centred ? "justify-center" : undefined,
            hasEyebrow || hasHeading || hasDescription ? rhythm.actions : undefined,
          )}
        >
          {actions}
        </SemanticContent>
      ) : null}
    </SemanticContent>
  );
}
