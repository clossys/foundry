const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});

import { resolveSectionedViewDocument, type ResolvedSectionedViewDocument } from "@clossys/publisher/core";
import { LandingView } from "@clossys/publisher/web";

const page: ResolvedSectionedViewDocument = resolveSectionedViewDocument({ id: "product", sectionGroundRhythm: "view", sections: [{ id: "opening", kind: "hero", heading: { id: "product.heading" } }, { id: "features", kind: "content-section", heading: { id: "features.heading" }, block: { type: "items", recipe: "features", items: ["one", "two", "three"].map((id) => ({ id, heading: { id: "feature.heading" } })) } }] }, fixtureResolveCopy); // from resolveSectionedViewDocument; its first section is a hero
const faq: ResolvedSectionedViewDocument = resolveSectionedViewDocument({ id: "faq", sectionGroundRhythm: "view", sections: [{ id: "faq", kind: "faq", heading: { id: "faq.heading" }, items: ["one", "two", "three", "four"].map((id) => ({ id, question: { id: "faq.question" }, answer: { id: "faq.answer" } })) }] }, fixtureResolveCopy); // a shared FAQ document
const screenshot: React.ReactNode = <figure>Example screenshot</figure>; // for example a Designer `MediaFigure`
const resolveCopy: Parameters<typeof resolveSectionedViewDocument>[1] = fixtureResolveCopy;

// One content-section band: topics beside a one-panel specimen.
const records = resolveSectionedViewDocument({
  id: "records",
  sectionGroundRhythm: "view",
  sections: [{
    id: "records",
    kind: "content-section",
    heading: { id: "records.heading" },
    layout: "split-end",
    block: { type: "items", recipe: "topics", items: [
      { id: "kept", icon: "folder", heading: { id: "records.kept" } },
      { id: "shared", icon: "users", heading: { id: "records.shared" } },
    ] },
    media: { type: "specimen", label: { id: "records.label" }, panel: {
      id: "record",
      title: { id: "records.panel" },
      parts: [{ id: "fields", type: "fields", items: [
        { id: "owner", label: { id: "records.owner" }, value: { id: "records.owner.value" } },
      ] }],
    } },
  }],
}, resolveCopy);

export function ProductPage() {
  return (
    <LandingView
      document={page}
      trailing={[records, faq]}
      afterSection={{ features: screenshot }}
      callToAction={{ copy: "hero", action: <a href="/start">Start</a> }}
    />
  );
}

export default ProductPage;
