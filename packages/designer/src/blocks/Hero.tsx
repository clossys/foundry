import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";

export type HeroHeadingLevel = 1 | 2;

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
   * illustration, an embedded video. Omit for a text-and-CTA-only hero;
   * supply it and this block switches to a two-column layout (content
   * beside media on `tablet` widths and up, stacked below it) rather than
   * growing a `variant` prop for the same effect — presence/absence of a
   * slot, exactly like `PageHeader`'s `breadcrumb`/`actions`, not a mode
   * string (see this package's README, "Slots beat mode props").
   *
   * Deliberately a plain `ReactNode`, not a `{ src, alt }` data pair the
   * way `Avatar`'s (and this file's sibling `Testimonial`'s) avatar prop
   * is: a hero's media isn't always a single `<img>` — it's just as often
   * a video embed, an SVG illustration, or a small composed graphic, none
   * of which share one `alt`-shaped contract. Forcing an image-specific
   * shape here would be wrong for every hero that isn't a bare photo, the
   * same reasoning `Icon`'s `children` slot documents for a one-off custom
   * glyph. If what you place here IS a plain `<img>`, give it real,
   * non-empty `alt` text yourself (or render this package's own `Avatar`/
   * `Icon` atom, both of which already enforce an accessible name at the
   * type level) — this package cannot enforce that for an arbitrary node,
   * the same way it cannot for `actions` or `eyebrow`.
   */
  media?: ReactNode;
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
  className?: string;
  style?: CSSProperties;
}

/**
 * A page's primary above-the-fold message: an optional eyebrow, a heading,
 * an optional description, and an optional row of calls to action — the
 * same title/description/actions shape `PageHeader` gives an application
 * page, sized and composed for a marketing/content page instead. Renders a
 * plain `<section>`, not `<header>`: unlike `PageHeader` (a page-level
 * singleton whose `<header>` correctly registers the page's one `banner`
 * landmark), a page can reasonably contain two `Hero`-shaped sections (this
 * package's README, "Placement rules", test 3 — a long landing page
 * routinely has more than one full-bleed message section), and a second
 * top-level `<header>` would register a second `banner` landmark, which
 * isn't valid document structure — the same reasoning `SectionHeader`'s own
 * section documents for using a plain `<div>` instead of `<header>`.
 *
 * **One visual variant, driven by slot presence, not a `variant` prop:**
 * omitting `media` renders a single centered content column; supplying it
 * switches to a two-column layout (content beside media from the `tablet`
 * breakpoint up, stacked below it) — see `media`'s own doc comment for why
 * this is presence/absence rather than a mode string.
 */
export function Hero({
  eyebrow,
  heading,
  description,
  actions,
  media,
  headingLevel = 1,
  className,
  style,
  ...rest
}: HeroProps) {
  const HeadingTag = headingLevel === 1 ? "h1" : "h2";

  const content = (
    <div className="flex flex-col items-start gap-md">
      {eyebrow ? (
        <p className="text-caption uppercase tracking-label text-ink-muted">{eyebrow}</p>
      ) : null}
      <HeadingTag className="text-display-l font-display text-ink-primary">{heading}</HeadingTag>
      {description ? (
        <p className="text-body-l text-ink-secondary">{description}</p>
      ) : null}
      {actions ? (
        <div className="flex flex-wrap items-center gap-sm">{actions}</div>
      ) : null}
    </div>
  );

  return (
    <section
      {...rest}
      className={cx(
        media
          ? "grid grid-cols-1 items-center gap-xl tablet:grid-cols-2"
          : "flex flex-col",
        className,
      )}
      style={style}
    >
      {content}
      {media ? <div className="w-full">{media}</div> : null}
    </section>
  );
}
