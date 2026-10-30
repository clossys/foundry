/** Scoped integration contribution for the existing Content section and Studio sample. */
import { ContentSection } from "../blocks/ContentSection.js";
import { componentLeaf } from "../runtime/component-leaf.js";
import { contentSample } from "./surface-preview-sample-content.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Apply these additions to the existing sections.content contract; retain its existing fields. */
export const contentSectionContractContribution = {
  entryId: "sections.content",
  slots: [{ name: "aside", type: "region", required: false }],
  allowedComposes: ["components.card"],
  copyFields: [
    { key: "aside[].label", kind: "plain", required: false, maxLength: { en: 120 }, dir: "auto" },
    { key: "aside[].value", kind: "plain", required: false, maxLength: { en: 480 }, dir: "auto" },
  ],
} as const;

/** Reuses Studio's synthetic copy; the real selected Card/CardContent renders the summary. */
export function ContentSectionSpecimen() {
  return <ContentSection eyebrow={contentSample.eyebrow} heading={contentSample.heading} description={contentSample.description}
    aside={[{ id: "summary", label: contentSample.eyebrow, value: contentSample.heading }]}>
    <SemanticContent as="p">{contentSample.body}</SemanticContent>
  </ContentSection>;
}

/** Replace only the existing ContentSection sample entry in STRUCTURED_BLOCK_SAMPLES. */
export const contentSectionStudioContribution = {
  entryId: "sections.content",
  exportName: "ContentSection",
  render: ContentSectionSpecimen,
} as const;
