import { Mark, Node, getSchema, ReactMarkViewRenderer, ReactNodeViewRenderer, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { RICH_TEXT_HEADINGS, RICH_TEXT_PARAGRAPH, RICH_TEXT_BULLETS, RICH_TEXT_ORDERED, RICH_TEXT_ITEM, RICH_TEXT_QUOTE, RICH_TEXT_PRE, RICH_TEXT_CODE, RICH_TEXT_CALLOUT, RICH_TEXT_RULE } from "./styles.js";
import { RichTextLinkView, RichTextBadgeView, RichTextCodeView, RichTextCodeBlockView, RichTextCalloutView, RichTextTableView } from "./editor-views.js";
import { DOCUMENT_TABLE_ROW_CLASS, DOCUMENT_TABLE_CELL_CLASS, DOCUMENT_TABLE_HEADER_CLASS } from "../Table.document.js";

const ProseStarterKit = StarterKit.extend({
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
const ProseTableKit = TableKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map(extension => extension.name === "table" ? extension.extend({
      addNodeView: () => ReactNodeViewRenderer(RichTextTableView, { contentDOMElementTag: "tbody" }),
    }) : extension);
  },
});

/** React Aria has no rich-text engine. This leaf alone uses MIT Tiptap 3. */
const Callout = Node.create({
  name: "callout", group: "block", content: "block+",
  parseHTML: () => [{ tag: "aside[data-rich-text-callout]" }],
  renderHTML: () => ["aside", { "data-rich-text-callout": "", class: RICH_TEXT_CALLOUT, style: "border-inline-start-width:var(--ui-border-hairline);border-inline-start-style:solid" }, 0],
  addNodeView: () => ReactNodeViewRenderer(RichTextCalloutView),
});
const Badge = Mark.create({
  name: "badge",
  parseHTML: () => [{ tag: "span[data-rich-text-badge]" }],
  renderHTML: () => ["span", { "data-rich-text-badge": "" }, 0],
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
const markdown = new MarkdownManager({ extensions: richTextExtensions });
const schema = getSchema(richTextExtensions);

export type RichTextValue = string | JSONContent;

/** Same parser and ProseMirror schema for static output and the editable engine. */
export function richTextDocument(value: RichTextValue): JSONContent {
  const document = typeof value === "string" ? markdown.parse(value) : value;
  if (document.type !== "doc") throw new TypeError("RichText value must be a Markdown string or a Tiptap doc");
  const node = schema.nodeFromJSON(document);
  node.check();
  return node.toJSON() as JSONContent;
}
