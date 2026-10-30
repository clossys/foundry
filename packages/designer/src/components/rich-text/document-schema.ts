import { Mark, Node, getSchema, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Markdown, MarkdownManager } from "@tiptap/markdown";

/** Schema definitions shared by document validation and the visual editor. */
export const RichTextCalloutNode = Node.create({
  name: "callout", group: "block", content: "block+",
  parseHTML: () => [{ tag: "aside[data-rich-text-callout]" }],
  renderHTML: () => ["aside", { "data-rich-text-callout": "" }, 0],
});
export const RichTextBadgeMark = Mark.create({
  name: "badge",
  parseHTML: () => [{ tag: "span[data-rich-text-badge]" }],
  renderHTML: () => ["span", { "data-rich-text-badge": "" }, 0],
});

export const RichTextStarterKit = StarterKit.configure({ link: { openOnClick: false } });
export const RichTextTableKit = TableKit.configure({ table: { resizable: false } });
export const richTextDocumentExtensions = [RichTextStarterKit, RichTextTableKit, RichTextCalloutNode, RichTextBadgeMark, Markdown];
const markdown = new MarkdownManager({ extensions: richTextDocumentExtensions });
const schema = getSchema(richTextDocumentExtensions);

export type RichTextValue = string | JSONContent;

/** Validate with the native document schema without loading visual editor views. */
export function richTextDocument(value: RichTextValue): JSONContent {
  const document = typeof value === "string" ? markdown.parse(value) : value;
  if (document.type !== "doc") throw new TypeError("RichText value must be a Markdown string or a Tiptap doc");
  const node = schema.nodeFromJSON(document);
  node.check();
  return node.toJSON() as JSONContent;
}
