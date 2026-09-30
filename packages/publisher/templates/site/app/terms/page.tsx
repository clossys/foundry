import type { Metadata } from "next";
import { LegalView } from "@clossys/publisher/web";
import { legalViewLabels } from "../site-copy";
import { createSiteCopyResolver, legalTitle, loadBrandFacts, loadLegalDocument, siteLocale, siteTarget } from "../site-records";

// Reads the terms legal document through the production gate: on
// `production` a document that is not counsel-reviewed refuses to render, so
// a draft can never be served there. Every word is approved copy, resolved
// through the copy registry.
export function generateMetadata(): Metadata {
  const target = siteTarget();
  return { title: legalTitle(loadLegalDocument("terms", target), createSiteCopyResolver(target)) };
}

export default function TermsPage() {
  const target = siteTarget();
  return (
    <LegalView
      brand={loadBrandFacts().brandLabel}
      document={loadLegalDocument("terms", target)}
      resolveCopyId={createSiteCopyResolver(target)}
      labels={legalViewLabels()}
      locale={siteLocale()}
    />
  );
}
