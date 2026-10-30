import { describe, expect, it } from "vitest";
import { reviewCandidate } from "./index.js";
import { computeContentDigest } from "../digest.js";
import { validateContentRegistry } from "../validate.js";
import { allChecksFailingInput, resnapshot, reviewInput, raisedAt } from "./__fixtures__/review.js";
import type { ReviewCheck, ReviewInput } from "./types.js";

const checks: ReviewCheck[] = ["closed-world", "copy-schema", "locale-coverage", "links", "url-collision", "frame-per-l2", "redirect"];
describe("candidate Review report", () => {
  it("accepts an actual finite registered revision with exact locale and asset evidence", () => {
    const input = reviewInput(); const before = structuredClone(input);
    expect(validateContentRegistry(input.registry)).toEqual([]);
    const report = reviewCandidate(input);
    expect(report).toEqual({ candidateId: "sample", revision: "r1", digest: input.digest, findings: [], needs: [], copyFindings: expect.any(Array), checkedAgainst: { libraryVersion: "1", locales: ["en", "fr"] } });
    expect(report.copyFindings?.every(finding => finding.severity === "warning" && finding.rule === "legacy-inline-copy")).toBe(true);
    expect(input).toEqual(before);
  });
  it("runs all seven checks despite semantic registry failures", () => {
    const input = allChecksFailingInput(); const report = reviewCandidate(input);
    expect(new Set(report.findings.map(finding => finding.check))).toEqual(new Set(checks));
    expect(report.needs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "section", target: "designer" })]));
    for (const finding of report.findings) {
      expect(finding.path).toEqual(expect.any(String)); expect(finding.path.length).toBeGreaterThan(0);
      expect(finding.rule.length).toBeGreaterThan(0); expect(finding.message.length).toBeGreaterThan(0);
    }
  });
  it("returns stable Needs tied to the selected slot, candidate and supplied instant", () => {
    const input = reviewInput(); input.registry.candidates[0]!.composition!.sections[0]!.sectionId = "sections.missing";
    resnapshot(input); const report = reviewCandidate(input);
    expect(report.needs).toHaveLength(1);
    expect(report.needs[0]).toMatchObject({ id: expect.any(String), kind: "section", target: "designer", slotId: input.registry.slots[0]!.id, raisedAt, detail: expect.any(String) });
    expect(Object.keys(report.needs[0]!).sort()).toEqual(expect.arrayContaining(["id", "kind", "target", "slotId", "detail", "raisedAt"]));
    expect(report.needs[0]).not.toHaveProperty("candidateId");
    expect(report.needs[0]!.id.length).toBeGreaterThan(0);
    expect(reviewCandidate(structuredClone(input))).toEqual(report);
  });
  it("binds to the current upstream digest without borrowing stale approval metadata", () => {
    const input = reviewInput(); input.registry.candidates[0]!.composition!.sections[0]!.fields[0]!.value = "Changed";
    input.digest = computeContentDigest(input.registry.candidates[0]!);
    expect(reviewCandidate(input).digest).toBe(input.digest);
    expect(reviewCandidate(input).digest).not.toBe(input.registry.candidates[0]!.approval!.digest);
  });
  it("does not deduplicate copy across section occurrences or candidate pages", () => {
    const input = reviewInput(); const candidate = input.registry.candidates[0]!;
    candidate.composition!.sections.push({ ...structuredClone(candidate.composition!.sections[0]!), key: "another" });
    input.registry.candidates.push({ ...structuredClone(candidate), id: "draft-peer", state: "draft" });
    expect(reviewCandidate(resnapshot(input)).findings).toEqual([]);
  });
  it.each([null, {}, { registry: {} }, { registry: { candidates: null } }])("never certifies malformed top-level input %j", value => {
    try { expect(reviewCandidate(value as unknown as ReviewInput).findings.length).toBeGreaterThan(0); }
    catch (error) { expect(error).toBeInstanceOf(TypeError); }
  });
  it.each(["absent", ""]) ("explicitly refuses an unavailable candidate identity %j", candidateId => {
    const input = reviewInput(); input.candidateId = candidateId;
    try { expect(reviewCandidate(input).findings.length).toBeGreaterThan(0); }
    catch (error) { expect(error).toBeInstanceOf(TypeError); }
  });
  it.each(["", "not-a-digest"]) ("explicitly refuses invalid digest identity %j", digest => {
    const input = reviewInput(); input.digest = digest;
    try { expect(reviewCandidate(input).findings.length).toBeGreaterThan(0); }
    catch (error) { expect(error).toBeInstanceOf(TypeError); }
  });
  it.each(["", "not-an-instant"]) ("refuses a missing or invalid Need timestamp %j", at => {
    const input = reviewInput(); input.raisedAt = at;
    expect(() => reviewCandidate(input)).toThrow(TypeError);
  });
  it("never mutates a nested caller-owned copy field", () => {
    const input = allChecksFailingInput(); const before = structuredClone(input);
    reviewCandidate(input); expect(input).toEqual(before);
  });
  it("continues semantic checks when both a composition and redirect target are present", () => {
    const input = reviewInput(); const candidate = input.registry.candidates[0]!;
    candidate.redirectTarget = "/peer";
    candidate.composition!.frame.frameId = "frames.app-shell";
    candidate.composition!.sections[0]!.fields[0]!.value = "This exceeds the declared maximum";
    input.digest = computeContentDigest(candidate);
    const report = reviewCandidate(input);
    expect(report.findings.some(f => f.check === "redirect")).toBe(true);
    expect(report.findings.some(f => f.check === "copy-schema")).toBe(true);
    expect(report.findings.some(f => f.check === "frame-per-l2")).toBe(true);
  });
});
