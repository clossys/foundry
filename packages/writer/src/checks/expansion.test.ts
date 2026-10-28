import { describe, expect, it } from "vitest";
import { parseIcuMessage } from "../icu/parse.js";
import type { LexiconRecord, StringRecord, WriterLibrary, WriterRecord } from "../model/types.js";
import { checkWriterExpansion, writerPseudoLocale } from "./expansion.js";

const string = (text: string, extra: Partial<StringRecord> = {}): StringRecord => ({ id: "st.0000000001", leaf: "strings.actions", context: "Example", status: "draft", origin: "authored", text, ...extra });
const library = (records: WriterRecord[], dir: "ltr" | "rtl" = "ltr"): WriterLibrary => ({
  manifest: { consumer: "example", defaultLocale: "en", locales: [{ tag: "en", dir, state: "active" }], fallback: {}, strategist: { path: "strategy" }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } },
  locales: { en: { records, documents: [] } },
});
const expansion = (value: Record<string, unknown>): LexiconRecord => ({ id: "lx.0000000001", leaf: "lexicon.expansion", context: "Example", status: "draft", origin: "authored", kind: "format", format: "expansion", value });

describe("Writer WR9 derived pseudo expansion", () => {
  it("fails on newly overflowing pseudo text and identifies the exact record/field", () => {
    const input = library([string("abcd", { limits: { maxChars: 5 } })]);
    const before = structuredClone(input);
    const report = writerPseudoLocale(input);
    expect(report).toMatchObject({ kind: "writer-pseudo", locale: "en-XA", locales: [{ sourceLocale: "en", factor: 1.35, fields: [{ original: { chars: 4 }, expanded: { chars: 6 }, overflow: ["6 characters exceeds 5"] }] }] });
    expect(checkWriterExpansion(input)).toEqual([expect.objectContaining({ code: "WR9", severity: "error", recordId: "st.0000000001", field: "text" })]);
    expect(input).toEqual(before);
    expect(Object.keys(input.locales)).toEqual(["en"]);
  });

  it("records existing overflow without reporting it as a new WR9 failure", () => {
    const input = library([string("abcde", { limits: { maxChars: 4 } })]);
    expect(writerPseudoLocale(input).locales[0]?.fields[0]?.actualOverflow).toEqual(["5 characters exceeds 4"]);
    expect(checkWriterExpansion(input)).toEqual([]);
  });

  it("expands only ICU literal wording while preserving placeholders, selectors and nesting", () => {
    const text = "{count, plural, offset:1 one {One {person}} other {# {kind, select, short {item} other {items}}}}";
    const report = writerPseudoLocale(library([string(text)]));
    const pseudo = report.locales[0]!.fields[0]!.text;
    expect(parseIcuMessage(pseudo).issues).toEqual([]);
    expect(parseIcuMessage(pseudo).arguments).toEqual(parseIcuMessage(text).arguments);
    expect(pseudo).toContain("offset:1"); expect(pseudo).toContain("one {"); expect(pseudo).toContain("other {"); expect(pseudo).toContain("#");
    expect(pseudo).not.toContain("{pérsón}");
  });

  it("honors the precise locale expansion factor config and an explicit diagnostic override", () => {
    const input = library([string("abcd", { limits: { maxChars: 5 } }), expansion({ factor: 1 })]);
    expect(checkWriterExpansion(input)).toEqual([]);
    expect(writerPseudoLocale(input).locales[0]?.factor).toBe(1);
    expect(checkWriterExpansion(input, { pseudoFactor: 2 })).toContainEqual(expect.objectContaining({ code: "WR9", recordId: "st.0000000001" }));
    for (const value of [{ factor: 0.5 }, { factor: 5 }, { factor: 1, unknown: true }, {}]) {
      expect(checkWriterExpansion(library([expansion(value)]))).toContainEqual(expect.objectContaining({ code: "WR9", severity: "error" }));
    }
    expect(checkWriterExpansion(input, { pseudoFactor: Infinity })).toContainEqual(expect.objectContaining({ path: "options.pseudoFactor", severity: "error" }));
  });

  it("preserves authored apostrophes, braces and literal pound signs in derived ICU", () => {
    for (const text of ["#", "'{}'", "'{''}'", "{n, plural, other {'#' items}}", "Example's '{word}'"]) {
      const row = writerPseudoLocale(library([string(text)]), { pseudoFactor: 1 }).locales[0]!.fields[0]!;
      const pseudo = row.text;
      expect(parseIcuMessage(pseudo).issues).toEqual([]);
      expect(parseIcuMessage(pseudo).arguments).toEqual(parseIcuMessage(text).arguments);
      expect(row.expanded).toEqual(row.original);
    }
  });

  it("never pseudo-localizes external-origin text or counts runtime argument names against a cap", () => {
    expect(writerPseudoLocale(library([string("external", { origin: "external" })])).locales[0]?.fields).toEqual([]);
    expect(checkWriterExpansion(library([string("{veryLongRuntimeArgumentName}", { limits: { maxChars: 1 } })]))).toEqual([]);
  });

  it("measures a mixed pattern reference in full under the bounded container default", () => {
    const input = library([
      string("External", { origin: "external" }),
      { id: "pt.0000000001", leaf: "patterns.headline-subhead", context: "Example", status: "draft", origin: "authored", parts: { headline: { ref: { kind: "string", id: "st.0000000001" } }, subhead: { text: "Example" } } },
      { id: "ps.0000000001", leaf: "passages.access-matrix", schema: "passages.access-matrix", schemaDigest: "Example", context: "Example", status: "draft", origin: "authored", fields: { "header.heading": { ref: "pattern", id: "pt.0000000001" } } },
    ]);
    const row = writerPseudoLocale(input).locales[0]!.fields.find(field => field.recordId === "ps.0000000001")!;
    expect(row.text).toContain("Éxtérnál\n");
    expect(row.text).toContain("Éxámplé");
    expect(row.original.chars).toBe(16);
  });

  it("requires explicit logical-property support for every RTL narrative frame", () => {
    const input = library([{ id: "nr.0000000001", leaf: "narratives.page-story", context: "Example", status: "draft", origin: "authored", frame: { frameId: "frames.example" }, passages: [] }], "rtl");
    expect(checkWriterExpansion(input)).toContainEqual(expect.objectContaining({ code: "WR9", severity: "error", field: "frame.frameId" }));
    const evidence = { version: "1", assets: [], leaves: [], frames: [{ id: "frames.example", logicalProperties: true }] };
    expect(checkWriterExpansion(input, { designerLibraries: [evidence] })).toEqual([]);
    expect(checkWriterExpansion(input, { designerLibraries: [{ ...evidence, frames: [{ id: "frames.example", logicalProperties: false }] }] })).toHaveLength(1);
    expect(checkWriterExpansion(input, { designerLibraries: [{ ...evidence, frames: [{ id: "frames.example" }] }] })).toHaveLength(1);
  });
});
