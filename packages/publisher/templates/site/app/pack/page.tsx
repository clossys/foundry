import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoundaryView, PackReviewView } from "@clossys/publisher/web";
import { createCopyResolver } from "@clossys/writer";
import routeManifest from "../../web-route-manifest.json" with { type: "json" };
import { packReviewGate, resolvePackReviewPage, resolvePackReviewSections } from "../pack-review";
import { PACK_REVIEW_COPY, packReviewText } from "../pack-review-copy";
import { DEV_PREVIEWS } from "../site-copy";
import {
  createPackReviewCopyResolver,
  loadBrandDeclarations,
  loadBrandFacts,
  loadEngagementBrief,
  loadPackManifest,
  loadStrategyContract,
  loadVoiceRecord,
  siteCopyIds,
} from "../site-records";

// The review index is dev-only. It is not in `web-route-manifest.json`, so it
// is not in the sitemap, and it renders per request so the target is read on
// every request and never baked in at build time.
export const dynamic = "force-dynamic";

function loadText() {
  return packReviewText(createCopyResolver(PACK_REVIEW_COPY, { target: "preview" }));
}

export function generateMetadata(): Metadata {
  if (!packReviewGate(process.env)) return {};
  return { title: loadText().heading, robots: { index: false, follow: false } };
}

// The page takes no request input at all: the pages come from the route
// manifest, the states from the contact view's own state list, the exports
// from the pack manifest, and the strategy brief, brand kit and voice and copy
// from the repository's own records, each optional. Unless `packReviewGate` is
// open (a listed `SITE_TARGET` and a hosting environment that is not production
// or preview, an unknown `SITE_TARGET` included) it answers `notFound()` before
// any record is read or any markup is built.
export default function PackReviewPage() {
  const model = resolvePackReviewPage({
    env: process.env,
    routes: routeManifest.routes,
    states: { "/contact": [...DEV_PREVIEWS] },
    loadManifest: loadPackManifest,
  });
  if (model.kind === "not-found") notFound();

  const text = loadText();
  const facts = loadBrandFacts();
  const brand = facts.brandLabel;

  if (model.kind === "unavailable") {
    return (
      <BoundaryView
        brand={brand}
        status={503}
        title={text.unavailable.title}
        description={text.unavailable.description}
        action={<a href="/">{text.unavailable.action}</a>}
      />
    );
  }

  const sections = resolvePackReviewSections({
    env: process.env,
    loadStrategyContract,
    loadEngagementBrief,
    loadVoiceRecord,
    loadBrandDeclarations,
    resolveCopy: createPackReviewCopyResolver(),
    copyIds: siteCopyIds(),
    brand: { label: brand, entity: facts.entity, canonicalOrigin: facts.canonicalOrigin, taglineCopyId: facts.taglineCopyId },
    exports: model.exports,
    text,
  });

  return (
    <PackReviewView
      brand={brand}
      surfaceLabel={text.surfaceLabel}
      heading={text.heading}
      description={text.description}
      strategy={sections.strategy}
      brandKit={sections.brandKit}
      voice={sections.voice}
      pages={model.pages}
      exports={model.exports}
      labels={text.labels}
    />
  );
}
