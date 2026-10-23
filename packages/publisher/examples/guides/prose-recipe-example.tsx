import {
  createCopyResolver,
  type CopyRegistry,
} from "@clossys/writer";
import {
  resolveSectionedViewDocument,
  type SectionedViewDocument,
} from "@clossys/publisher/core";
import { SectionedView } from "@clossys/publisher/web";

const registry = {
  id: "prose-example", locale: "en", revision: "1",
  source: { kind: "consumer", reference: "prose-example" },
  entries: [
    { id: "acme.home.heading", text: "Welcome", context: "Section example", status: "approved" },
    { id: "acme.home.description", text: "A section of approved copy.", context: "Section example", status: "approved" },
    { id: "prose.heading", text: "Reading guide", context: "Prose example", status: "approved" },
    { id: "prose.before", text: "Read the ", context: "Prose example", status: "approved" },
    { id: "prose.link", text: "writing guide", context: "Prose example", status: "approved" },
    { id: "prose.after", text: " before continuing.", context: "Prose example", status: "approved" },
    { id: "prose.second", text: "Keep source material beside the record.", context: "Prose example", status: "approved" },
  ],
} satisfies CopyRegistry;
const document = {
  id: "prose-example",
  sections: [{
    id: "reading", kind: "content-section", heading: { id: "prose.heading" },
    block: { type: "prose", paragraphs: [
      [
        { type: "text", text: { id: "prose.before" } },
        { type: "link", text: { id: "prose.link" }, href: "/guide" },
        { type: "text", text: { id: "prose.after" } },
      ],
      [{ type: "text", text: { id: "prose.second" } }],
    ] },
  }],
} satisfies SectionedViewDocument;
const resolveCopy = createCopyResolver(registry);
export const proseDocument = resolveSectionedViewDocument(document, resolveCopy);
const prosePage = <SectionedView document={proseDocument} />;

const resolved = resolveSectionedViewDocument({
  id: "acme-home",
  sections: [{
    id: "welcome",
    kind: "hero",
    ground: "base",
    heading: { id: "acme.home.heading" },
    description: { id: "acme.home.description" },
  }],
}, resolveCopy);

const page = <SectionedView document={resolved} />;
// resolved.resolutions feeds collectCopyProvenance/output-manifest helpers.

void prosePage;
export default function Example() { return page; }
