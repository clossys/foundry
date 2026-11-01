import { describe, expect, it } from "vitest";
import { parseWriterCell, serializeWriterCell } from "./cells/parse.js";
import { parseWriterSlotBody, WriterSlotBodyParseError } from "./slot-body.js";

const head = (id = "title-1", context = "example.hero.title", metadata: Record<string, unknown> = {}) =>
  `### ${context}\n<!-- ${JSON.stringify({ id, ...metadata })} -->\n`;
const body = (text: string) => `## en\n${head()}${text}`;

describe("parseWriterSlotBody", () => {
  it("reads native F7-shaped bodies with ordered locales, records, paths and opaque metadata", () => {
    const binding = { target: "hero.subtitle", kind: "CopyRef", recordId: "original", extension: { offsets: [1, 2] } };
    const source = [
      "## en-GB",
      head("title-1", "example.hero.title", { limits: { maxChars: 60 }, bindings: ["hero.title", binding, "hero.summary"], extension: { locale: "opaque", values: [null, false] } }) + "Choose a next step\n",
      head("title-2", "example.hero.title", { bindings: [] }) + " Another heading \n",
      "## ar",
      head("title-1", "example.hero.title", { bindings: ["hero.title"] }) + "خطوتك التالية\n",
    ].join("\n");
    expect(parseWriterSlotBody(source, ["en-GB", "ar"])).toEqual([
      { locale: "en-GB", record: { id: "title-1", context: "example.hero.title", limits: { maxChars: 60 }, extension: { locale: "opaque", values: [null, false] }, text: "Choose a next step" }, bindings: ["hero.title", binding, "hero.summary"] },
      { locale: "en-GB", record: { id: "title-2", context: "example.hero.title", text: " Another heading " }, bindings: [] },
      { locale: "ar", record: { id: "title-1", context: "example.hero.title", text: "خطوتك التالية" }, bindings: ["hero.title"] },
    ]);
  });

  it("decodes one escape for headings, HTML comments, backslashes and literal JSON fences", () => {
    const escaped = ["\\## literal locale", "\\### literal context", "\\<!-- literal comment -->", "\\\\one slash", "\\\\\\two slashes", "\\```json", '{"literal":true}', "```"].join("\n");
    const row = parseWriterSlotBody(body(`${escaped}\n\n`), ["en"])[0]!;
    expect(row.record.text).toBe(["## literal locale", "### literal context", "<!-- literal comment -->", "\\one slash", "\\\\two slashes", "```json", '{"literal":true}', "```"].join("\n"));
    expect(row.bindings).toEqual([]);
  });

  it.each([
    ["first\nlast", "first\nlast"],
    ["first\nlast\n", "first\nlast"],
    ["first\nlast\n\n", "first\nlast"],
    ["first\nlast\n\n\n", "first\nlast\n"],
    ["\n\n  first  \n\nlast\n\n\n\n", "\n\n  first  \n\nlast\n\n"],
    ["", ""],
    ["\n\n", ""],
    ["\n\n\n", "\n"],
  ])("preserves text and separator fidelity for %j", (serialized, expected) => {
    expect(parseWriterSlotBody(body(serialized), ["en"])[0]!.record.text).toBe(expected);
  });

  it("preserves text blank lines before the next record and normalizes only CRLF line endings", () => {
    const source = body(`\nfirst\n\n\n${head("title-2", "  exact context  ")}second\n\n`);
    const rows = parseWriterSlotBody(source.replaceAll("\n", "\r\n"), ["en"]);
    expect(rows.map(row => row.record.text)).toEqual(["\nfirst\n", "second"]);
    expect(rows[1]!.record.context).toBe("  exact context  ");
  });

  it("retains all metadata and payload fields of textless JSON without fabricating text", () => {
    const payload = { id: "pattern-1", context: "example.hero.pattern", shared: { b: 2, a: 1 }, parts: { heading: { text: "Choose" } }, bindingNote: null };
    const source = `## en\n${head("pattern-1", "example.hero.pattern", { bindings: ["hero.pattern"], metadataOnly: true, shared: { a: 1, b: 2 } })}\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\n`;
    expect(parseWriterSlotBody(source, ["en"])).toEqual([
      { locale: "en", record: { ...payload, metadataOnly: true }, bindings: ["hero.pattern"] },
    ]);
    expect(parseWriterSlotBody(source, ["en"])[0]!.record).not.toHaveProperty("text");
  });

  it("agrees with legacy serialized body text and object bindings without changing the cell contract", () => {
    const cell = {
      id: "sample.hero", version: 1, status: "draft" as const, updated: "2026-10-29", links: [], locales: ["en", "ar"],
      records: [
        { locale: "en", record: { id: "title-1", context: "sample.hero.title", text: "\n## title\n<!-- comment -->\n\\slash\n```json\n\n" }, bindings: [{ target: "hero.title", extension: true }] },
        { locale: "ar", record: { id: "pattern-1", context: "sample.hero.pattern", parts: { text: "example" } }, bindings: [] },
      ],
    };
    const source = serializeWriterCell(cell);
    const nativeBody = source.slice(source.indexOf("\n## en") + 1);
    expect(parseWriterSlotBody(nativeBody, cell.locales)).toEqual(cell.records);
    expect(parseWriterCell(source).records).toEqual(cell.records);
  });

  it("retains agreeing textless payload bindings and rejects bindings absent from metadata", () => {
    const payload = { id: "title-1", context: "example.hero.title", bindings: ["hero.title"] };
    const content = `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
    const source = `## en\n${head("title-1", "example.hero.title", { bindings: ["hero.title"] })}${content}`;
    expect(parseWriterSlotBody(source, ["en"])[0]).toEqual({ locale: "en", record: payload, bindings: ["hero.title"] });
    expect(() => parseWriterSlotBody(body(content), ["en"])).toThrow(/conflicts.*bindings/);
  });

  it.each([
    ["metadata JSON", '## en\n### example.title\n<!-- {bad} -->\ntext', 3, /Invalid record metadata JSON/],
    ["missing metadata", "## en\n### example.title\ntext", 3, /one-line JSON record metadata/],
    ["metadata id", '## en\n### example.title\n<!-- {"id":""} -->', 3, /metadata with id/],
    ["metadata array", '## en\n### example.title\n<!-- [] -->', 3, /metadata with id/],
    ["metadata context", '## en\n### example.title\n<!-- {"id":"x","context":"other"} -->', 3, /metadata with id/],
    ["metadata text", '## en\n### example.title\n<!-- {"id":"x","text":"lost"} -->', 3, /metadata with id/],
    ["heading without locale", head() + "text", 1, /locale or record heading/],
    ["empty heading", '## en\n### \n<!-- {"id":"x"} -->', 2, /locale or record heading/],
    ["undeclared locale", "## fr\n" + head() + "text", 1, /locale section/],
    ["repeated locale", body("text\n\n## en\n"), 6, /locale section/],
    ["duplicate id", body("first\n\n" + head() + "second"), 7, /Repeated record id/],
    ["comment in text", body("text\n<!-- {} -->"), 5, /Escape structural text/],
    ["invalid heading in text", body("text\n#### other"), 5, /Escape structural text/],
  ])("rejects %s with a specific body line", (_label, source, line, message) => {
    try {
      parseWriterSlotBody(source as string, ["en"]);
      expect.fail("Malformed body returned partial success");
    } catch (error) {
      expect(error).toBeInstanceOf(WriterSlotBodyParseError);
      expect((error as WriterSlotBodyParseError).line).toBe(line);
      expect((error as Error).message).toMatch(message as RegExp);
    }
  });

  it.each([null, {}, "hero.title", [null], [1], [false], [[]], [""]])("rejects malformed bindings %j", bindings => {
    expect(() => parseWriterSlotBody(`## en\n${head("x", "example.title", { bindings })}text`, ["en"])).toThrow(/:3: Invalid record bindings/);
  });

  it.each([[], ["en", "en"], ["en "], ["en_US"]])("rejects malformed declared locales %j", locales => {
    expect(() => parseWriterSlotBody(body("text"), locales)).toThrow(/:1: Expected unique locale tags/);
  });

  it("reports a typed parse error for a non-string runtime body", () => {
    expect(() => parseWriterSlotBody(null as unknown as string, ["en"])).toThrow(WriterSlotBodyParseError);
    expect(() => parseWriterSlotBody(null as unknown as string, ["en"])).toThrow(/:1: Expected body string/);
  });

  it("rejects missing and reordered sections instead of returning records from only some locales", () => {
    expect(() => parseWriterSlotBody(body("text"), ["en", "ar"])).toThrow(/Locale sections must match/);
    expect(() => parseWriterSlotBody("## ar\n" + head() + "text\n\n## en\n", ["en", "ar"])).toThrow(/:1:.*locale section/);
  });

  it.each([
    [{ id: "wrong", context: "example.hero.title" }, /disagrees/],
    [{ id: "title-1", context: "wrong" }, /disagrees/],
    [{ id: "title-1", context: "example.hero.title", text: "lost" }, /disagrees/],
    [{ id: "title-1", context: "example.hero.title", extension: false }, /conflicts.*extension/],
    [{ id: "title-1", context: "example.hero.title", bindings: ["other"] }, /conflicts.*bindings/],
  ])("rejects textless identity or metadata conflicts %j", (value, message) => {
    const source = `## en\n${head("title-1", "example.hero.title", { extension: true, bindings: ["hero.title"] })}\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
    expect(() => parseWriterSlotBody(source, ["en"])).toThrow(message);
  });

  it("rejects malformed, unclosed or trailing textless JSON", () => {
    expect(() => parseWriterSlotBody(body("```json\n{bad}\n```"), ["en"])).toThrow(/:4: Invalid textless/);
    expect(() => parseWriterSlotBody(body("```json\n{}"), ["en"])).toThrow(/:4: Unclosed textless/);
    expect(() => parseWriterSlotBody(body('```json\n{"id":"title-1","context":"example.hero.title"}\n```\nextra'), ["en"])).toThrow(/:7: Expected heading after/);
  });
});
