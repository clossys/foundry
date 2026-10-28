import { ArticleBody } from "../../blocks/ArticleBody.js";
import { ContentSection } from "../../blocks/ContentSection.js";
import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import type { SurfaceRendererEntry } from "../contract.js";
import { list, object, readSectionContent, required, SectionContentError, text, type JsonObject, type SectionContent } from "./group-a-content.js";

const LEAF = "sections.legal-prose";
export const legalProseInputs = { slots: ["heading", "revision", "body"], members: [] } as const;

function closed(content: SectionContent, value: JsonObject, keys: readonly string[], path: string) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new SectionContentError(content.leaf, `${path}.${key} is not supported`);
}

/** Host-authored typed prose only. Text is escaped by React; HTML and arbitrary nodes are refused. */
function bodyNodes(content: SectionContent) {
  return list(content, required(content, "body"), "body").map((row, index) => {
    const path = `body.${index}`, node = object(content, row, path);
    const kind = text(content, node.kind, `${path}.kind`);
    if (kind === "paragraph" || kind === "heading") {
      closed(content, node, ["kind", "text"], path);
      return <SemanticContent key={index} as={kind === "heading" ? "h3" : "p"} dir="auto">{text(content, node.text, `${path}.text`)}</SemanticContent>;
    }
    if (kind === "list") {
      closed(content, node, ["kind", "items"], path);
      return <SemanticContent key={index} as="ul" dir="auto">{list(content, node.items, `${path}.items`).map((item, at) => <SemanticContent key={at} as="li" dir="auto">{text(content, item, `${path}.items.${at}`)}</SemanticContent>)}</SemanticContent>;
    }
    throw new SectionContentError(LEAF, `${path}.kind ${kind} is not supported`);
  });
}

/** Private composition: ContentSection supplies the title, ArticleBody supplies prose typography. */
export const legalProseRenderer: SurfaceRendererEntry = {
  leaf: LEAF,
  sample: dataset => ({
    heading: `${dataset.assets.mark.name} policy preview`,
    revision: { label: "Revision", value: "Draft" },
    body: [{ kind: "paragraph", text: "Policy text is supplied by the host." }],
  }),
  render(input) {
    const content = readSectionContent(input, LEAF, legalProseInputs);
    const heading = text(content, required(content, "heading"), "heading");
    let revision;
    if (content.values.revision !== undefined) {
      const value = object(content, content.values.revision, "revision");
      closed(content, value, ["label", "value"], "revision");
      revision = <><SemanticContent as="span" dir="auto">{text(content, value.label, "revision.label")}</SemanticContent>{" "}<SemanticContent as="span" dir="auto">{text(content, value.value, "revision.value")}</SemanticContent></>;
    }
    return <ContentSection {...dsAttrs("sections", LEAF, `foundry/${LEAF}`)} data-designer-requires-section-frame="" heading={<SemanticContent as="span" dir="auto">{heading}</SemanticContent>} description={revision}>
      <ArticleBody>{bodyNodes(content)}</ArticleBody>
    </ContentSection>;
  },
};
