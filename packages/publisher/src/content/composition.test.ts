import { describe, expect, it } from "vitest";
import { parseComposition, validateComposition, resolveCopy as resolveCopyReport, PAGE_META_KEY, PAGE_META_FIELDS, validateCopyFields } from "./composition.js";

// These compatibility cases retain the resolved text map; ref reports have their own suite.
const resolveCopy = (...args: Parameters<typeof resolveCopyReport>) => resolveCopyReport(...args).copy;

const fixture = () => ({
  frame: { frameId: "frames.sample", configId: "default" },
  libraryVersion: "1",
  sections: [{ key: "intro", sectionId: "sections.sample", configId: "default", intent: "continues",
    fields: [{ key: "title", locale: "en", value: "Sample title", source: "writer" }], assets: [{ assetId: "assets.sample", libraryVersion: "1" }],
    ref: { candidateId: "sample", sectionKey: "intro", revision: "r1" } }],
});

describe("Designer composition shape", () => {
  it("retains section order, Writer copy, and pinned references", () => {
    const value = fixture();
    expect(validateComposition(value)).toEqual([]);
    expect(parseComposition(value)).toEqual(value);
  });
  it("allows draft copy to be empty without claiming required-field completeness", () => {
    const value = fixture(); value.sections[0]!.fields[0]!.value = "";
    expect(validateComposition(value)).toEqual([]);
  });
  it.each([
    ["blank frame", (v: any) => { v.frame.frameId = " "; }, "nonempty-string"],
    ["missing frame config", (v: any) => { delete v.frame.configId; }, "nonempty-string"],
    ["missing library version", (v: any) => { delete v.libraryVersion; }, "nonempty-string"],
    ["floating reference", (v: any) => { v.sections[0].ref.revision = "latest"; }, "pinned-revision"],
    ["duplicate section key", (v: any) => { v.sections.push(structuredClone(v.sections[0])); }, "duplicate-section-key"],
    ["unknown source", (v: any) => { v.sections[0].fields[0].source = "unknown"; }, "writer-source"],
    ["unversioned asset", (v: any) => { delete v.sections[0].assets[0].libraryVersion; }, "nonempty-string"],
    ["layout code", (v: any) => { v.layout = "stack"; }, "unknown-field"],
    ["invalid intent", (v: any) => { v.sections[0].intent = "other"; }, "section-intent"],
    ["non-string copy", (v: any) => { v.sections[0].fields[0].value = 42; }, "string"],
    ["non-array sections", (v: any) => { v.sections = null; }, "array"],
  ])("rejects %s", (_name, mutate, rule) => {
    const value = fixture(); mutate(value);
    expect(validateComposition(value).some(f => f.rule === rule)).toBe(true);
    expect(() => parseComposition(value)).toThrow();
  });
  it.each([null, [], "sample", 4])("rejects non-record %s", value => {
    expect(validateComposition(value)).not.toEqual([]);
  });
  it("requires localized keys and keeps visual assets outside copy", () => {
    for (const change of [
      (v: any) => { delete v.sections[0].fields[0].locale; },
      (v: any) => { v.sections[0].fields[0].locale = "bad_locale"; },
      (v: any) => { v.sections[0].fields[0].assets = []; },
      (v: any) => { v.sections[0].fields[0].text = "Legacy"; },
      (v: any) => { v.sections[0].fields[0].field = "title"; },
    ]) {
      const value = fixture(); change(value);
      expect(validateComposition(value).length).toBeGreaterThan(0);
    }
  });
  it("rejects ambiguous duplicate field keys within a section and locale", () => {
    const value = fixture();
    value.sections[0]!.fields.push({ ...value.sections[0]!.fields[0]! });
    expect(validateComposition(value).map(f => f.rule)).toContain("duplicate-copy-key");
    value.sections[0]!.fields[1]!.locale = "fr";
    expect(validateComposition(value)).toEqual([]);
  });
});

