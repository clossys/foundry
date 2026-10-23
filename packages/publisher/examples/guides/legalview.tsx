import { LEGAL_SECTION_IDS } from "@clossys/publisher/document";
const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});
const fixtureTerms: import("@clossys/publisher/document").LegalDocument = {
  id: "example-terms", title: { id: "terms.title" },
  sections: LEGAL_SECTION_IDS.terms.map((id) => ({
    id, kind: "section", level: 2, heading: { id: `terms.${id}` },
    blocks: [{ kind: "paragraph", content: [{ kind: "text", text: { id: `terms.${id}.body` } }] }],
  })),
  legal: { kind: "terms", status: "counsel-reviewed", effectiveDate: "2026-01-15", lastUpdated: "2026-01-10",
    variables: { entity: "Example Ltd", jurisdiction: "Exampleland", contact: "legal@example.com" } },
};

import { LegalView } from "@clossys/publisher/web";
import type { LegalViewLabels } from "@clossys/publisher/web";
import type { LegalDocument } from "@clossys/publisher/document";

type LegalResolver = React.ComponentProps<typeof LegalView>["resolveCopyId"];

const resolveCopyId: LegalResolver = fixtureResolveCopy; // the caller's approved-copy registry
const brand: React.ReactNode = "Example Studio"; // the caller's brand mark
const terms: LegalDocument = fixtureTerms; // as built in the example above

const labels: LegalViewLabels = {
  effectiveDate: { id: "acme.legal.label.effective-date" },
  lastUpdated: { id: "acme.legal.label.last-updated" },
  draftHeading: { id: "acme.legal.label.draft-heading" },
};

export function TermsPage() {
  return (
    <LegalView
      brand={brand}
      headerAction={<a href="/contact">Contact</a>}
      document={terms}
      resolveCopyId={resolveCopyId}
      labels={labels}
      locale="en-GB"
    />
  );
}

export default TermsPage;
