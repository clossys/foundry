import { describe, expect, it } from "vitest";
import type { PassageRecord, WriterLibrary, WriterRecord, WriterShapeIssue } from "../model/types.js";
import { validateWriterRecord } from "../model/validate.js";
import { checkWriterPurity, writerPurityShapeFindings } from "./purity.js";

const base = { context: "Example", status: "draft", origin: "authored" } as const;
const passage = (): PassageRecord => ({ ...base, id: "ps.0000000001", leaf: "passages.hero", schema: "passages.hero", schemaDigest: "unverified", fields: {
  heading: { ref: "string", id: "st.0000000001" },
  body: [{ ref: "term", id: "lx.0000000001" }, { ref: "pattern", id: "pt.0000000001", part: "headline" }],
} });
const library = (records: readonly unknown[]): WriterLibrary => ({
  manifest: { consumer: "example", messageSyntax: "icu-mf1", defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {}, strategy: { root: "strategy", contract: "writer.messaging" },
    leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } },
  locales: { en: { records: records as WriterRecord[], documents: [] } },
});

describe("WR4 reference-only composition", () => {
  it("accepts direct, pattern-part and array refs in passages and chrome", () => {
    expect(checkWriterPurity(library([passage(), { ...base, id: "nr.0000000001", leaf: "narratives.site-chrome", frame: { frameId: "site", configId: "main" }, regions: {
      footer: { copyright: { ref: "string", id: "st.0000000001" } },
    } }]))).toEqual([]);
  });

  it("allows several pages to reuse the same passage without bindings", () => {
    const pages = ["nr.0000000001", "nr.0000000002"].map(id => ({ ...base, id, leaf: "narratives.page-story", frame: { frameId: "page" }, passages: ["ps.0000000001"] }));
    expect(checkWriterPurity(library([passage(), ...pages]))).toEqual([]);
  });

  it.each(["Inline copy", { text: "Inline copy" }, { ref: "string", id: "st.0000000001", text: "Inline copy" }, null, [[{ ref: "string", id: "st.0000000001" }]]].map(reference => ({ reference })))("rejects inline or malformed passage values: $reference", ({ reference }) => {
    const findings = checkWriterPurity(library([{ ...passage(), fields: { heading: reference } }]));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]).toMatchObject({ code: "WR4", severity: "error", locale: "en", recordId: "ps.0000000001", field: "heading" });
    expect(findings[0]!.path).toContain(".fields.heading");
  });

  it.each([
    { ref: "passage", id: "ps.0000000002", field: "heading" },
    { ref: "string", id: "ps.0000000002" },
    { ref: "string", id: "st.0000000001", field: "heading" },
  ])("rejects references that reach into another passage: %j", reference => {
    const findings = checkWriterPurity(library([{ ...passage(), fields: { heading: reference } }]));
    expect(findings).toContainEqual(expect.objectContaining({ code: "WR4", severity: "error", message: expect.stringContaining("another passage") }));
  });

  it("rejects inline chrome refs and malformed field maps defensively", () => {
    const chrome = { ...base, id: "nr.0000000001", leaf: "narratives.app-chrome", frame: { frameId: "app", configId: "main" }, regions: { header: { title: "Inline title" } } };
    expect(checkWriterPurity(library([chrome]))).toContainEqual(expect.objectContaining({ code: "WR4", field: "header.title", path: "locales.en.records.nr.0000000001.regions.header.title" }));
    for (const record of [{ ...passage(), fields: null }, { ...chrome, regions: [] }, { ...chrome, regions: { header: null } }]) {
      expect(checkWriterPurity(library([record])).length).toBeGreaterThan(0);
    }
  });

  it("lets inline strings, pattern parts and long-form blocks remain authored copy", () => {
    expect(checkWriterPurity(library([
      { ...base, id: "st.0000000001", leaf: "strings.button-label", text: "Continue" },
      { ...base, id: "pt.0000000001", leaf: "patterns.headline-subhead", parts: { headline: { text: "Hello" } } },
      { ...base, id: "nr.0000000001", leaf: "narratives.article", title: "Article", frame: { frameId: "article" }, blocks: [{ type: "paragraph", text: "Authored prose" }] },
    ]))).toEqual([]);
  });
});

describe("WR4 classification of WR1 loader issues", () => {
  it("classifies inline and cross-passage ref errors already rejected by WR1", () => {
    for (const reference of ["Inline copy", { ref: "passage", id: "ps.0000000002", field: "heading" }]) {
      const issues = validateWriterRecord({ ...passage(), fields: { heading: reference } }, "passages", "en/passages/hero.json[0]");
      expect(issues.length).toBeGreaterThan(0);
      const findings = writerPurityShapeFindings(issues);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every(finding => finding.code === "WR4" && finding.path.startsWith("en/passages/hero.json[0].fields.heading"))).toBe(true);
    }
  });

  it("classifies chrome-region ref grammar without relabeling other WR1 failures", () => {
    const issues: WriterShapeIssue[] = [
      { code: "WR1", path: "en/narratives/site.json.regions.header.title", message: "Expected a passage reference" },
      { code: "WR1", path: "en/passages/hero.json[0].schemaDigest", message: "Expected a string" },
      { code: "WR1", path: "en/passages/hero.json[0].binding", message: "Unknown field" },
      { code: "WR1", path: "en/strings/ui.json[0].fields.title", message: "Unknown field" },
      { code: "load", path: "en/passages/hero.json[0].fields.title", message: "Unable to read library source." },
      { code: "WR1", path: "en/passages/hero.json[0].fields.title", message: "Unrelated future validation rule" },
    ];
    expect(writerPurityShapeFindings(issues)).toEqual([
      expect.objectContaining({ code: "WR4", severity: "error", path: "en/narratives/site.json.regions.header.title" }),
    ]);
  });
});
