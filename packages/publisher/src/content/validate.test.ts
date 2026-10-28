import { describe, expect, it } from "vitest";
import { computeContentDigest } from "./digest.js";
import { validateContentRegistry, validateContentCandidate, validateContentSlot, validateContentWorkspace, parseContentRegistry } from "./validate.js";

export const contentFixture = () => ({
  name: "Sample", brief: { audience: "Readers", goal: "Inform", keyMessage: "Sample", callToAction: "Continue", tone: "Clear", constraints: [], sourceAnswers: [{ question: "Audience?", answer: "Readers" }], version: 1 },
  composition: { frame: { frameId: "frames.sample", configId: "default" }, sections: [{ key: "intro", sectionId: "sections.sample", configId: "default", intent: "continues", fields: [{ key: "heading", locale: "en", value: "Sample", source: "writer" }] }], libraryVersion: "1" },
  links: [], typeSettings: {}, openQuestions: [],
});
export const registryFixture = () => {
  const content = contentFixture();
  return {
    workspace: { consumerId: "sample", defaultLocale: "en", locales: ["en", "fr"], deployTargets: [{ id: "sample", repo: "sample", app: "site" }], destinations: [] },
    slots: [{ id: "sl_aaaaaaaaaa", aliases: ["websites/site/home"], locales: ["en"], l1: "websites", l2: "site", position: { order: 0, name: "home" }, name: "Home", kind: "content", route: "/", deployTarget: "sample", devOnly: false, tags: [], releases: [], createdAt: "2026-01-01T00:00:00Z" }],
    candidates: [{ ...content, id: "sample", slotId: "sl_aaaaaaaaaa", origin: "agent-draft", state: "draft", revision: "r1", tags: [], history: [{ revision: "r1", digest: computeContentDigest(content as any), content: structuredClone(content), createdAt: "2026-01-01T00:00:00Z" }], updatedAt: "2026-01-01T00:00:00Z" }],
  };
};

