import { describe, expect, it } from "vitest";
import { at, pinnedReviewFixture, reviewFixture } from "../__fixtures__/review.js";
import { computeContentDigest } from "../digest.js";
import { createContentRevision } from "../revisions.js";
import { computeReleaseDigest, prepareContentRelease } from "./prepare.js";
import type { ReleaseInput } from "./types.js";

function fixture(registry: any = reviewFixture()): any {
  registry.workspace.deployTargets = [{ id: "site", repo: "sample", app: "site" }];
  registry.slots[0].deployTarget = "site";
  registry.slots[0].route = "/";
  return { registry, approvedBy: "owner", at, selections: [report(registry)] };
}
function report(registry: any, i = 0): any {
  const candidate = registry.candidates[i];
  return { candidateId: candidate.id, review: {
    candidateId: candidate.id, revision: candidate.revision, digest: computeContentDigest(candidate), findings: [], needs: [],
    checkedAgainst: { libraryVersion: candidate.composition?.libraryVersion ?? null, locales: [...registry.slots.find((slot: any) => slot.id === candidate.slotId).locales] },
  } };
}
function refresh(input: any): void {
  for (const candidate of input.registry.candidates) {
    candidate.history = [createContentRevision(candidate, candidate.revision, at)];
    if (candidate.approval) candidate.approval.digest = computeContentDigest(candidate);
  }
  input.selections = input.selections.map((selection: any) => report(input.registry, input.registry.candidates.findIndex((c: any) => c.id === selection.candidateId)));
}
function rules(input: unknown): readonly string[] {
  const result = prepareContentRelease(input as ReleaseInput);
  expect(result.ok).toBe(false);
  expect(result.releases).toEqual([]);
  return result.findings.map(f => f.rule);
}
function bilingual(input: any): void {
  input.registry.workspace.locales = ["en", "fr"];
  input.registry.slots[0].locales = ["en", "fr"];
  const candidate = input.registry.candidates[0];
  for (const section of candidate.composition.sections) section.fields.push(...section.fields.map((f: any) => ({ ...f, locale: "fr" })));
  candidate.pageMeta.push(...candidate.pageMeta.map((f: any) => ({ ...f, locale: "fr" })));
  refresh(input);
}

