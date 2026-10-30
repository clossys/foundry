import { Mark, Node, getSchema, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Markdown, MarkdownManager } from "@tiptap/markdown";

/** React Aria has no rich-text engine. This leaf alone uses MIT Tiptap 3. */
const Callout = Node.create({
  name: "callout", group: "block", content: "block+",
  parseHTML: () => [{ tag: "aside[data-rich-text-callout]" }],
  renderHTML: () => ["aside", { "data-rich-text-callout": "" }, 0],
});
const Badge = Mark.create({
  name: "badge",
  parseHTML: () => [{ tag: "span[data-rich-text-badge]" }],
  renderHTML: () => ["span", { "data-rich-text-badge": "" }, 0],
});

export const richTextExtensions = [StarterKit.configure({ link: { openOnClick: false } }), TableKit.configure({ table: { resizable: false } }), Callout, Badge, Markdown];
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
