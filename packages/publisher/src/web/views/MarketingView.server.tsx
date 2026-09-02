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