describe("pure release preparation", () => {
  it("binds current approved content to local pending artifacts without mutating input", () => {
    const input = fixture(); const before = structuredClone(input);
    const result = prepareContentRelease(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bundle = result.releases[0]!;
    expect(bundle.manifest).toEqual({ targetId: "site", n: 1, at, approvedBy: "owner", entries: [{ slotId: input.registry.slots[0].id, candidateId: "sample", revision: "r1", digest: input.selections[0].review.digest, route: "/" }], digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(bundle.build).toEqual({ targetId: "site", releaseN: 1, routes: [{ slotId: input.registry.slots[0].id, path: "/", kind: "content", locales: ["en"], revision: "r1", digest: input.selections[0].review.digest }] });
    expect(bundle.handover).toEqual({ targetId: "site", releaseN: 1, receiver: "builder", matches: false, status: "pending", observedAt: null });
    expect(input).toEqual(before);
    expect(prepareContentRelease(input, { site: 7 })).toMatchObject({ ok: true, releases: [{ manifest: { n: 7 }, build: { releaseN: 7 }, handover: { releaseN: 7 } }] });
  });
  it("retains every declared locale and leaves boundary paths absent", () => {
    const input = fixture(); bilingual(input); delete input.registry.slots[0].route;
    input.selections[0].review.checkedAgainst.locales.reverse();
    const result = prepareContentRelease(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.releases[0]!.build.routes[0]!.locales).toEqual(["en", "fr"]);
    expect(result.releases[0]!.manifest.entries[0]).not.toHaveProperty("route");
    expect(result.releases[0]!.build.routes[0]).not.toHaveProperty("path");
  });
  it.each([
    ["empty selections", (v: any) => { v.selections = []; }, "release-selection"],
    ["duplicate selections", (v: any) => { v.selections.push(v.selections[0]); }, "release-selection"],
    ["missing candidate", (v: any) => { v.selections[0].candidateId = "missing"; }, "release-selection"],
    ["blank approver", (v: any) => { v.approvedBy = " "; }, "release-approver"],
    ["different approver", (v: any) => { v.approvedBy = "other"; }, "release-approver"],
    ["invalid timestamp", (v: any) => { v.at = "bad"; }, "release-timestamp"],
    ["wrong report candidate", (v: any) => { v.selections[0].review.candidateId = "other"; }, "release-review"],
    ["wrong report revision", (v: any) => { v.selections[0].review.revision = "r2"; }, "release-review"],
    ["wrong report digest", (v: any) => { v.selections[0].review.digest = "forged"; }, "release-review"],
    ["wrong report library", (v: any) => { v.selections[0].review.checkedAgainst.libraryVersion = "2"; }, "release-review"],
    ["no locale evidence", (v: any) => { v.selections[0].review.checkedAgainst.locales = []; }, "release-review"],
    ["extra locale evidence", (v: any) => { v.selections[0].review.checkedAgainst.locales.push("fr"); }, "release-review"],
    ["duplicate locale evidence", (v: any) => { v.selections[0].review.checkedAgainst.locales.push("en"); }, "release-review"],
    ["missing report", (v: any) => { delete v.selections[0].review; }, "release-review"],
    ["missing checkedAgainst", (v: any) => { delete v.selections[0].review.checkedAgainst; }, "release-review"],
    ["an open finding", (v: any) => { v.selections[0].review.findings = [{ check: "links", path: "candidate", rule: "advisory", message: "Open" }]; }, "release-review"],
    ["an open Need", (v: any) => { v.selections[0].review.needs = [{}]; }, "release-review"],
  ])("refuses %s", (_name, mutate, rule) => {
    const input = fixture(); mutate(input); expect(rules(input)).toContain(rule);
  });
  it("requires owner approval, active pointers, and unchanged revision snapshots", () => {
    const baseline = fixture(); baseline.registry.candidates[0].origin = "imported"; baseline.registry.candidates[0].approval.source = "imported-baseline";
    expect(rules(baseline)).toContain("publish-owner-approval");
    const inactive = fixture(); inactive.registry.candidates[0].state = "approved"; delete inactive.registry.slots[0].activeCandidateId;
    expect(rules(inactive)).toContain("publish-active-candidate");
    const pointer = fixture(); pointer.registry.slots[0].activeCandidateId = "other";
    expect(rules(pointer)).toContain("active-candidate-pointer");
    const changed = fixture(); changed.registry.candidates[0].composition.sections[0].fields[0].value = "Changed";
    expect(rules(changed)).toContain("snapshot-content");
  });
  it("does not release unselected active slots and deterministically groups targets and entries", () => {
    const input = fixture(); const registry = input.registry;
    for (const [id, target] of [["other", "site"], ["third", "aaa"]]) {
      const slot = { ...structuredClone(registry.slots[0]), id: id === "other" ? "sl_2xv4y3uo7k" : "sl_ke6mhs5hmu", aliases: [], activeCandidateId: id, deployTarget: target };
      registry.slots.push(slot); registry.candidates.push({ ...structuredClone(registry.candidates[0]), id, slotId: slot.id });
    }
    registry.workspace.deployTargets.push({ id: "aaa", repo: "sample", app: "other" });
    expect(prepareContentRelease(input)).toMatchObject({ ok: true, releases: [{ manifest: { entries: [{ candidateId: "sample" }] } }] });
    input.selections = [report(registry, 2), report(registry, 0), report(registry, 1)];
    const first = prepareContentRelease(input);
    input.selections.reverse(); registry.slots.reverse(); registry.candidates.reverse();
    expect(prepareContentRelease(input)).toEqual(first);
    expect(first).toMatchObject({ ok: true, releases: [{ manifest: { targetId: "aaa" } }, { manifest: { targetId: "site", entries: [{ candidateId: "other" }, { candidateId: "sample" }] } }] });
  });
  it.each(["section", "pageMeta"])("independently rejects missing %s translations behind a clean report", part => {
    const input = fixture(); bilingual(input);
    const candidate = input.registry.candidates[0];
    if (part === "section") candidate.composition.sections[0].fields = candidate.composition.sections[0].fields.filter((f: any) => f.locale !== "fr");
    else candidate.pageMeta = candidate.pageMeta.filter((f: any) => f.locale !== "fr");
    refresh(input); expect(rules(input)).toContain("release-copy-locale");
  });
  it("compares locales per occurrence rather than merging all section keys", () => {
    const input = fixture(); bilingual(input); const first = input.registry.candidates[0].composition.sections[0];
    input.registry.candidates[0].composition.sections.push({ ...structuredClone(first), key: "second", fields: first.fields.filter((f: any) => f.locale === "en") });
    first.fields = first.fields.filter((f: any) => f.locale === "fr");
    refresh(input); expect(rules(input)).toContain("release-copy-locale");
  });
  it("rejects undeclared copy locales even with exact report coverage", () => {
    const input = fixture(); input.registry.candidates[0].composition.sections[0].fields.push({ key: "heading", locale: "fr", value: "Bonjour", source: "writer" });
    refresh(input); expect(rules(input)).toContain("release-copy-locale");
  });
  it("checks pinned historical copy rather than locally shadowed fields or current source drafts", () => {
    const input = fixture(pinnedReviewFixture());
    // The base pinned fixture shares fields between candidates; these are independent drafts.
    input.registry.candidates = input.registry.candidates.map((candidate: any) => structuredClone(candidate));
    bilingual(input);
    const source = input.registry.candidates[1];
    source.composition.sections[0].fields[0].value = "Unsaved source draft";
    expect(rules(input)).toContain("release-copy-locale");
    const pinnedContent = structuredClone(source.history[0].content);
    pinnedContent.composition.sections[0].fields.push({ key: "heading", locale: "fr", value: "Bonjour", source: "writer" });
    source.history[0] = createContentRevision(pinnedContent, "r1", at);
    expect(prepareContentRelease(input).ok).toBe(true);
  });
  it("accepts legitimate zero-copy sections with complete locale evidence", () => {
    const input = fixture(); bilingual(input); input.registry.candidates[0].composition.sections[0].fields = [];
    refresh(input); expect(prepareContentRelease(input).ok).toBe(true);
  });
  it("requires all locale evidence for sectionless redirects", () => {
    const input = fixture(); bilingual(input); const candidate = input.registry.candidates[0];
    delete candidate.composition; delete candidate.pageMeta; candidate.redirectTarget = "/new"; input.registry.slots[0].kind = "redirect";
    refresh(input); expect(prepareContentRelease(input).ok).toBe(true);
    input.selections[0].review.checkedAgainst.locales = ["en"]; expect(rules(input)).toContain("release-review");
  });
  it.each([undefined, "missing", "../escape", "bad/segment"])("refuses undeclared or unsafe deployTarget %s", target => {
    const input = fixture(); if (target === undefined) delete input.registry.slots[0].deployTarget;
    else { input.registry.slots[0].deployTarget = target; if (target !== "missing") input.registry.workspace.deployTargets[0].id = target; }
    expect(rules(input)).toContain("release-target");
  });
  it("resolves explicit destination kinds and refuses unresolved or mixed receivers", () => {
    const input = fixture(); input.registry.workspace.destinations = [{ id: "social", kind: "messenger", ref: "sample" }];
    input.registry.slots[0].destination = "social";
    expect(prepareContentRelease(input)).toMatchObject({ ok: true, releases: [{ handover: { receiver: "messenger" } }] });
    input.registry.slots[0].destination = "missing"; expect(rules(input)).toContain("release-destination");
    input.registry.slots[0].destination = "social";
    const slot = { ...structuredClone(input.registry.slots[0]), id: "sl_2xv4y3uo7k", aliases: [], activeCandidateId: "other" }; delete slot.destination;
    input.registry.slots.push(slot); input.registry.candidates.push({ ...structuredClone(input.registry.candidates[0]), id: "other", slotId: slot.id }); input.selections.push(report(input.registry, 1));
    expect(rules(input)).toContain("release-receiver");
  });
  it("fails malformed untyped inputs without throwing", () => {
    const cyclic: any = fixture(); cyclic.registry.self = cyclic.registry;
    for (const input of [null, [], {}, cyclic, { ...fixture(), selections: [null] }, { ...fixture(), selections: "sample" }, { ...fixture(), registry: { slots: [] } }]) {
      expect(() => prepareContentRelease(input as ReleaseInput)).not.toThrow(); expect(rules(input).length).toBeGreaterThan(0);
    }
    for (const n of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(prepareContentRelease(fixture(), { site: n })).toMatchObject({ ok: false, findings: [expect.objectContaining({ rule: "release-number" })] });
  });
});

describe("release digest", () => {
  it("canonicalizes object keys, includes every manifest field, and excludes digest itself", () => {
    const input = fixture(); const result = prepareContentRelease(input); if (!result.ok) throw new Error("Fixture rejected");
    const manifest = result.releases[0]!.manifest;
    const { digest, ...body } = manifest;
    expect(computeReleaseDigest(body)).toBe(digest);
    expect(computeReleaseDigest({ ...body, entries: body.entries.map(entry => ({ digest: entry.digest, revision: entry.revision, candidateId: entry.candidateId, slotId: entry.slotId, route: entry.route! })) })).toBe(digest);
    for (const change of [{ targetId: "other" }, { n: 2 }, { at: "2026-01-02T00:00:00Z" }, { approvedBy: "other" }, { entries: [] }]) expect(computeReleaseDigest({ ...body, ...change })).not.toBe(digest);
    expect(computeReleaseDigest({ ...manifest, digest: "ignored" } as typeof body)).toBe(digest);
  });
});
