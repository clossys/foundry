/**
 * sections.article: the dataset's prose blocks as ArticleBody children. The optional toc region is a
 * `{ label, items: [{ id, label, level? }] }` record composed through the registered TableOfContents and laid
 * beside the body; its links target the body headings that carry the same ids.
 */
import type { ReactNode } from "react";
import { ArticleBody } from "../../blocks/ArticleBody.js";
import { TableOfContents, type TableOfContentsItem } from "../../blocks/TableOfContents.js";
import { list, object, proseNodes, readSectionContent, required, SectionContentError, text, type SectionContent, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const articleInputs: SectionRendererInputs = { slots: ["body", "toc"], members: [] };

function tocNode(content: SectionContent): ReactNode {
  const value = content.values.toc;
  if (value === undefined) return undefined;
  const toc = object(content, value, "toc");
  const items = list(content, toc.items, "toc.items").map((row, index): TableOfContentsItem => {
    const item = object(content, row, `toc.items.${index}`);
    const id = text(content, item.id, `toc.items.${index}.id`), label = text(content, item.label, `toc.items.${index}.label`);
    if (item.level === undefined) return { id, label };
    if (item.level !== 2 && item.level !== 3) throw new SectionContentError(content.leaf, `toc.items.${index}.level must be 2 or 3`);
    return { id, label, level: item.level };
  });
  return <TableOfContents label={text(content, toc.label, "toc.label")} items={items} />;
}

export function renderArticleSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.article", articleInputs);
  const toc = tocNode(content);
  return <ArticleBody {...(toc === undefined ? {} : { toc })}>{proseNodes(content, required(content, "body"), "body")}</ArticleBody>;
}
