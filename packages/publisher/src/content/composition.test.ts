import { describe, expect, it } from "vitest";
import { parseComposition, validateComposition } from "./composition.js";

const fixture = () => ({
  frame: { frameId: "frames.sample", configId: "default" },
  libraryVersion: "1",
  sections: [{ key: "intro", sectionId: "sections.sample", configId: "default", intent: "continues",
    fields: [{ field: "title", text: "Sample title", source: "handwritten", assets: [{ assetId: "assets.sample", libraryVersion: "1" }] }],
    ref: { candidateId: "sample", sectionKey: "intro", revision: "r1" } }],
});

describe("Designer composition shape", () => {
  it("retains section order, handwritten copy, and pinned references", () => {
    const value = fixture();
    expect(validateComposition(value)).toEqual([]);
    expect(parseComposition(value)).toEqual(value);
  });
  it("allows draft copy to be empty without claiming required-field completeness", () => {
    const value = fixture(); value.sections[0]!.fields[0]!.text = "";
    expect(validateComposition(value)).toEqual([]);
  });
  it.each([
    ["blank frame", (v: any) => { v.frame.frameId = " "; }, "nonempty-string"],
    ["missing frame config", (v: any) => { delete v.frame.configId; }, "nonempty-string"],
    ["missing library version", (v: any) => { delete v.libraryVersion; }, "nonempty-string"],
    ["floating reference", (v: any) => { v.sections[0].ref.revision = "latest"; }, "pinned-revision"],
    ["duplicate section key", (v: any) => { v.sections.push(structuredClone(v.sections[0])); }, "duplicate-section-key"],
    ["Writer source", (v: any) => { v.sections[0].fields[0].source = "writer"; }, "handwritten-source"],
    ["unversioned asset", (v: any) => { delete v.sections[0].fields[0].assets[0].libraryVersion; }, "nonempty-string"],
    ["layout code", (v: any) => { v.layout = "stack"; }, "unknown-field"],
    ["invalid intent", (v: any) => { v.sections[0].intent = "other"; }, "section-intent"],
    ["non-string copy", (v: any) => { v.sections[0].fields[0].text = 42; }, "string"],
    ["non-array sections", (v: any) => { v.sections = null; }, "array"],
  ])("rejects %s", (_name, mutate, rule) => {
    const value = fixture(); mutate(value);
    expect(validateComposition(value).some(f => f.rule === rule)).toBe(true);
    expect(() => parseComposition(value)).toThrow();
  });
  it.each([null, [], "sample", 4])("rejects non-record %s", value => {
    expect(validateComposition(value)).not.toEqual([]);
  });
});
