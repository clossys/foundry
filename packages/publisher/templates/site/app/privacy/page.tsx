import type { Metadata } from "next";
import { LegalView } from "@clossys/publisher/web";
import { LANDING_COPY_IDS, legalViewLabels, requireCopy } from "../site-copy";
import { createSiteCopyResolver, legalTitle, loadBrandFacts, loadLegalDocument, siteLocale, siteTarget } from "../site-records";

// Reads the privacy legal document through the production gate: on
// `production` a document that is not counsel-reviewed refuses to render, so
// a draft can never be served there. Every word is approved copy, resolved
// through the copy registry.
export function generateMetadata(): Metadata {
  const target = siteTarget();
  return { title: legalTitle(loadLegalDocument("privacy", target), createSiteCopyResolver(target)) };
}

export default function PrivacyPage() {
  const target = siteTarget();
  const resolveCopyId = createSiteCopyResolver(target);
  const copy = requireCopy(resolveCopyId, [LANDING_COPY_IDS.contactAction]);
  return (
    <LegalView
      brand={loadBrandFacts().brandLabel}
      headerAction={<a href="/contact">{copy[LANDING_COPY_IDS.contactAction]}</a>}
      document={loadLegalDocument("privacy", target)}
      resolveCopyId={resolveCopyId}
      labels={legalViewLabels()}
      locale={siteLocale()}
    />
  );
}
