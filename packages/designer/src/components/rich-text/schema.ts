import { ReactMarkViewRenderer, ReactNodeViewRenderer } from "@tiptap/react";
import { Markdown } from "@tiptap/markdown";
import { RichTextStarterKit, RichTextTableKit, RichTextCalloutNode, RichTextBadgeMark } from "./document-schema.js";
export { richTextDocument, type RichTextValue } from "./document-schema.js";
import { RICH_TEXT_HEADINGS, RICH_TEXT_PARAGRAPH, RICH_TEXT_BULLETS, RICH_TEXT_ORDERED, RICH_TEXT_ITEM, RICH_TEXT_QUOTE, RICH_TEXT_PRE, RICH_TEXT_CODE, RICH_TEXT_CALLOUT, RICH_TEXT_RULE } from "./styles.js";
import { RichTextLinkView, RichTextBadgeView, RichTextCodeView, RichTextCodeBlockView, RichTextCalloutView, RichTextTableView } from "./editor-views.js";
import { DOCUMENT_TABLE_ROW_CLASS, DOCUMENT_TABLE_CELL_CLASS, DOCUMENT_TABLE_HEADER_CLASS } from "../Table.document.js";

const ProseStarterKit = RichTextStarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map(extension => {
      if (extension.name === "link") return extension.extend({ addMarkView: () => ReactMarkViewRenderer(RichTextLinkView) });
      if (extension.name === "code") return extension.extend({ addMarkView: () => ReactMarkViewRenderer(RichTextCodeView) });
      if (extension.name === "codeBlock") return extension.extend({ addNodeView: () => ReactNodeViewRenderer(RichTextCodeBlockView, { contentDOMElementTag: "span" }) });
      return extension.name === "heading" ? extension.extend({
      renderHTML({ node, HTMLAttributes }: { node: { attrs: Record<string, unknown> }; HTMLAttributes: Record<string, unknown> }) {
        const level = Number(node.attrs.level);
        return [`h${level}`, { ...HTMLAttributes, class: RICH_TEXT_HEADINGS[level] }, 0] as [string, Record<string, unknown>, 0];
      },
      }) : extension;
    });
  },
});
const ProseTableKit = RichTextTableKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map(extension => extension.name === "table" ? extension.extend({
      addNodeView: () => ReactNodeViewRenderer(RichTextTableView, { contentDOMElementTag: "tbody" }),
    }) : extension);
  },
});

/** React Aria has no rich-text engine. This leaf alone uses MIT Tiptap 3. */
const Callout = RichTextCalloutNode.extend({
  renderHTML: () => ["aside", { "data-rich-text-callout": "", class: RICH_TEXT_CALLOUT, style: "border-inline-start-width:var(--ui-border-hairline);border-inline-start-style:solid" }, 0],
  addNodeView: () => ReactNodeViewRenderer(RichTextCalloutView),
});
const Badge = RichTextBadgeMark.extend({
  addMarkView: () => ReactMarkViewRenderer(RichTextBadgeView),
});

export const richTextExtensions = [ProseStarterKit.configure({
  link: { openOnClick: false },
  paragraph: { HTMLAttributes: { class: RICH_TEXT_PARAGRAPH } },
  bulletList: { HTMLAttributes: { class: RICH_TEXT_BULLETS } },
  orderedList: { HTMLAttributes: { class: RICH_TEXT_ORDERED } },
  listItem: { HTMLAttributes: { class: RICH_TEXT_ITEM } },
  blockquote: { HTMLAttributes: { class: RICH_TEXT_QUOTE, style: "border-inline-start-width:var(--ui-border-hairline);border-inline-start-style:solid" } },
  codeBlock: { HTMLAttributes: { class: RICH_TEXT_PRE } },
  code: { HTMLAttributes: { class: RICH_TEXT_CODE } },
  horizontalRule: { HTMLAttributes: { class: RICH_TEXT_RULE } },
}), ProseTableKit.configure({
  table: { resizable: false },
  tableRow: { HTMLAttributes: { class: DOCUMENT_TABLE_ROW_CLASS } },
  tableHeader: { HTMLAttributes: { class: DOCUMENT_TABLE_HEADER_CLASS, scope: "col" } },
  tableCell: { HTMLAttributes: { class: DOCUMENT_TABLE_CELL_CLASS } },
}), Callout, Badge, Markdown];
