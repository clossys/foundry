import type { Metadata } from "next";
import { SiteFooter } from "@clossys/designer/shell/server";
import { MarketingView } from "@clossys/publisher/web";
import { ABOUT_COPY_IDS, LANDING_COPY_IDS, aboutCopyIds, requireCopy, siteFooterLegal } from "../site-copy";
import { createSiteCopyResolver, loadBrandFacts, siteTarget } from "../site-records";

// The about page uses the shipped MarketingView (a long-form page that needs
// DocumentView's structured-document shape instead registers it as a consumer
// template via defineWebTemplate; see this package's README, "Choosing a
// shipped view"). It reads the brand-facts record for the name and the legal
// entity and the copy registry for every word: a missing id fails the build,
// never renders blank.
function load() {
  const facts = loadBrandFacts();
  const copy = requireCopy(createSiteCopyResolver(siteTarget()), aboutCopyIds());
  return { facts, copy };
}

export function generateMetadata(): Metadata {
  const { copy } = load();
  return { title: copy[ABOUT_COPY_IDS.heading], description: copy[ABOUT_COPY_IDS.description] };
}

export default function AboutPage() {
  const { facts, copy } = load();
  return (
    <MarketingView
      brand={facts.brandLabel}
      headerAction={<a href="/contact">{copy[LANDING_COPY_IDS.contactAction]}</a>}
      heroHeading={copy[ABOUT_COPY_IDS.heading]}
      heroDescription={copy[ABOUT_COPY_IDS.description]}
      features={[]}
      ctaHeading={copy[ABOUT_COPY_IDS.ctaHeading]}
      ctaDescription={copy[ABOUT_COPY_IDS.ctaDescription]}
      ctaAction={<a href="/contact">{copy[LANDING_COPY_IDS.contactAction]}</a>}
      footerSecondary={<SiteFooter.Legal {...siteFooterLegal(copy, facts.entity)} />}
    />
  );
}
