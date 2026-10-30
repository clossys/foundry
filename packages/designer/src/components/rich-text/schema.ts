import { Mark, Node, getSchema, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { RICH_TEXT_HEADINGS, RICH_TEXT_PARAGRAPH, RICH_TEXT_BULLETS, RICH_TEXT_ORDERED, RICH_TEXT_ITEM, RICH_TEXT_QUOTE, RICH_TEXT_PRE, RICH_TEXT_CODE, RICH_TEXT_CALLOUT, RICH_TEXT_RULE } from "./styles.js";

const ProseStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map(extension => extension.name === "heading" ? extension.extend({
      renderHTML({ node, HTMLAttributes }: { node: { attrs: Record<string, unknown> }; HTMLAttributes: Record<string, unknown> }) {
        const level = Number(node.attrs.level);
        return [`h${level}`, { ...HTMLAttributes, class: RICH_TEXT_HEADINGS[level] }, 0] as [string, Record<string, unknown>, 0];
      },
    }) : extension);
  },
});

/** React Aria has no rich-text engine. This leaf alone uses MIT Tiptap 3. */
const Callout = Node.create({
  name: "callout", group: "block", content: "block+",
  parseHTML: () => [{ tag: "aside[data-rich-text-callout]" }],
  renderHTML: () => ["aside", { "data-rich-text-callout": "", class: RICH_TEXT_CALLOUT, style: "border-inline-start-width:var(--ui-border-hairline);border-inline-start-style:solid" }, 0],
});
const Badge = Mark.create({
  name: "badge",
  parseHTML: () => [{ tag: "span[data-rich-text-badge]" }],
  renderHTML: () => ["span", { "data-rich-text-badge": "" }, 0],
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
}), TableKit.configure({ table: { resizable: false } }), Callout, Badge, Markdown];
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
