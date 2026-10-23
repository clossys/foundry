const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});

import { resolveSectionedViewDocument, type SectionedViewDocument } from "@clossys/publisher/core";
import { SectionedView } from "@clossys/publisher/web";

const resolveCopy: Parameters<typeof resolveSectionedViewDocument>[1] = fixtureResolveCopy; // resolves approved registry entries

const document: SectionedViewDocument = {
  id: "feature-status-page",
  sections: [{
    id: "feature-status",
    kind: "content-section",
    heading: { id: "feature-status.heading" },
    block: {
      type: "items",
      recipe: "topics",
      columns: 1,
      scale: "item",
      items: [
        { id: "search", heading: { id: "search.heading" }, badge: { label: { id: "status.live" }, tone: "success" } },
        { id: "imports", heading: { id: "imports.heading" }, badge: { label: { id: "status.in-progress" }, tone: "info" } },
        { id: "exports", heading: { id: "exports.heading" }, badge: { label: { id: "status.planned" }, tone: "neutral" } },
      ],
    },
  }],
};

const page = <SectionedView document={resolveSectionedViewDocument(document, resolveCopy)} />;

export default function Example() { return page; }
