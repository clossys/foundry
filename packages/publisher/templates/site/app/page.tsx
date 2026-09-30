import type { Metadata } from "next";
import { LandingView } from "@clossys/publisher/web";
import { LANDING_COPY_IDS, landingCopyIds, requireCopy, siteFooterLegal } from "./site-copy";
import { createSiteCopyResolver, loadBrandFacts, siteTarget } from "./site-records";

// The landing page reads the brand-facts record for the name, the legal entity
// and the tagline's copy id, and the copy registry for every word. It ships no
// wording of its own: a missing id fails the build, never renders blank.
function load() {
  const facts = loadBrandFacts();
  const headingId = facts.taglineCopyId ?? LANDING_COPY_IDS.heading;
  const copy = requireCopy(createSiteCopyResolver(siteTarget()), landingCopyIds(headingId));
  return { facts, headingId, copy };
}

export function generateMetadata(): Metadata {
  const { facts, copy } = load();
  return { title: facts.brandLabel, description: copy[LANDING_COPY_IDS.description] };
}

export default function HomePage() {
  const { facts, headingId, copy } = load();
  return (
    <LandingView
      brand={facts.brandLabel}
      headerAction={<a href="/contact">{copy[LANDING_COPY_IDS.contactAction]}</a>}
      heading={copy[headingId]}
      description={copy[LANDING_COPY_IDS.description]}
      legal={siteFooterLegal(copy, facts.entity)}
    />
  );
}
