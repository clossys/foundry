import { siteHeaderPresentation } from "../internal/viewChromeGround.js";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { Faq, FeatureGrid, Hero } from "@clossys/designer/blocks/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import type { MarketingViewProps } from "./MarketingView.js";

/**
 * React-server-safe MarketingView. Its public props and regional layout match
 * the ordinary view exactly, while its Designer imports are restricted to the
 * empirically server-safe barrels. In particular, its FAQ resolves to the
 * native details/summary implementation rather than the ordinary React Aria
 * component.
 */
export function MarketingView({
  brand,
  headerAction,
  secondaryAction,
  nav,
  /** @default "base" */
  ground = "base",
  heroEyebrow,
  heroHeading,
  heroDescription,
  heroActions,
  heroMedia,
  heroGround = "base",
  featuresHeading,
  featuresDescription,
  features,
  featuresGround = "sunken",
  faqHeading,
  faqDescription,
  faq,
  faqGround = "base",
  ctaHeading,
  ctaDescription,
  ctaAction,
  ctaGround = "sunken",
  footerSecondary,
  className,
  style,
  ...rest
}: MarketingViewProps) {
  const headerPresentation = siteHeaderPresentation(ground);
  return (
    <div {...rest} className={mergeUiClasses("flex min-h-dvh flex-col", className)} style={style}>
      <SiteHeader surface={headerPresentation.surface} tone={headerPresentation.tone} brand={brand} nav={nav} actions={<>{secondaryAction}{headerAction}</>} />
      <main className="flex flex-col gap-2xl py-2xl">
        <Hero
          eyebrow={heroEyebrow}
          heading={heroHeading}
          description={heroDescription}
          actions={heroActions}
          media={heroMedia}
          composition={heroMedia ? "split" : "editorial"}
          ground={heroGround}
        />
        {features.length > 0 || featuresHeading !== undefined || featuresDescription !== undefined ? (
          <FeatureGrid heading={featuresHeading} description={featuresDescription} items={features} ground={featuresGround} />
        ) : null}
        {faq !== undefined ? <Faq heading={faqHeading} description={faqDescription} items={faq} ground={faqGround} /> : null}
        <Hero headingLevel={2} heading={ctaHeading} description={ctaDescription} actions={ctaAction} ground={ctaGround} />
      </main>
      <SiteFooter secondary={footerSecondary} />
    </div>
  );
}
