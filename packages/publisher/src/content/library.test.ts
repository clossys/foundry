import { describe, expect, it } from "vitest";
import { checkContentLibraryReferences, validateConsumerLibrarySnapshots } from "./library.js";
import { libraryFixture, pinnedReviewFixture, reviewFixture } from "./__fixtures__/review.js";

describe("consumer supplied closed-world library", () => {
  it("accepts exact consumer/version registrations without changing inputs", () => {
    const registry = reviewFixture(); const libraries = libraryFixture();
    const before = structuredClone({ registry, libraries });
    expect(checkContentLibraryReferences(registry, libraries)).toEqual([]);
    expect(checkContentLibraryReferences(registry, libraries)).toEqual([]);
    expect({ registry, libraries }).toEqual(before);
  });
  it.each([
    ["missing snapshot", (_r: any, l: any) => l.splice(0), "unavailable-library-version"],
    ["foreign consumer", (_r: any, l: any) => { l[0].consumerId = "foreign"; }, "unavailable-library-version"],
    ["newer version", (_r: any, l: any) => { l[0].version = "2"; }, "unavailable-library-version"],
    ["frame", (_r: any, l: any) => { l[0].frames = []; }, "unregistered-frame"],
    ["frame config owner", (_r: any, l: any) => { l[0].frames[0].configIds = []; l[0].frames.push({ id: "frames.other", configIds: ["default"] }); }, "unregistered-frame-config"],
    ["section", (_r: any, l: any) => { l[0].sections = []; }, "unregistered-section"],
    ["section config owner", (_r: any, l: any) => { l[0].sections[0].configIds = []; l[0].sections.push({ id: "sections.other", configIds: ["default"] }); }, "unregistered-section-config"],
    ["asset", (_r: any, l: any) => { l[0].assetIds = []; }, "unregistered-asset"],
    ["asset version", (r: any) => { r.candidates[0].composition.sections[0].assets[0].libraryVersion = "2"; }, "asset-library-version"],
    ["type settings asset", (r: any) => { r.candidates[0].typeSettings.shareImage.assetId = "missing"; }, "unregistered-asset"],
    ["nested settings assets", (r: any) => { r.candidates[0].typeSettings.nested = [{ image: { assetId: "missing", libraryVersion: "1" } }]; }, "unregistered-asset"],
    ["malformed settings ref", (r: any) => { delete r.candidates[0].typeSettings.shareImage.libraryVersion; }, "asset-reference"],
  ])("refuses missing or mismatched %s", (_name, mutate, rule) => {
    const registry = reviewFixture(); const libraries = libraryFixture(); mutate(registry, libraries);
    expect(checkContentLibraryReferences(registry, libraries).some(f => f.rule === rule)).toBe(true);
  });
  it.each([
    ["versions", (l: any) => l.push(structuredClone(l[0])), "duplicate-library-version"],
    ["frames", (l: any) => l[0].frames.push(structuredClone(l[0].frames[0])), "duplicate-library-id"],
    ["sections", (l: any) => l[0].sections.push(structuredClone(l[0].sections[0])), "duplicate-library-id"],
    ["configs", (l: any) => l[0].sections[0].configIds.push("default"), "duplicate-library-config"],
    ["assets", (l: any) => l[0].assetIds.push("assets.sample"), "duplicate-library-asset"],
  ])("rejects ambiguous %s", (_name, mutate, rule) => {
    const libraries = libraryFixture(); mutate(libraries);
    expect(validateConsumerLibrarySnapshots(libraries).some(f => f.rule === rule)).toBe(true);
  });
  it.each([null, {}, [null], [{}], [{ consumerId: "sample", version: "1", frames: [null], sections: 0, assetIds: [null] }]])("refuses malformed snapshots", value => {
    expect(() => checkContentLibraryReferences(reviewFixture(), value)).not.toThrow();
    expect(checkContentLibraryReferences(reviewFixture(), value).length).toBeGreaterThan(0);
  });
  it("accepts redirects without manufacturing a composition", () => {
    const value: any = structuredClone(reviewFixture()); value.slots[0].kind = "redirect";
    const candidate = value.candidates[0]; delete candidate.composition; candidate.redirectTarget = "/next"; candidate.typeSettings = {};
    delete candidate.history[0].content.composition; candidate.history[0].content.redirectTarget = "/next";
    expect(checkContentLibraryReferences(value, [])).toEqual([]);
  });
  it("resolves pinned section revisions rather than following latest content", () => {
    const value: any = structuredClone(reviewFixture());
    const source = structuredClone(value.candidates[0]); source.id = "source"; source.state = "draft";
    source.composition.sections[0].key = "new-key";
    value.candidates.push(source);
    value.candidates[0].composition.sections[0].ref = { candidateId: "source", revision: "r1", sectionKey: "intro" };
    expect(checkContentLibraryReferences(value, libraryFixture())).toEqual([]);
    value.candidates[0].composition.sections[0].ref.sectionKey = "new-key";
    expect(checkContentLibraryReferences(value, libraryFixture()).some(f => f.rule === "unresolved-section-reference")).toBe(true);
  });
  it("refuses a pinned source library version even when both versions are supplied", () => {
    const value: any = structuredClone(pinnedReviewFixture()); const libraries = libraryFixture();
    libraries.push({ ...structuredClone(libraries[0]!), version: "2" });
    expect(checkContentLibraryReferences(value, libraries)).toEqual([]);
    value.candidates[1].history[0].content.composition.libraryVersion = "2";
    value.candidates[1].history[0].content.composition.sections[0].assets[0].libraryVersion = "2";
    expect(checkContentLibraryReferences(value, libraries).map(f => f.rule)).toContain("pinned-library-version");
  });
  it.each(["sectionId", "configId"])("requires referencing %s to match the pinned section", key => {
    const value: any = structuredClone(pinnedReviewFixture()); const libraries = libraryFixture();
    libraries[0]!.sections.push({ id: "sections.other", configIds: ["default", "other"] });
    (libraries[0]!.sections[0]!.configIds as string[]).push("other");
    value.candidates[1].history[0].content.composition.sections[0][key] = key === "sectionId" ? "sections.other" : "other";
    expect(checkContentLibraryReferences(value, libraries).map(f => f.rule)).toContain("pinned-section-identity");
  });
  it("retains the root library version across transitive section references", () => {
    const value: any = structuredClone(pinnedReviewFixture()); const libraries = libraryFixture();
    libraries.push({ ...structuredClone(libraries[0]!), version: "2" });
    const next = structuredClone(value.candidates[1]); next.id = "next";
    next.history[0].content.composition.libraryVersion = "2";
    next.history[0].content.composition.sections[0].assets[0].libraryVersion = "2";
    value.candidates.push(next);
    value.candidates[1].history[0].content.composition.sections[0].ref = { candidateId: "next", revision: "r1", sectionKey: "intro" };
    expect(checkContentLibraryReferences(value, libraries).map(f => f.rule)).toContain("pinned-library-version");
  });
  it("rejects asset-ref extra keys while still inspecting nested sibling objects and arrays", () => {
    const value: any = reviewFixture();
    value.candidates[0].typeSettings.shareImage.extra = [{ assetId: "missing", libraryVersion: "1" }];
    const findings = checkContentLibraryReferences(value, libraryFixture());
    expect(findings.some(f => f.rule === "asset-reference-keys")).toBe(true);
    expect(findings.some(f => f.rule === "unregistered-asset" && f.path.endsWith("shareImage.extra[0]"))).toBe(true);
  });
  it("continues nested asset checks even after a malformed outer asset reference", () => {
    const value: any = reviewFixture();
    value.candidates[0].typeSettings.shareImage.assetId = "";
    value.candidates[0].typeSettings.shareImage.extra = { assetId: "missing", libraryVersion: "1" };
    const findings = checkContentLibraryReferences(value, libraryFixture());
    expect(findings.some(f => f.rule === "asset-reference")).toBe(true);
    expect(findings.some(f => f.rule === "unregistered-asset" && f.path.endsWith("shareImage.extra"))).toBe(true);
  });
  it.each(["candidateId", "revision", "sectionKey"])("requires the pinned %s to exist", key => {
    const value: any = structuredClone(reviewFixture());
    value.candidates[0].composition.sections[0].ref = { candidateId: "sample", revision: "r1", sectionKey: "intro", [key]: key === "revision" ? "r2" : "missing" };
    expect(checkContentLibraryReferences(value, libraryFixture()).some(f => f.rule === "unresolved-section-reference")).toBe(true);
  });
  it("checks referenced snapshot registrations and refuses cycles", () => {
    const value: any = structuredClone(reviewFixture());
    const ref = { candidateId: "sample", revision: "r1", sectionKey: "intro" };
    value.candidates[0].composition.sections[0].ref = ref;
    value.candidates[0].history[0].content.composition.sections[0].sectionId = "missing";
    expect(checkContentLibraryReferences(value, libraryFixture()).some(f => f.rule === "unregistered-section")).toBe(true);
    value.candidates[0].history[0].content.composition.sections[0].ref = ref;
    expect(checkContentLibraryReferences(value, libraryFixture()).some(f => f.rule === "section-reference-cycle")).toBe(true);
  });
  it.each([null, {}, { slots: [null], candidates: [] }, { candidates: new Array(1) }])("refuses malformed registries without throwing", value => {
    expect(() => checkContentLibraryReferences(value, libraryFixture())).not.toThrow();
    expect(checkContentLibraryReferences(value, libraryFixture()).length).toBeGreaterThan(0);
  });
});
