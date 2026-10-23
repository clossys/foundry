const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});
const myCopyResolver = fixtureResolveCopy;

import { validateStructuredDocument, renderStructuredDocument } from "@clossys/publisher/document";
import type { StructuredDocument } from "@clossys/publisher/document";

const ref = (id: string) => ({ id });

const helpArticle: StructuredDocument = {
  id: "acme.help.getting-started",
  title: ref("acme.doc.title"),
  sections: [
    {
      kind: "section",
      id: "overview", // a literal, author-supplied, locale-stable anchor — never derived from `heading`
      level: 2, // h1 is reserved for the page's own title, rendered outside this contract
      heading: ref("acme.overview.heading"),
      blocks: [
        {
          kind: "paragraph",
          content: [
            { kind: "text", text: ref("acme.overview.p1") },
            { kind: "link", text: ref("acme.overview.link"), href: "#pricing" }, // an in-document fragment link
            { kind: "strong", content: [{ kind: "link", text: ref("acme.overview.bold"), href: "https://acme.example/docs" }] }, // a bold link
            { kind: "em", content: [{ kind: "text", text: ref("acme.overview.italic") }] },
          ],
        },
        { kind: "list", style: "ordered", items: [[{ kind: "text", text: ref("acme.overview.item1") }]] },
      ],
    },
    {
      kind: "section",
      id: "pricing",
      level: 2,
      heading: ref("acme.pricing.heading"),
      blocks: [
        {
          kind: "table",
          headers: [ref("acme.pricing.plan"), ref("acme.pricing.price")],
          columnStyles: ["default", "mono"], // one entry per header; a "mono" column's body cells render in <code>
          rows: [[ref("acme.pricing.plan1"), ref("acme.pricing.price1")]],
        },
      ],
    },
  ],
};

const findings = validateStructuredDocument(helpArticle); // [] when clean — see "What is validated" below
const { element, resolutions } = renderStructuredDocument(helpArticle, { resolveCopyId: myCopyResolver });

export { findings, element, resolutions };
