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
      id: "welcome",
      kind: "hero",
      ground: "base",
      heading: { id: "acme.trust.heading" },
      actions: [{ id: "contact", label: { id: "acme.trust.contact" }, href: "/contact" }],
    },
    {
      id: "posture",
      kind: "status-list",
      ground: "sunken",
      eyebrow: { id: "acme.trust.eyebrow" },
      heading: { id: "acme.trust.posture" },
      labels: {
        available: { id: "acme.status.available" },
        partial: { id: "acme.status.partial" },
        planned: { id: "acme.status.planned" },
        dispositions: { "not-offered": { id: "acme.status.not-offered" } },
      },
      groups: [{
        id: "core",
        heading: { id: "acme.trust.core" },
        items: [{
          id: "audit",
          label: { id: "acme.trust.audit.label" },
          detail: { id: "acme.trust.audit.detail" },
          disposition: "not-offered",
        }, { id: "access", label: { id: "acme.trust.access.label" }, state: "available" }],
      }, {
        id: "next",
        heading: { id: "acme.trust.next" },
        items: [
          { id: "review", label: { id: "acme.trust.review.label" }, state: "partial" },
          { id: "follow-up", label: { id: "acme.trust.follow-up.label" }, state: "planned" },
        ],
      }],
    },
  ],
}, resolveCopy);

export default function Example() { return <SectionedView document={resolved} />; }
