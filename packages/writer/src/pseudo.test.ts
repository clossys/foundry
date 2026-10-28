import { describe, expect, it } from "vitest";
import { pseudoLocalize, pseudoLocaleFields } from "./pseudo.js";
import { directionFor } from "./locale.js";
import { parseIcuMessage } from "./icu/parse.js";
import type { WriterLibrary } from "./model/types.js";
import { writerPseudoLocale } from "./checks/expansion.js";

const library = (): WriterLibrary => ({
  manifest: { consumer: "example", messageSyntax: "icu-mf1", defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {}, strategist: { path: "strategy" }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } },
  locales: { en: { records: [
    { id: "st.0000000001", leaf: "strings.actions", context: "Example", status: "draft", origin: "authored", text: "Welcome {name}" },
    { id: "ps.0000000001", leaf: "passages.access-matrix", schema: "passages.access-matrix", schemaDigest: "example", context: "Example", status: "draft", origin: "authored", fields: { heading: { ref: "string", id: "st.0000000001" } } },
  ], documents: [] } },
});

describe("preview-only pseudo locales", () => {
  for (const locale of ["en-XA", "ar-XB"] as const) {
    it(`preserves ICU blocks and tags byte-exact in ${locale}`, () => {
      const plural = "{count, plural, one {# item} other {{gender, select, other {# items}}}}";
      const text = `Welcome <strong title=\"Hello > there\">{name}</strong> ${plural}`;
      const result = pseudoLocalize(text, locale);
      for (const protectedText of [plural, "{name}", '<strong title="Hello > there">', "</strong>"]) expect(result).toContain(protectedText);
      expect(parseIcuMessage(result).arguments).toEqual(parseIcuMessage(text).arguments);
      expect(parseIcuMessage(result).issues).toEqual([]);
    });
  }
  it("accents and expands plain copy approximately 35%, with brackets", () => {
    const source = "Welcome to the example preview. ".repeat(10);
    const result = pseudoLocalize(source, "en-XA");
    expect(result.startsWith("[")).toBe(true);
    expect(result.endsWith("]")).toBe(true);
    expect(result).toContain("Wélcómé");
    expect([...result].length / source.length).toBeGreaterThanOrEqual(1.35);
    expect([...result].length / source.length).toBeLessThan(1.37);
  });
  it("mirrors RTL wording and brackets within explicit bidi wrapping", () => {
    expect(pseudoLocalize("Hello (world)", "ar-XB")).toBe("\u200f\u202e(dlrow) olleH\u202c\u200f");
  });
  it("derives string and passage fields without changing or approving the library", () => {
    const source = library(), before = structuredClone(source);
    const result = pseudoLocaleFields(source, "ar-XB");
    expect(result.locale).toEqual({ tag: "ar-XB", dir: "rtl", state: "pseudo" });
    expect(directionFor("ar-XB", { ...source.manifest, locales: [...source.manifest.locales, result.locale] })).toBe("rtl");
    expect(result.fields.map(row => row.recordId)).toEqual(["st.0000000001", "ps.0000000001"]);
    expect(result.fields.every(row => row.text.includes("{name}"))).toBe(true);
    expect(source).toEqual(before);
  });
  it("shares the literal expansion used by WR9", () => {
    const source = library();
    const record = source.locales.en!.records[0]!;
    if (!("text" in record)) throw new Error("Expected string fixture");
    record.text = "abcd";
    expect(writerPseudoLocale(source).locales[0]!.fields[0]!.text).toBe(pseudoLocalize("abcd", "en-XA").slice(1, -1));
  });
  it("refuses malformed ICU, unsupported locales and non-English sources", () => {
    expect(() => pseudoLocalize("Hello {name", "en-XA")).toThrow();
    expect(() => pseudoLocalize("Hello", "fr" as "en-XA")).toThrow();
    expect(() => pseudoLocaleFields(library(), "en-XA", "fr")).toThrow();
  });
});
