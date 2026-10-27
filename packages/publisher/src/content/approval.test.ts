import { describe, expect, it } from "vitest";
import { checkContentActivation, checkContentApproval } from "./approval.js";
import { createContentRevision } from "./revisions.js";
import { at, reviewFixture } from "./__fixtures__/review.js";

describe("current revision approval prerequisite", () => {
  it("requires current owner approval for Publish and accepts it for activation", () => {
    const registry = reviewFixture(); const before = structuredClone(registry);
    expect(checkContentApproval(registry.candidates[0], "activation")).toEqual([]);
    expect(checkContentApproval(registry.candidates[0], "publish")).toEqual([]);
    expect(checkContentActivation(registry)).toEqual([]);
    expect(registry).toEqual(before);
  });
  it("permits imported baseline activation but refuses first Publish", () => {
    const value: any = reviewFixture(); value.candidates[0].origin = "imported"; value.candidates[0].approval.source = "imported-baseline";
    expect(checkContentActivation(value)).toEqual([]);
    expect(checkContentApproval(value.candidates[0], "publish").map(f => f.rule)).toContain("publish-owner-approval");
  });
  it("accepts either recorded activation source without an additional origin restriction", () => {
    const value: any = reviewFixture(); value.candidates[0].approval.source = "imported-baseline";
    expect(value.candidates[0].origin).toBe("agent-draft");
    expect(checkContentActivation(value)).toEqual([]);
    expect(checkContentApproval(value.candidates[0], "publish").map(f => f.rule)).toContain("publish-owner-approval");
  });
  it.each([
    ["missing approval", (v: any) => { delete v.approval; }, "approval-required"],
    ["stale revision", (v: any) => { v.approval.revision = "r2"; }, "approval-revision"],
    ["wrong digest", (v: any) => { v.approval.digest = "forged"; }, "approval-digest"],
    ["changed current copy", (v: any) => { v.composition.sections[0].fields[0].text = "Changed"; }, "snapshot-content"],
    ["forged history digest", (v: any) => { v.history[0].digest = "forged"; v.approval.digest = "forged"; }, "revision-digest"],
    ["changed snapshot content", (v: any) => { v.history[0].content.name = "Changed"; }, "revision-digest"],
  ])("refuses %s", (_name, mutate, rule) => {
    const value: any = structuredClone(reviewFixture()); mutate(value.candidates[0]);
    expect(checkContentActivation(value).some(f => f.rule === rule)).toBe(true);
  });
  it("requires approval again after appending a content revision", () => {
    const value: any = structuredClone(reviewFixture()); const candidate = value.candidates[0];
    candidate.name = "Rewrite"; candidate.revision = "r2"; candidate.history.push(createContentRevision(candidate, "r2", at));
    const rules = checkContentActivation(value).map(f => f.rule);
    expect(rules).toContain("approval-revision"); expect(rules).toContain("approval-digest");
  });
  it("keeps tag and workflow changes outside approval's content digest", () => {
    const value: any = reviewFixture(); value.candidates[0].tags = ["bundle:sample"]; value.candidates[0].updatedAt = "2026-01-02T00:00:00Z";
    expect(checkContentActivation(value)).toEqual([]);
  });
  it("verifies inactive pinned snapshot bytes while allowing unsaved source drafts", () => {
    const value: any = structuredClone(reviewFixture());
    const source = structuredClone(value.candidates[0]); source.id = "source"; source.state = "draft"; delete source.approval;
    source.name = "Unsaved draft";
    value.candidates.push(source);
    const candidate = value.candidates[0];
    candidate.composition.sections[0].ref = { candidateId: "source", revision: "r1", sectionKey: "intro" };
    candidate.history = [createContentRevision(candidate, "r1", at)]; candidate.approval.digest = candidate.history[0].digest;
    expect(checkContentActivation(value)).toEqual([]);
    source.history[0].content.composition.sections[0].fields[0].text = "Tampered";
    expect(checkContentActivation(value).map(f => f.rule)).toContain("pinned-revision-digest");
  });
  it("refuses unresolved and cyclic pinned histories in the Node prerequisite", () => {
    const value: any = structuredClone(reviewFixture()); const candidate = value.candidates[0];
    const source = structuredClone(candidate); source.id = "source"; source.state = "draft"; delete source.approval; value.candidates.push(source);
    const ref = { candidateId: "source", revision: "r1", sectionKey: "intro" };
    candidate.composition.sections[0].ref = ref;
    candidate.history = [createContentRevision(candidate, "r1", at)]; candidate.approval.digest = candidate.history[0].digest;
    source.history[0].content.composition.sections[0].ref = ref;
    source.history[0] = createContentRevision(source.history[0].content, "r1", at);
    expect(checkContentActivation(value).map(f => f.rule)).toContain("section-reference-cycle");
    source.history[0] = createContentRevision({ ...source.history[0].content, composition: { ...source.composition, sections: [] } }, "r1", at);
    expect(checkContentActivation(value).map(f => f.rule)).toContain("unresolved-section-reference");
  });
  it("refuses Publish for a non-active candidate even with owner approval", () => {
    const value: any = reviewFixture(); value.candidates[0].state = "approved";
    expect(checkContentApproval(value.candidates[0], "publish").map(f => f.rule)).toContain("publish-active-candidate");
  });
  it("allows empty slots and unapproved drafts, but validates active pointers", () => {
    const value: any = reviewFixture(); value.candidates[0].state = "draft"; delete value.candidates[0].approval; delete value.slots[0].activeCandidateId;
    expect(checkContentActivation(value)).toEqual([]);
    value.slots[0].activeCandidateId = "sample";
    expect(checkContentActivation(value).map(f => f.rule)).toContain("active-candidate-pointer");
    value.slots[0].activeCandidateId = "missing";
    expect(checkContentActivation(value).map(f => f.rule)).toContain("active-candidate-pointer");
  });
  it("refuses two active candidates and an active candidate attached to another slot", () => {
    const value: any = reviewFixture(); value.candidates.push({ ...value.candidates[0], id: "other" });
    expect(checkContentActivation(value).map(f => f.rule)).toContain("one-active-candidate");
    value.candidates.pop(); value.candidates[0].slotId = "websites/site/missing";
    expect(checkContentActivation(value).map(f => f.rule)).toContain("missing-slot");
  });
  it("refuses unknown approval purposes and malformed input", () => {
    expect(checkContentApproval(reviewFixture().candidates[0], "unknown" as any).map(f => f.rule)).toContain("approval-purpose");
    const cyclic: any = {}; cyclic.self = cyclic;
    for (const value of [null, [], {}, cyclic, new Array(1), { name: Infinity }]) {
      expect(() => checkContentApproval(value, "activation")).not.toThrow();
      expect(checkContentApproval(value, "activation").length).toBeGreaterThan(0);
      expect(checkContentActivation(value).length).toBeGreaterThan(0);
    }
  });
});
