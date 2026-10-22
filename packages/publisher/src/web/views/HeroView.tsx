import { siteHeaderPresentation } from "../internal/viewChromeGround.js";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { Hero, SECTION_GROUND_CLASSES } from "@clossys/designer/blocks/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import type { SiteFooterLegalProps } from "@clossys/designer/shell/server";

/** The page's ground: `base` keeps the ambient surface and the base ink; `inverse` paints the inverse surface with the on-inverse ink. */
export type HeroViewGround = "base" | "inverse";

/** Retained legacy footer option. Both values use the default dark footer with no divider. */
export type HeroViewFooter = "transparent" | "surface";

export interface HeroViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Persistent site identity, rendered in the page banner. A slot: consumers typically pass a `Brandmark`. */
  brand: ReactNode;
  /** The page's call to action, rendered in the banner. */
  headerAction?: ReactNode;
  /** A short line above the heading. */
  eyebrow?: ReactNode;
  /** The page's only `<h1>`. */
  heading: ReactNode;
  /** A line of supporting copy under the heading. */
  description?: ReactNode;
  /**
   * A call to action inside the hero. Absent by default: the page's call to
   * action lives in the banner alone, so a hero action is an explicit choice.
   */
  heroAction?: ReactNode;
  /** Media shown after the description. */
  media?: ReactNode;
  /**
   * How the hero's content aligns.
   * @default "center"
   */
  align?: "center" | "start";
  /**
   * Decoration behind the page. Rendered first, absolutely positioned,
   * `aria-hidden` and non-interactive; absent from the markup when omitted.
   */
  backdrop?: ReactNode;
  /** The legal row, passed straight to `SiteFooter.Legal`. Every visible word in it comes from these props. */
  legal: SiteFooterLegalProps;
  /**
   * The page's ground. `"inverse"` paints the inverse surface on the page
   * root and gives the banner and hero the on-inverse ink; the banner
   * stays plate-less over the backdrop. The footer keeps its default dark tone.
   * @default "base"
   */
  ground?: HeroViewGround;
  /**
   * Retained legacy footer option. Both values render the default dark
   * footer with no divider. The banner is unaffected.
   * @default "transparent"
   */
  footer?: HeroViewFooter;
  style?: CSSProperties;
}

/**
 * A single-screen landing page: a transparent banner, one centred hero and a
 * dark legal footer over an optional backdrop.
 *
 * What it guarantees: one banner, one main and one contentinfo landmark; the
 * `heading` as the page's only `<h1>`; a call to action in the banner alone
 * unless `heroAction` is supplied; a backdrop that is inert to assistive
 * technology and to the pointer; a header that carries no background or
 * border; a full-width dark footer and legal row; page ink taken from
 * Designer's ground classes for `ground`; and copy that
 * comes only from props (there is no built-in wording).
 *
 * What it does not do: check the contrast of the page ink over the backdrop,
 * restyle the actions a consumer passes in (a call to action carries its own
 * treatment), or make anything a consumer places inside the backdrop
 * unfocusable. Those belong to the consumer.
 */
export function HeroView({
  brand,
  headerAction,
  eyebrow,
  heading,
  description,
  heroAction,
  media,
  align = "center",
  backdrop,
  legal,
  ground = "base",
  footer = "transparent",
  className,
  style,
  ...rest
}: HeroViewProps) {
  const ink = SECTION_GROUND_CLASSES[ground];
  const chromeGround = ground === "inverse" ? "transparent-inverse" : "transparent";
  return (
    <div
      {...rest}
      className={mergeUiClasses("relative flex min-h-dvh flex-col", ink.surface, ink.primary, className)}
      style={style}
    >
      {backdrop ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {backdrop}
        </div>
      ) : null}
      <SiteHeader {...siteHeaderPresentation(chromeGround)} brand={brand} actions={headerAction} />
      <main className="relative flex flex-1 flex-col items-center justify-center px-lg py-2xl">
        <Hero
          eyebrow={eyebrow}
          eyebrowTone="muted"
          heading={heading}
          headingScale="display"
          description={description}
          actions={heroAction}
          media={media}
          align={align}
          ground={ground}
          measure="wide"
          className="w-full"
        />
      </main>
      <SiteFooter secondary={<SiteFooter.Legal {...legal} />} />
    </div>
  );
}
