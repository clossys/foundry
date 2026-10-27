/** sections.article: the dataset's prose blocks as ArticleBody children. The fill maps no table-of-contents slot. */
import type { ReactNode } from "react";
import { ArticleBody } from "../../blocks/ArticleBody.js";
import { proseNodes, readSectionContent, required, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const articleInputs: SectionRendererInputs = { slots: ["body"], members: [] };

export function renderArticleSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.article", articleInputs);
  return <ArticleBody>{proseNodes(content, required(content, "body"), "body")}</ArticleBody>;
}