describe("exact-locale Writer copy resolution", () => {
  it.each(["writer", "handwritten"] as const)("rejects %s inline body and metadata in strict admin resolution without projecting their text", source => {
    const composition = parseComposition(fixture());
    const candidate = { composition: { ...composition, sections: [{ ...composition.sections[0]!,
      fields: [{ key: "title", locale: "en", source, value: "Inline body" }] }] },
      pageMeta: [{ key: "title", locale: "en", source, value: "Inline metadata" }] };
    const before = structuredClone(candidate);
    const report = resolveCopyReport(candidate, "en", { requireWriterCopy: true, requirePageMeta: true });
    expect(report.complete).toBe(false);
    expect(report.resolutions).toEqual([]);
    expect(report.copy).toEqual({ intro: {}, [PAGE_META_KEY]: {} });
    expect(report.findings.filter(finding => finding.rule === "legacy-inline-copy")).toEqual([
      expect.objectContaining({ path: "composition.sections[0].fields[0]", severity: "error" }),
      expect.objectContaining({ path: "pageMeta[0]", severity: "error" }),
    ]);
    expect(candidate).toEqual(before);
  });

  it("isolates section keys and locales without changing the candidate", () => {
    const composition = fixture();
    composition.sections[0]!.fields.push({ key: "title", locale: "fr", value: "Titre", source: "writer" });
    composition.sections.push({ ...structuredClone(composition.sections[0]!), key: "ending" });
    const candidate = { composition }; const before = structuredClone(candidate);
    expect(resolveCopy(candidate, "en")).toEqual({ intro: { title: "Sample title" }, ending: { title: "Sample title" } });
    expect(resolveCopy(candidate, "fr")).toEqual({ intro: { title: "Titre" }, ending: { title: "Titre" } });
    expect(resolveCopy(candidate, "de")).toEqual({ intro: {}, ending: {} });
    expect(candidate).toEqual(before);
  });
  it("keeps empty drafts and performs no case normalization or locale fallback", () => {
    const composition = fixture(); composition.sections[0]!.fields[0]!.value = "";
    expect(resolveCopy({ composition }, "en")).toEqual({ intro: { title: "" } });
    expect(resolveCopy({ composition }, "en-US")).toEqual({ intro: {} });
    composition.sections[0]!.fields[0]!.locale = "en-US";
    expect(() => resolveCopy({ composition }, "en-us")).toThrow(TypeError);
    expect(resolveCopy({ composition }, "en-GB")).toEqual({ intro: {} });
    expect(resolveCopy({}, "en")).toEqual({});
  });
  it("treats prototype-shaped keys as ordinary own data", () => {
    const composition = fixture();
    composition.sections[0]!.key = "__proto__"; composition.sections[0]!.fields[0]!.key = "constructor";
    const resolved = resolveCopy({ composition }, "en");
    expect(Object.hasOwn(resolved, "__proto__")).toBe(true);
    expect(resolved["__proto__"]).toEqual({ constructor: "Sample title" });
  });
  it("refuses invalid locale selection and malformed copy rather than inventing values", () => {
    expect(() => resolveCopy({ composition: fixture() as any }, "bad_locale")).toThrow(TypeError);
    const composition: any = fixture(); composition.sections[0].fields[0].source = "unknown";
    expect(() => resolveCopy({ composition }, "en")).toThrow(TypeError);
  });
});


describe("page metadata Writer copy", () => {
  const pageMeta = () => [
    { key: "title", locale: "en", value: "Page title", source: "writer" as const },
    { key: "description", locale: "en", value: "", source: "writer" as const },
    { key: "title", locale: "fr", value: "Titre de page", source: "writer" as const },
    { key: "share-text", locale: "en-US", value: "Share", source: "writer" as const },
  ];
  it("resolves exact locales in a separate namespace while preserving section copy", () => {
    const candidate = { composition: fixture(), pageMeta: pageMeta() };
    const before = structuredClone(candidate);
    expect(resolveCopy(candidate, "en")).toEqual({ intro: { title: "Sample title" }, [PAGE_META_KEY]: { title: "Page title", description: "" } });
    expect(resolveCopy(candidate, "fr")).toEqual({ intro: {}, [PAGE_META_KEY]: { title: "Titre de page" } });
    expect(resolveCopy(candidate, "en-US")).toEqual({ intro: {}, [PAGE_META_KEY]: { "share-text": "Share" } });
    expect(() => resolveCopy(candidate, "en-us")).toThrow(TypeError);
    expect(resolveCopy(candidate, "en-GB")).toEqual({ intro: {}, [PAGE_META_KEY]: {} });
    expect(resolveCopy(candidate, "de")).toEqual({ intro: {}, [PAGE_META_KEY]: {} });
    expect(candidate).toEqual(before);
  });
  it("resolves metadata without composition and only adds the namespace when present", () => {
    expect(resolveCopy({ pageMeta: pageMeta() }, "en")).toEqual({ [PAGE_META_KEY]: { title: "Page title", description: "" } });
    expect(resolveCopy({ pageMeta: [] }, "en")).toEqual({ [PAGE_META_KEY]: {} });
    expect(resolveCopy({}, "en")).toEqual({});
  });
  it("rejects section keys that collide with the page namespace", () => {
    const composition = fixture(); composition.sections[0]!.key = PAGE_META_KEY;
    expect(validateComposition(composition)).toContainEqual(expect.objectContaining({ path: "composition.sections[0].key", rule: "reserved-section-key" }));
    expect(() => resolveCopy({ composition, pageMeta: pageMeta() }, "en")).toThrow();
  });
  it("shares Writer field validation and limits metadata keys", () => {
    expect(validateCopyFields(pageMeta(), "pageMeta", PAGE_META_FIELDS)).toEqual([]);
    for (const value of [null, [{ ...pageMeta()[0], key: "other" }], [{ ...pageMeta()[0], source: "unknown" }], [{ ...pageMeta()[0], value: 7 }], [pageMeta()[0], pageMeta()[0]]]) {
      expect(validateCopyFields(value, "pageMeta", PAGE_META_FIELDS).length).toBeGreaterThan(0);
      expect(() => resolveCopy({ pageMeta: value as any }, "en")).toThrow();
    }
  });
});