describe("content records", () => {
  it("accepts workspace, slot, candidate and joined registry", () => {
    const value = registryFixture();
    expect(validateContentWorkspace(value.workspace)).toEqual([]);
    expect(validateContentSlot(value.slots[0])).toEqual([]);
    expect(validateContentCandidate(value.candidates[0])).toEqual([]);
    expect(parseContentRegistry(value)).toEqual(value);
  });
  it("keeps an issued id when placement moves across groups", () => {
    const value: any = registryFixture(); value.slots[0].l1 = "documents"; value.slots[0].l2 = "docs";
    expect(validateContentRegistry(value)).toEqual([]);
  });
  it("keeps aliases independent of identity and candidate joins", () => {
    const value: any = registryFixture();
    value.slots[0].aliases = ["home", "previous/home"];
    expect(validateContentRegistry(value)).toEqual([]);
    value.candidates[0].slotId = "home";
    expect(validateContentRegistry(value).some(f => f.rule === "missing-slot")).toBe(true);
  });
  it("accepts valid locale tags and preserves exact locale selections", () => {
    const value = registryFixture();
    value.workspace.locales = ["en-US", "fr-CA"];
    value.workspace.defaultLocale = "en-US";
    value.slots[0].locales = ["fr-CA"];
    expect(validateContentRegistry(value)).toEqual([]);
    value.workspace.defaultLocale = "en-us";
    expect(validateContentRegistry(value).some(f => f.rule === "non-canonical-locale")).toBe(true);
    expect(validateContentRegistry(value).some(f => f.rule === "default-locale-membership")).toBe(true);
    value.workspace.defaultLocale = "en-US";
    value.slots[0].locales = ["fr-ca"];
    expect(validateContentRegistry(value).some(f => f.rule === "non-canonical-locale")).toBe(true);
    value.slots[0].locales = ["de"];
    expect(validateContentRegistry(value).some(f => f.rule === "workspace-locale")).toBe(true);
  });
  it.each(["builder", "messenger", "influencer"])("accepts %s destinations", kind => {
    const value: any = registryFixture();
    value.workspace.destinations = [{ id: "target", kind, ref: "sample" }];
    expect(validateContentWorkspace(value.workspace)).toEqual([]);
  });
  it("rejects the retired destination kind", () => {
    const value: any = registryFixture();
    value.workspace.destinations = [{ id: "target", kind: "distributor", ref: "sample" }];
    expect(validateContentWorkspace(value.workspace).some(f => f.rule === "enum")).toBe(true);
  });
  it.each([
    ["missing workspace locales", (v: any) => { delete v.workspace.locales; }, "array"],
    ["empty workspace locales", (v: any) => { v.workspace.locales = []; }, "nonempty-locales"],
    ["duplicate workspace locales", (v: any) => { v.workspace.locales = ["en", "en"]; }, "duplicate-locale"],
    ["invalid workspace locale", (v: any) => { v.workspace.locales = ["en_US"]; }, "locale"],
    ["invalid default locale", (v: any) => { v.workspace.defaultLocale = ""; }, "locale"],
    ["default outside workspace locales", (v: any) => { v.workspace.defaultLocale = "de"; }, "default-locale-membership"],
    ["missing slot locales", (v: any) => { delete v.slots[0].locales; }, "array"],
    ["empty slot locales", (v: any) => { v.slots[0].locales = []; }, "nonempty-locales"],
    ["duplicate slot locales", (v: any) => { v.slots[0].locales = ["en", "en"]; }, "duplicate-locale"],
    ["invalid slot locale", (v: any) => { v.slots[0].locales = ["not_a_locale"]; }, "locale"],
    ["slot locale outside workspace", (v: any) => { v.slots[0].locales = ["de"]; }, "workspace-locale"],
    ["missing aliases", (v: any) => { delete v.slots[0].aliases; }, "array"],
    ["blank alias", (v: any) => { v.slots[0].aliases = [" "]; }, "string"],
    ["duplicate aliases", (v: any) => { v.slots[0].aliases = ["home", "home"]; }, "duplicate-alias"],
    ["alias equal to own id", (v: any) => { v.slots[0].aliases = [v.slots[0].id]; }, "alias-collision"],
    ["alias equal to another id", (v: any) => {
      v.slots[0].aliases = ["sl_aaaaaaaaab"];
      v.slots.push({ ...structuredClone(v.slots[0]), id: "sl_aaaaaaaaab", aliases: [] });
    }, "alias-collision"],
    ["alias shared by slots", (v: any) => {
      v.slots.push({ ...structuredClone(v.slots[0]), id: "sl_aaaaaaaaab" });
    }, "alias-collision"],
  ])("rejects invalid %s", (_name, mutate, rule) => {
    const value = registryFixture(); mutate(value);
    expect(validateContentRegistry(value).some(f => f.rule === rule)).toBe(true);
  });
  it("accepts zero or one active candidate with an exact slot pointer", () => {
    const value: any = registryFixture(); value.candidates[0].state = "active"; value.slots[0].activeCandidateId = "sample";
    expect(validateContentRegistry(value)).toEqual([]);
    value.candidates.push({ ...structuredClone(value.candidates[0]), id: "second" });
    expect(validateContentRegistry(value).some(f => f.rule === "one-active-candidate")).toBe(true);
  });
  it("rejects the removed internal board regardless of dev-only status", () => {
    const value: any = registryFixture(); value.slots[0].l2 = "internal";
    expect(validateContentRegistry(value).some(f => f.rule === "placement")).toBe(true);
    value.slots[0].devOnly = true;
    expect(validateContentRegistry(value).some(f => f.rule === "placement")).toBe(true);
  });
  it("distinguishes redirect targets from missing content compositions", () => {
    const value: any = registryFixture(); value.slots[0].kind = "redirect";
    delete value.candidates[0].composition; value.candidates[0].redirectTarget = "/next";
    delete value.candidates[0].history[0].content.composition; value.candidates[0].history[0].content.redirectTarget = "/next";
    value.candidates[0].history[0].digest = computeContentDigest(value.candidates[0]);
    expect(validateContentRegistry(value)).toEqual([]);
    value.slots[0].kind = "content";
    expect(validateContentRegistry(value).some(f => f.rule === "slot-content-kind")).toBe(true);
  });
  it.each([
    ["closed hierarchy", (v: any) => { v.slots[0].l2 = "social"; }, "placement"],
    ["address-shaped slot identity", (v: any) => { v.slots[0].id = "websites/site/home"; }, "slot-id"],
    ["candidate states", (v: any) => { v.candidates[0].state = "ready"; }, "enum"],
    ["candidate origins", (v: any) => { v.candidates[0].origin = "generated"; }, "enum"],
    ["revision ids", (v: any) => { v.candidates[0].revision = "latest"; }, "pinned-revision"],
    ["history sequence", (v: any) => { v.candidates[0].history[0].revision = "r2"; }, "revision-sequence"],
    ["history current revision", (v: any) => { v.candidates[0].revision = "r2"; }, "current-revision"],
    ["candidate slot join", (v: any) => { v.candidates[0].slotId = "sl_aaaaaaaaab"; }, "missing-slot"],
    ["slot id uniqueness", (v: any) => { v.slots.push(structuredClone(v.slots[0])); }, "duplicate-slot-id"],
    ["candidate id uniqueness", (v: any) => { v.candidates.push(structuredClone(v.candidates[0])); }, "duplicate-candidate-id"],
    ["link targets", (v: any) => { v.candidates[0].links = [{ toSlotId: "missing", relation: "next", intent: "Continue" }]; v.candidates[0].history[0].content.links = structuredClone(v.candidates[0].links); v.candidates[0].history[0].digest = computeContentDigest(v.candidates[0]); }, "missing-link-slot"],
    ["active pointer", (v: any) => { v.slots[0].activeCandidateId = "missing"; }, "active-candidate-pointer"],
    ["question blocking flag", (v: any) => { v.candidates[0].openQuestions = [{ field: "brief.audience", question: "Who?", blocking: "yes" }]; }, "blocking-boolean"],
    ["source answers", (v: any) => { v.candidates[0].brief.sourceAnswers = ["text"]; }, "source-answer"],
    ["inline JSON", (v: any) => { v.candidates[0].typeSettings = { size: Infinity }; }, "json"],
    ["timestamps", (v: any) => { v.candidates[0].updatedAt = "later"; }, "timestamp"],
    ["release revisions", (v: any) => { v.slots[0].releases = [{ n: 1, candidateId: "missing", revision: "r1", at: "2026-01-01T00:00:00Z" }]; }, "release-candidate-revision"],
    ["release numbering", (v: any) => { v.slots[0].releases = [{ n: 2, candidateId: "sample", revision: "r1", at: "2026-01-01T00:00:00Z" }]; }, "release-sequence"],
  ])("rejects invalid %s", (_name, mutate, rule) => {
    const value = registryFixture(); mutate(value);
    expect(validateContentRegistry(value).some(f => f.rule === rule)).toBe(true);
  });
  it.each([null, [], "sample", { workspace: null, slots: [null], candidates: [{}] }])("reports malformed records without throwing", value => {
    expect(() => validateContentRegistry(value)).not.toThrow();
    expect(validateContentRegistry(value).length).toBeGreaterThan(0);
  });
});
