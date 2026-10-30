// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getSchema, type JSONContent } from "@tiptap/react";
import { MarkdownManager } from "@tiptap/markdown";
import { richTextDocument, richTextDocumentExtensions } from "./document-schema.js";
import { richTextExtensions } from "./schema.js";

const editorSchema = getSchema(richTextExtensions);
const editorMarkdown = new MarkdownManager({ extensions: richTextExtensions });
const paragraph: JSONContent = { type: "paragraph", content: [{ type: "text", text: "Passage" }] };
const table: JSONContent = { type: "table", content: [{ type: "tableRow", content: [
  { type: "tableHeader", attrs: { colspan: 2, rowspan: 1, colwidth: [120, 180] }, content: [paragraph] },
  { type: "tableCell", attrs: { colspan: 1, rowspan: 2, colwidth: [240] }, content: [paragraph] },
] }] };

function documentRules(spec: object): unknown {
  const rules = Object.fromEntries(Object.entries(spec).filter(([name]) => name !== "toDOM" && name !== "parseDOM"));
  return JSON.parse(JSON.stringify(rules, (_key, value: unknown) => typeof value === "function" ? String(value) : value));
}

describe("headless RichText document validation", () => {
  it("runs without browser globals or editor node views", () => {
    expect(typeof document).toBe("undefined");
    expect(richTextDocument("# Passage").content?.[0]?.type).toBe("heading");
    const schema = getSchema(richTextDocumentExtensions);
    expect(Object.keys(schema.nodes)).toEqual(Object.keys(editorSchema.nodes));
    expect(Object.keys(schema.marks)).toEqual(Object.keys(editorSchema.marks));
    for (const kind of ["nodes", "marks"] as const) for (const name of Object.keys(editorSchema[kind])) {
      expect(documentRules(schema[kind][name]!.spec), `${kind}.${name}`).toEqual(documentRules(editorSchema[kind][name]!.spec));
    }
  });

  it("preserves native table attributes and all supported document nodes and marks", () => {
    const value: JSONContent = { type: "doc", content: [
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Heading" }] },
      { type: "paragraph", content: [
        { type: "text", text: "Marked", marks: [{ type: "bold" }, { type: "italic" }, { type: "strike" }, { type: "underline" }, { type: "badge" }] },
        { type: "hardBreak" },
        { type: "text", text: "Link", marks: [{ type: "link", attrs: { href: "https://example.com", target: "_self", rel: "author", class: "reference" } }] },
        { type: "text", text: "code", marks: [{ type: "code" }] },
      ] },
      { type: "bulletList", content: [{ type: "listItem", content: [paragraph] }] },
      { type: "orderedList", attrs: { start: 4 }, content: [{ type: "listItem", content: [paragraph] }] },
      { type: "blockquote", content: [paragraph] },
      { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const ready = true" }] },
      { type: "horizontalRule" },
      { type: "callout", content: [paragraph] },
      table,
    ] };
    const expected = editorSchema.nodeFromJSON(value);
    expected.check();
    const result = richTextDocument(value);
    expect(result).toEqual(expected.toJSON());
    expect(result.content?.at(-1)?.content?.[0]?.content?.[0]?.attrs).toMatchObject({ colspan: 2, rowspan: 1, colwidth: [120, 180] });
    expect(value.content?.[0]?.attrs).toEqual({ level: 3 });
  });

  it.each([
    "# Heading\n\nA **bold** *emphasis* ~~strike~~ [reference](https://example.com) and `code`.",
    "> Quote\n\n- First\n- Second\n\n4. Fourth\n5. Fifth\n\n---",
    "```ts\nconst ready = true\n```\n\n| Goal | State |\n| --- | --- |\n| Read | Ready |",
  ])("parses Markdown with the same native extension semantics: %s", value => {
    const expected = editorSchema.nodeFromJSON(editorMarkdown.parse(value));
    expected.check();
    expect(richTextDocument(value)).toEqual(expected.toJSON());
  });

  it("retains the native rejection of an empty Markdown document", () => {
    expect(() => editorSchema.nodeFromJSON(editorMarkdown.parse("")).check()).toThrow();
    expect(() => richTextDocument("")).toThrow();
  });

  it.each([
    { type: "paragraph", content: [] },
    { type: "doc", content: [{ type: "unknown" }] },
    { type: "doc", content: [{ type: "text", text: "unwrapped" }] },
    { type: "doc", content: [{ type: "paragraph", content: [paragraph] }] },
    { type: "doc", content: [{ type: "callout", content: [] }] },
    { type: "doc", content: [{ type: "table", content: [paragraph] }] },
    { type: "doc", content: [{ type: "tableRow", content: [paragraph] }] },
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Marked", marks: [{ type: "unknown" }] }] }] },
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] },
  ])("rejects malformed native documents: %j", value => {
    expect(() => richTextDocument(value)).toThrow();
    if (value.type === "doc") expect(() => editorSchema.nodeFromJSON(value).check()).toThrow();
  });
});
