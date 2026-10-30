/**
 * sections.article: the dataset's prose blocks as ArticleBody children. The optional toc region is a
 * `{ label, items: [{ id, label, level? }] }` record composed through the registered TableOfContents and laid
 * beside the body; its links target the body headings that carry the same ids.
 */
import { Fragment, type ReactNode } from "react";
import { ArticleBody } from "../../blocks/ArticleBody.js";
import { TableOfContents, type TableOfContentsItem } from "../../blocks/TableOfContents.js";
import { list, object, proseNodes, readSectionContent, required, SectionContentError, text, texts, type SectionContent, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const articleInputs: SectionRendererInputs = { slots: ["body", "toc"], members: ["typography.drop-cap"] };

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
  return <TableOfContents label={text(content, toc.label, "toc.label")} items={items} trackCurrent="css" />;
}

/** Editorial kinds reuse existing body[].text/items[] passage fields; ids are non-copy metadata. */
function articleNodes(content: SectionContent, value: Parameters<typeof proseNodes>[1]): ReactNode {
  return list(content, value, "body").map((value, index) => {
    const path = `body.${index}`, block = object(content, value, path);
    const kind = text(content, block.kind, `${path}.kind`);
    if (kind === "pull-quote") {
      const attribution = block.items === undefined ? undefined : texts(content, block.items, `${path}.items`);
      if (attribution && attribution.length !== 1) throw new SectionContentError(content.leaf, `${path}.items must contain one attribution`);
      return <ArticleBody.PullQuote key={index} attribution={attribution?.[0]}>{text(content, block.text, `${path}.text`)}</ArticleBody.PullQuote>;
    }
    if (kind === "figure-caption") return <figure key={index}><ArticleBody.FigureCaption>{text(content, block.text, `${path}.text`)}</ArticleBody.FigureCaption></figure>;
    if (kind === "footnote-reference") return <ArticleBody.FootnoteReference key={index} id={text(content, block.id, `${path}.id`)} noteId={text(content, block.noteId, `${path}.noteId`)}>{text(content, block.text, `${path}.text`)}</ArticleBody.FootnoteReference>;
    if (kind === "footnotes") {
      const notes = texts(content, block.items, `${path}.items`);
      const references = list(content, block.references, `${path}.references`);
      if (notes.length !== references.length) throw new SectionContentError(content.leaf, `${path}.references must match every note`);
      const items = notes.map((body, noteIndex) => { const reference = object(content, references[noteIndex], `${path}.references.${noteIndex}`); return { body, id: text(content, reference.id, `${path}.references.${noteIndex}.id`), referenceId: text(content, reference.referenceId, `${path}.references.${noteIndex}.referenceId`), backlink: noteIndex + 1 }; });
      return <ArticleBody.Footnotes key={index} label={text(content, block.text, `${path}.text`)} items={items} />;
    }
    return <Fragment key={index}>{proseNodes(content, [value], path)}</Fragment>;
  });
}

export function renderArticleSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.article", articleInputs);
  const toc = tocNode(content);
  return <ArticleBody {...(toc === undefined ? {} : { toc })} dropCap={content.members.includes("typography.drop-cap")}>{articleNodes(content, required(content, "body"))}</ArticleBody>;
}
