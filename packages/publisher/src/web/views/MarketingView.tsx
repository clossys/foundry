import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { mergeUiClasses } from "@clossys/designer/atoms";
import { Faq, FeatureGrid, Hero } from "@clossys/designer/blocks";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell";

/**
 * One entry in {@link MarketingViewProps.features} — deliberately a single
 * text region (`heading` only, no `description`/`icon`), unlike
 * `@clossys/designer/blocks`' own `FeatureGridItem`. The `features`
 * repeating slot deliberately uses the legacy one-value item shape, unlike
 * the structured `faq` slot below. See `internal/webTemplates.ts`'s
 * `MARKETING_VIEW_TEMPLATE` for how a resolved repeating group's items
 * become this shape.
 */
export interface MarketingFeatureItem {
  /** Stable identifier — the React key. Synthesized from the item's resolved ordinal position, never authored. */
  id: string;
  /** The feature's own resolved content — text, a resolved `<img>`, or a caller-owned node. */
  heading: ReactNode;
}

/**
 * One entry in {@link MarketingViewProps.faq} — unlike
 * {@link MarketingFeatureItem}, a FAQ entry genuinely needs TWO independent
 * pieces of CopyRef-resolved copy (`question` and `answer`). The template
 * declares both fields as required, so they stay in ordinary locale, voice,
 * and provenance handling rather than becoming a caller-authored node.
 */
export interface MarketingFaqItem {
  /** Stable identifier — the React key. Synthesized from the item's resolved ordinal position, never authored. */
  id: string;
  question: ReactNode;
  answer: ReactNode;
}

export interface MarketingViewProps extends HTMLAttributes<HTMLDivElement> {
  /** The site's identity — passed straight through to `SiteHeader.brand`. */
  brand: ReactNode;
  /** Small label above the hero heading. */
  heroEyebrow?: ReactNode;
  /** The page's own primary message. Renders as the page's `<h1>` (`Hero`'s own default `headingLevel`). */
  heroHeading: ReactNode;
  /** A line of supporting copy under the hero heading. */
  heroDescription?: ReactNode;
  /** The hero's calls to action. */
  heroActions?: ReactNode;
  /** A visual companion to the hero's text content — typically a resolved `<img>`. */
  heroMedia?: ReactNode;
  /** Optional heading above the feature grid. */
  featuresHeading?: ReactNode;
  /** A line of supporting copy under the features heading. */
  featuresDescription?: ReactNode;
  /** The features to render — a homogeneous repeat, bound via a `SurfaceRepeatingSlotBinding`. May be empty. */
  features: readonly MarketingFeatureItem[];
  /** Optional heading above the FAQ list. */
  faqHeading?: ReactNode;
  /** A line of supporting copy under the FAQ heading. */
  faqDescription?: ReactNode;
  /**
   * The FAQ entries to render — a homogeneous repeat, bound via a
   * `SurfaceRepeatingSlotBinding`. `undefined` (the binding was never
   * authored for this document) omits the whole FAQ section; an explicit
   * empty array (the binding was authored with zero items) still renders
   * the section — its heading/description, if any, with no question/answer
   * pairs beneath — the same "empty is a deliberate, valid choice, not an
   * error" contract `surface/core`'s repeating bindings already hold to.
   */
  faq?: readonly MarketingFaqItem[];
  /** The closing call-to-action band's own heading. Renders as a second `Hero`-shaped section (`headingLevel={2}`) — see `@clossys/designer/blocks`' `Hero` doc comment, "a page can reasonably contain two `Hero`-shaped sections". */
  ctaHeading: ReactNode;
  /** A line of supporting copy under the CTA heading. */
  ctaDescription?: ReactNode;
  /** The CTA band's own call to action. */
  ctaAction?: ReactNode;
  /** The footer's secondary/legal row — passed straight through to `SiteFooter.secondary`. */
  footerSecondary?: ReactNode;
  style?: CSSProperties;
}

/**
 * An ordinary flowed marketing page — persistent header, a hero, a feature
 * grid, an optional FAQ list, a closing call-to-action band, and a
 * persistent footer. The second (and, per issue #166, final) named web
 * template this package ships, alongside `AuthView` and `ErrorView` — a
 * FIXED, NAMED set of slots exactly like those two, not a free-form
 * composition surface (see this package's README, "Scope: this package
 * renders and validates. It does not compose").
 *
 * Composed entirely from already-shipped `@clossys/designer` primitives
 * — `SiteHeader`/`SiteFooter` (persistent chrome, `ui/shell`) and
 * `Hero`/`FeatureGrid`/`Faq` (page content, `ui/blocks`) — with no styling
 * or token decisions of its own: every visual choice (spacing, color,
 * type) belongs to those components, not to this one. This component's
 * only job is regional layout: which named slot goes where.
 *
 * `features` is always an array (the `features` binding is required —
 * see `internal/webTemplates.ts`'s `MARKETING_VIEW_TEMPLATE.repeatingSlots`
 * — but MAY be empty; `FeatureGrid` itself renders a heading region with
 * zero items cleanly). `faq` is optional at both levels: `undefined` omits
 * the whole section, an empty array renders it with zero entries — see
 * `faq`'s own doc comment above.
 */
export function MarketingView({
  brand,
  heroEyebrow,
  heroHeading,
  heroDescription,
  heroActions,
  heroMedia,
  featuresHeading,
  featuresDescription,
  features,
  faqHeading,
  faqDescription,
  faq,
  ctaHeading,
  ctaDescription,
  ctaAction,
  footerSecondary,
  className,
  style,
  ...rest
}: MarketingViewProps) {
  return (
    <div {...rest} className={mergeUiClasses("flex min-h-dvh flex-col", className)} style={style}>
      <SiteHeader brand={brand} />
      <main className="flex flex-col gap-2xl py-2xl">
        <Hero eyebrow={heroEyebrow} heading={heroHeading} description={heroDescription} actions={heroActions} media={heroMedia} />
        <FeatureGrid heading={featuresHeading} description={featuresDescription} items={features} />
        {faq !== undefined ? <Faq heading={faqHeading} description={faqDescription} items={faq} /> : null}
        <Hero headingLevel={2} heading={ctaHeading} description={ctaDescription} actions={ctaAction} />
      </main>
      <SiteFooter secondary={footerSecondary} />
    </div>
  );
}
