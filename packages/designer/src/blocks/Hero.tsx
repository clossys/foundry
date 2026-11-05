import type { MediaPlayer as MediaPlayerComponent } from "../components/media-player/media-player.js";
import type { Mode, Resolved } from "../catalog-core/types.js";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { SemanticContent as SemanticContentComponent } from "../components/SemanticContent.js";
import { componentLeaf } from "../runtime/component-leaf.js";
import { cx } from "../components/internal/cx.js";
import type { SectionIntroProps } from "./SectionIntro.js";
import { HeroIntro } from "./hero/HeroIntro.js";
import { StillBackdrop, HERO_SCRIM_PASSES, type HeroBackdropScrim } from "./hero/StillBackdrop.js";
import { resolveHeroBackdrop, type HeroBackdrop } from "./hero/hero-backdrop.js";
export type { HeroBackdrop, HeroBackdropKind, HeroImageBackdrop, HeroVideoBackdrop, HeroGraphicBackdrop } from "./hero/hero-backdrop.js";
export type { HeroBackdropScrim } from "./hero/StillBackdrop.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
const MediaPlayer = componentLeaf<typeof MediaPlayerComponent>("components.media-player");
const SemanticContent = componentLeaf<typeof SemanticContentComponent>("components.semantic-content");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.hero", "foundry/sections.hero");

export type HeroHeadingLevel = 1 | 2;

/** How the hero's text lines up: along the start edge, or centred on the column. */
export type HeroAlign = "start" | "center";

/** Layout composition when `media` is present — media presence is not a layout. */
export type HeroComposition = "editorial" | "split" | "full-bleed";

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
  /** Declared none, image, video or Assets graphic; existing checked still art stays valid. */
  backdrop?: HeroBackdrop;
  backdropValues?: Resolved;
  backdropMode?: Mode;
  /** Scalar protection over the media-scrim gradient. @default "light" */
  backdropScrim?: HeroBackdropScrim;
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
  backdrop,
  backdropValues,
  backdropMode = "light",
  backdropScrim = "light",
  composition = "editorial",
  headingLevel = 1,
  size = "display",
  ground = "base",
  align = "start",
  className,
  style,
  ...rest
}: HeroProps) {
  const resolvedBackdrop = resolveHeroBackdrop(backdrop, backdropValues, backdropMode);
  const hasBackdropArt = Boolean(resolvedBackdrop.art || resolvedBackdrop.graphic);
  const colors = SECTION_GROUND_CLASSES[ground];
  const splitLayout = Boolean(media) && composition === "split";
  const centred = align === "center";

  const content = (
    <HeroIntro
      backdropInk={hasBackdropArt}
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
    <SemanticContent as="section"
      {...SECTION_STAMP} {...rest}
      className={cx(
        colors.surface,
        hasBackdropArt ? "relative isolate overflow-hidden" : undefined,
        composition === "full-bleed" ? "w-full" : undefined,
        splitLayout
          ? "grid grid-cols-1 items-center gap-xl tablet:grid-cols-2"
          : "flex flex-col gap-xl",
        className,
      )}
      style={style}
      data-hero-backdrop-kind={resolvedBackdrop.kind}
    >
      {resolvedBackdrop.art ? <StillBackdrop art={resolvedBackdrop.art} scrim={backdropScrim} /> : null}
      {resolvedBackdrop.video || resolvedBackdrop.graphic ? <SemanticContent as="div" data-hero-live-backdrop="" aria-hidden="true" className="absolute inset-0" style={{ pointerEvents: "none", ...resolvedBackdrop.graphic?.style }}>
        {resolvedBackdrop.video ? <MediaPlayer decorative video={resolvedBackdrop.video.video} poster={{ kind: "photo", src: resolvedBackdrop.video.video.poster!, width: resolvedBackdrop.video.poster.width, height: resolvedBackdrop.video.poster.height, decorative: true }} muted autoplay loop /> : null}
        <SemanticContent as="div" className="absolute inset-0" style={{ pointerEvents: "none", backgroundImage: "var(--gradient-media-scrim)" }} />
        {Array.from({ length: HERO_SCRIM_PASSES[backdropScrim] }, (_, index) => <SemanticContent as="div" key={index} data-hero-live-scrim={backdropScrim} className="absolute inset-0" style={{ pointerEvents: "none", backgroundColor: "var(--color-overlay-scrim)" }} />)}
      </SemanticContent> : null}
      {resolvedBackdrop.need ? <SemanticContent as="aside" role="status" className="relative" style={hasBackdropArt ? { color: "var(--color-neutral-50)" } : undefined}>{resolvedBackdrop.need}</SemanticContent> : null}
      {hasBackdropArt ? <SemanticContent as="div" className="relative">{content}</SemanticContent> : content}
      {media ? <SemanticContent as="div" className={cx("w-full", hasBackdropArt ? "relative" : "", splitLayout ? "" : "max-w-display", centred && !splitLayout ? "mx-auto" : "")}>{media}</SemanticContent> : null}
    </SemanticContent>
  );
}
