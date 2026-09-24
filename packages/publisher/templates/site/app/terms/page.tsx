import type { Metadata } from "next";
import { renderWebDocument, buildWebHeadMetadata } from "@clossys/publisher/web";
// Reads clossys/publisher/surfaces/terms.json at build time (#1205).
// Uses the shipped MarketingView template; a long-form page that needs
// DocumentView's structured-document shape instead registers it as a
// consumer template via defineWebTemplate (see this package's README,
// "Choosing a shipped view") rather than calling DocumentView directly.
import surface from "../../../../clossys/publisher/surfaces/terms.json" with { type: "json" };

export function generateMetadata(): Metadata {
  const head = buildWebHeadMetadata(surface.meta);
  return { title: head.title, description: head.description };
}

export default function Page() {
  const { element } = renderWebDocument(surface, {
    groups: surface.groups ?? [],
  });
  return element;
}
