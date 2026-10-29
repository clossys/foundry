import { describe, expect, it } from "vitest";
import { loadWriterCatalog } from "../catalog/ia/index.js";
import type { PassageRecord, PatternInstance, StringRecord, WriterLibrary, WriterRecord } from "../model/types.js";
import { checkWriterLength, measureWriterText, writerTextFields } from "./length.js";

const string = (text: string, extra: Partial<StringRecord> = {}): StringRecord => ({ id: "st.0000000001", leaf: "strings.actions", context: "Example", status: "draft", origin: "authored", text, ...extra });
const library = (records: WriterRecord[], targets: Record<string, WriterRecord[]> = {}): WriterLibrary => ({
  manifest: { consumer: "example", messageSyntax: "icu-mf1", defaultLocale: "en", locales: ["en", ...Object.keys(targets)].map(tag => ({ tag, dir: "ltr", state: "active" })), fallback: {}, strategy: { root: "strategy", contract: "writer.messaging" }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } },
  locales: Object.fromEntries(Object.entries({ en: records, ...targets }).map(([tag, values]) => [tag, { records: values, documents: [] }])),
});

describe("Writer WR7 field length", () => {
  it("uses record narrows and refuses a record override that widens its leaf ceiling", () => {
    expect(checkWriterLength(library([string("abcdef", { limits: { maxChars: 5 } })]))).toContainEqual(expect.objectContaining({ code: "WR7", field: "text" }));
    expect(checkWriterLength(library([string("x".repeat(41), { limits: { maxChars: 100 } })]))).toHaveLength(1);
    expect(checkWriterLength(library([string("short")]))).toEqual([]);
  });

  it("inherits source record caps unless the translated record explicitly supplies its cap", () => {
    const source = string("abc", { limits: { maxChars: 4 } });
    const translated = string("abcde");
    expect(checkWriterLength(library([source], { fr: [translated] }))).toContainEqual(expect.objectContaining({ locale: "fr", code: "WR7" }));
    expect(checkWriterLength(library([source], { fr: [{ ...translated, limits: { maxChars: 6 } }] }))).toEqual([]);
  });

  it("reads actual derived passage field maxLength by locale, then source cap, including repeated refs", () => {
    const catalog = loadWriterCatalog();
    const schema = catalog.slots.find(slot => slot.id === "passages.access-matrix")!;
    const copy = schema.contract.copy as { sourceLocale: string; fields: { key: string; maxLength: Record<string, number> }[] };
    const field = copy.fields.find(item => item.key === "roles[].label")!;
    field.maxLength = { en: 4, de: 6 };
    const passage: PassageRecord = { id: "ps.0000000001", leaf: "passages.access-matrix", schema: "passages.access-matrix", schemaDigest: "example", context: "Example", status: "draft", origin: "authored", fields: { "roles[].label": [{ ref: "string", id: "st.0000000001" }] } };
    const value = string("abcde");
    const findings = checkWriterLength(library([string("abc"), passage], { de: [value, passage], fr: [value, passage] }), { catalog });
    expect(findings).toEqual([expect.objectContaining({ locale: "fr", recordId: passage.id, field: "fields.roles[].label[0]" })]);
  });

  it("resolves pattern/string and passage/term references against the containing locale", () => {
    const pattern: PatternInstance = { id: "pt.0000000001", leaf: "patterns.primary-action", context: "Example", origin: "authored", status: "draft", parts: { verb: { ref: { kind: "string", id: "st.0000000001" } }, object: { text: "Example" } } };
    const records: WriterRecord[] = [string("x".repeat(25)), pattern, { id: "lx.0000000001", leaf: "lexicon.preferred-terms", context: "Example", origin: "authored", status: "draft", kind: "term", term: "sample", forms: [], termStatus: "preferred", reason: "Example" }];
    const catalog = loadWriterCatalog();
    catalog.slots.push({ id: "passages.example", layer: "passages", status: "draft", requires: [], contract: { copy: { sourceLocale: "en", fields: [{ key: "label", maxLength: { en: 5 } }] } } });
    records.push({ id: "ps.0000000001", leaf: "passages.example", schema: "passages.example", schemaDigest: "example", context: "Example", origin: "authored", status: "draft", fields: { label: { ref: "term", id: "lx.0000000001" } } });
    expect(checkWriterLength(library(records), { catalog }).map(finding => finding.field)).toEqual(["parts.verb", "fields.label"]);
  });

  it("counts Unicode code points and locale word boundaries, measuring the worst ICU branch only", () => {
    expect(measureWriterText("😀😀", "en")).toEqual({ chars: 2, words: 0 });
    expect(measureWriterText("{count, plural, one {a} other {longer text}}", "en")).toEqual({ chars: 11, words: 2 });
    expect(measureWriterText("{person} ab", "en")).toEqual({ chars: 3, words: 1 });
    expect(checkWriterLength(library([string("😀😀", { limits: { maxChars: 2 } })]))).toEqual([]);
    expect(checkWriterLength(library([string("你好世界", { limits: { maxWords: 1 } })]))).toContainEqual(expect.objectContaining({ code: "WR7" }));
  });

  it("does not invent caps for a field with no declared limit or count unresolved references as text", () => {
    const value = string("x".repeat(100));
    const catalog = { placements: [], slots: [] };
    expect(checkWriterLength(library([value]), { catalog })).toEqual([]);
    expect(writerTextFields(library([{ id: "pt.0000000001", leaf: "patterns.headline", context: "Example", origin: "authored", status: "draft", parts: { headline: { ref: { kind: "string", id: "st.0000000002" } } } }]), { catalog })).toEqual([]);
  });

  it("exempts external-origin text and its references while retaining authored limits", () => {
    const external = string("x".repeat(100), { origin: "external", external: { publisher: "Example", reference: "Example", retrievedAt: "Example" } });
    const pattern: PatternInstance = { id: "pt.0000000001", leaf: "patterns.headline", context: "Example", origin: "authored", status: "draft", parts: { headline: { ref: { kind: "string", id: external.id } } } };
    expect(checkWriterLength(library([external, pattern]))).toEqual([]);
    expect(checkWriterLength(library([{ ...external, origin: "authored", external: undefined }, pattern]))).toHaveLength(1);
  });
});
