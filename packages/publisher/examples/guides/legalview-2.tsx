import { LEGAL_SECTION_IDS } from "@clossys/publisher/document";
const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});
const fixtureFrame: import("@clossys/publisher/web").SiteFrameInput = {
  shell: {
    brand: { assetId: "brand-mark", label: { id: "brand.home" }, size: "md", variant: "mark" },
    skipLink: { id: "shell.skip" },
    footer: { legal: { entity: { id: "legal.entity" }, links: [{ href: "/privacy", label: { id: "legal.privacy" } }] } },
  },
  resolveCopy: fixtureResolveCopy,
  resolveAsset: () => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Example" }),
};
const fixtureTerms: import("@clossys/publisher/document").LegalDocument = {
  id: "example-terms", title: { id: "terms.title" },
  sections: LEGAL_SECTION_IDS.terms.map((id) => ({
    id, kind: "section", level: 2, heading: { id: `terms.${id}` },
    blocks: [{ kind: "paragraph", content: [{ kind: "text", text: { id: `terms.${id}.body` } }] }],
  })),
  legal: { kind: "terms", status: "counsel-reviewed", effectiveDate: "2026-01-15", lastUpdated: "2026-01-10",
    variables: { entity: "Example Ltd", jurisdiction: "Exampleland", contact: "legal@example.com" } },
};

import { LegalView, SiteFrame } from "@clossys/publisher/web";
import type { LegalViewLabels } from "@clossys/publisher/web";
import type { LegalDocument } from "@clossys/publisher/document";

const frame: React.ComponentProps<typeof SiteFrame> = { ...fixtureFrame, children: null };
const document: LegalDocument = fixtureTerms;
const labels: LegalViewLabels = { effectiveDate: { id: "legal.effective" }, lastUpdated: { id: "legal.updated" }, draftHeading: { id: "legal.draft" } };
const resolveCopyId: React.ComponentProps<typeof LegalView>["resolveCopyId"] = fixtureResolveCopy;

export function FramedTermsPage() {
  return (
    <SiteFrame {...frame}>
      <LegalView framed document={document} resolveCopyId={resolveCopyId}
        labels={labels} locale="en-GB" />
    </SiteFrame>
  );
}

export default FramedTermsPage;
