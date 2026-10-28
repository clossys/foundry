import { describe, expect, it } from "vitest";
import { parseComposition, validateComposition, resolveCopy } from "./composition.js";

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
    ["handwritten source", (v: any) => { v.sections[0].fields[0].source = "handwritten"; }, "writer-source"],
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
    expect(resolveCopy({ composition }, "en-us")).toEqual({ intro: {} });
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
    const composition: any = fixture(); composition.sections[0].fields[0].source = "handwritten";
    expect(() => resolveCopy({ composition }, "en")).toThrow(TypeError);
  });
});
