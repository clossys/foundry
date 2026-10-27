import { describe, expect, it } from "vitest";
import { computeContentDigest } from "./digest.js";
import { appendContentRevision, createContentRevision, validateContentRevisionIntegrity } from "./revisions.js";
import type { CandidateContent } from "./model.js";

const content = (): CandidateContent => ({
  name: "Sample", brief: { audience: "Readers", goal: "Inform", keyMessage: "Sample", callToAction: "Continue", tone: "Clear", constraints: [], sourceAnswers: [], version: 1 },
  composition: { frame: { frameId: "frames.sample", configId: "default" }, sections: [], libraryVersion: "1" },
  links: [], typeSettings: {}, openQuestions: [],
});
const at = "2026-01-01T00:00:00Z";

describe("immutable candidate revisions", () => {
  it("isolates and freezes every snapshot layer", () => {
    const draft: any = content();
    const snapshot = createContentRevision(draft, "r1", at);
    draft.brief.audience = "Changed";
    expect(snapshot.content.brief.audience).toBe("Readers");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.content)).toBe(true);
    expect(Object.isFrozen(snapshot.content.brief)).toBe(true);
    expect(Object.isFrozen(snapshot.content.composition!.sections)).toBe(true);
    expect(() => { (snapshot.content.brief as any).audience = "Changed"; }).toThrow();
  });
  it("appends sequential snapshots while preserving all earlier content", () => {
    const r1 = appendContentRevision([], content(), at);
    const r2 = appendContentRevision(r1, { ...content(), name: "Rewrite" }, at);
    expect(r1).toHaveLength(1);
    expect(r2.map(snapshot => snapshot.revision)).toEqual(["r1", "r2"]);
    expect(r2[0]).toEqual(r1[0]);
    expect(Object.isFrozen(r2)).toBe(true);
    expect(r2[0]!.digest).not.toBe(r2[1]!.digest);
  });
  it("does not mint a revision for tag-only or workflow-only edits", () => {
    const first = appendContentRevision([], content(), at);
    const filters = { ...content(), tags: ["milestone:sample"] };
    const workflow = { ...content(), state: "active", approval: { source: "owner" }, updatedAt: "2026-01-02T00:00:00Z" };
    for (const update of [filters, workflow]) {
      const unchanged = appendContentRevision(first, update, at);
      expect(unchanged).toHaveLength(1);
      expect(unchanged).toEqual(first);
      expect(Object.isFrozen(unchanged)).toBe(true);
      expect(Object.isFrozen(unchanged[0]!.content.brief)).toBe(true);
    }
    expect(appendContentRevision(first, { ...content(), name: "Rewrite" }, at)).toHaveLength(2);
  });
  it("rejects edited history digests and nonsequential revisions", () => {
    const original = createContentRevision(content(), "r1", at);
    expect(() => appendContentRevision([{ ...original, content: { ...content(), name: "Tampered" } }], content(), at)).toThrow();
    expect(() => appendContentRevision([{ ...original, revision: "r2" }], content(), at)).toThrow();
    expect(() => createContentRevision(content(), "r0", at)).toThrow();
    expect(() => createContentRevision(content(), "r1", "later")).toThrow();
  });
  it("hashes only revision content while keeping object-key order stable", () => {
    const value = content();
    const workflow = { ...value, state: "active", tags: ["milestone:sample"], approval: { source: "owner" }, history: [], updatedAt: at };
    expect(computeContentDigest(workflow)).toBe(computeContentDigest(value));
    expect(computeContentDigest({ ...value, typeSettings: { a: 1, b: 2 } })).toBe(computeContentDigest({ ...value, typeSettings: { b: 2, a: 1 } }));
    const snapshot = createContentRevision(workflow, "r1", at);
    expect(snapshot.content).not.toHaveProperty("tags");
    expect(snapshot.content).not.toHaveProperty("approval");
  });
  it.each(["name", "brief", "composition", "links", "typeSettings", "openQuestions"])("covers %s in the digest", key => {
    const original = content(); const changed: any = structuredClone(original);
    if (key === "name") changed.name = "Rewrite";
    if (key === "brief") changed.brief.goal = "Explain";
    if (key === "composition") changed.composition.libraryVersion = "2";
    if (key === "links") changed.links.push({ toSlotId: "documents/docs/next", relation: "next", intent: "Continue" });
    if (key === "typeSettings") changed.typeSettings.title = "New";
    if (key === "openQuestions") changed.openQuestions.push({ field: "brief.audience", question: "Which audience?", blocking: true });
    expect(computeContentDigest(changed)).not.toBe(computeContentDigest(original));
  });
  it("covers redirect targets and rejects composition beside a redirect", () => {
    const { composition: _composition, ...base } = content();
    const redirect = { ...base, redirectTarget: "/next" };
    const first = createContentRevision(redirect, "r1", at);
    const second = createContentRevision({ ...redirect, redirectTarget: "/other" }, "r2", at);
    expect(first.digest).not.toBe(second.digest);
    expect(() => createContentRevision({ ...redirect, composition: content().composition }, "r1", at)).toThrow();
  });
  it("checks stored digests separately from structural canvas validation", () => {
    const snapshot = createContentRevision(content(), "r1", at);
    const candidate = { ...content(), id: "sample", slotId: "websites/site/home", origin: "agent-draft", state: "draft", revision: "r1", tags: [], history: [snapshot], updatedAt: at };
    expect(validateContentRevisionIntegrity(candidate)).toEqual([]);
    expect(validateContentRevisionIntegrity({ ...candidate, name: "Changed" }).some(f => f.rule === "snapshot-content")).toBe(true);
    expect(validateContentRevisionIntegrity({ ...candidate, history: [{ ...snapshot, digest: "tampered" }] }).some(f => f.rule === "revision-digest")).toBe(true);
    expect(validateContentRevisionIntegrity({ ...candidate, tags: ["bundle:sample"] })).toEqual([]);
  });
  it("preserves section order as content", () => {
    const section = { key: "a", sectionId: "sections.sample", configId: "default", intent: "continues" as const, fields: [] };
    const value = content();
    const first = { ...value, composition: { ...value.composition!, sections: [section, { ...section, key: "b" }] } };
    const second = { ...value, composition: { ...value.composition!, sections: [...first.composition.sections].reverse() } };
    expect(computeContentDigest(first)).not.toBe(computeContentDigest(second));
  });
});
