import { describe, expect, it } from "vitest";
import { reviewCandidate } from "./index.js";
import { createContentRevision } from "../revisions.js";
import { field, raisedAt, resnapshot, reviewInput } from "./__fixtures__/review.js";
import type { Fixture } from "./__fixtures__/review.js";

const closed = (input: Fixture) => reviewCandidate(input).findings.filter(f => f.check === "closed-world");
function pinnedInput(): Fixture {
  const input = reviewInput(); const candidate = input.registry.candidates[0]!;
  input.registry.candidates.push({ ...structuredClone(candidate), id: "source", state: "draft" });
  candidate.composition!.sections[0]!.ref = { candidateId: "source", revision: "r1", sectionKey: "intro" };
  candidate.composition!.sections[0]!.fields = [];
  return resnapshot(input);
}
describe("closed-world Review and pinned content", () => {
  it.each([
    ["section", (input: Fixture) => { input.registry.candidates[0]!.composition!.sections[0]!.sectionId = "sections.missing"; }],
    ["config", (input: Fixture) => { input.registry.candidates[0]!.composition!.sections[0]!.configId = "missing"; }],
    ["frame", (input: Fixture) => { input.registry.candidates[0]!.composition!.frame.frameId = "frames.missing"; }],
    ["config", (input: Fixture) => { input.registry.candidates[0]!.composition!.frame.configId = "missing"; }],
    ["asset", (input: Fixture) => { input.registry.candidates[0]!.composition!.sections[0]!.assets![0]!.assetId = "assets.missing"; }],
  ] as const)("rejects an unavailable %s and raises a Designer Need", (kind, change) => {
    const input = reviewInput(); change(input); resnapshot(input); const report = reviewCandidate(input);
    expect(closed(input)).not.toEqual([]);
    expect(report.needs).toEqual(expect.arrayContaining([expect.objectContaining({ kind, target: "designer" })]));
  });
  it("checks asset references in nested type settings", () => {
    const input = reviewInput(); input.registry.candidates[0]!.typeSettings = { nested: [{ image: { assetId: "assets.missing", libraryVersion: "1" } }] };
    expect(closed(resnapshot(input))).not.toEqual([]);
  });
  it("requires asset version to match the selected composition", () => {
    const input = reviewInput(); input.registry.candidates[0]!.composition!.sections[0]!.assets![0]!.libraryVersion = "2";
    expect(closed(resnapshot(input))).not.toEqual([]);
  });
  it("requires an available consumer/version pair", () => {
    const input = reviewInput(); input.libraries[0]!.consumerId = "different";
    expect(closed(input)).not.toEqual([]);
  });
  it("rejects an asset kind outside the section's declared allowed kinds", () => {
    const input = reviewInput(); input.libraries[0]!.assetKinds!["assets.sample"] = "video";
    expect(closed(input)).not.toEqual([]);
  });
  it("raises an asset Need when a registered asset has no kind metadata", () => {
    const input = reviewInput(); delete input.libraries[0]!.assetKinds!["assets.sample"];
    const report = reviewCandidate(input);
    expect(report.findings.some(f => f.check === "closed-world")).toBe(true);
    expect(report.needs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "asset", target: "designer" })]));
  });
  it("resolves pinned historical copy when the live source has changed", () => {
    const input = pinnedInput(); const source = input.registry.candidates[1]!;
    source.composition!.sections[0]!.fields = [field("title", "en", "Edited current source text is deliberately too long"), field("title", "fr", "Courant")];
    source.history.push(structuredClone(createContentRevision(source, "r2", raisedAt)) as typeof source.history[number]); source.revision = "r2";
    const report = reviewCandidate(input);
    expect(report.findings).toEqual([]);
  });
  it("reviews bad historical copy even when the edited live source is valid", () => {
    const input = pinnedInput(); const source = input.registry.candidates[1]!;
    source.composition!.sections[0]!.fields = [field("title", "en", "Pinned historical text exceeds maxLength"), field("title", "fr", "Exemple")];
    resnapshot(input);
    source.composition!.sections[0]!.fields[0]!.value = "Current";
    source.history.push(structuredClone(createContentRevision(source, "r2", raisedAt)) as typeof source.history[number]); source.revision = "r2";
    expect(reviewCandidate(input).findings.some(f => f.check === "copy-schema")).toBe(true);
  });
  it.each(["candidate", "revision", "section"])("never falls back to live data for an unresolved pinned %s", part => {
    const input = pinnedInput(); const ref = input.registry.candidates[0]!.composition!.sections[0]!.ref!;
    if (part === "candidate") ref.candidateId = "absent";
    if (part === "revision") ref.revision = "r9";
    if (part === "section") ref.sectionKey = "absent";
    expect(closed(resnapshot(input))).not.toEqual([]);
  });
  it("rejects a pinned config identity mismatch", () => {
    const input = pinnedInput(); input.registry.candidates[0]!.composition!.sections[0]!.configId = "logo-only";
    expect(closed(resnapshot(input))).not.toEqual([]);
  });
  it("rejects a pinned library version mismatch", () => {
    const input = pinnedInput(); input.registry.candidates[1]!.composition!.libraryVersion = "2";
    input.libraries.push({ ...structuredClone(input.libraries[0]!), version: "2" });
    expect(closed(resnapshot(input))).not.toEqual([]);
  });
  it("detects pinned reference cycles with finite findings", () => {
    const input = pinnedInput(); input.registry.candidates[1]!.composition!.sections[0]!.ref = { candidateId: "sample", revision: "r1", sectionKey: "intro" };
    const findings = closed(resnapshot(input));
    expect(findings.some(f => /cycl/i.test(f.rule + f.message))).toBe(true); expect(findings.length).toBeLessThan(30);
  });
});
