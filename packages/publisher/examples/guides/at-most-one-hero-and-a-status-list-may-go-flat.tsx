import { resolveSectionedViewDocument } from "@clossys/publisher/core";
import { SectionedView } from "@clossys/publisher/web";
const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});
const resolveCopy = fixtureResolveCopy;

const resolved = resolveSectionedViewDocument({
  id: "acme-trust",
  sections: [
    {
      id: "core",
      kind: "status-list",
      ground: "base",
      heading: { id: "acme.trust.posture" },
      labels: {
        available: { id: "acme.status.available" },
        partial: { id: "acme.status.partial" },
        planned: { id: "acme.status.planned" },
        dispositions: { "not-offered": { id: "acme.status.not-offered" } },
      },
      items: [
        { id: "audit", label: { id: "acme.trust.audit.label" }, disposition: "not-offered" },
        { id: "access", label: { id: "acme.trust.access.label" }, state: "available" },
        { id: "review", label: { id: "acme.trust.review.label" }, state: "partial" },
      ],
    },
    // A closing call-to-action band: a second hero, not first, rendered as h2.
    { id: "cta", kind: "hero", ground: "inverse", heading: { id: "acme.trust.cta" } },
  ],
}, resolveCopy);

export default function Example() { return <SectionedView document={resolved} />; }
