import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createContentRevision } from "../../content/revisions.js";
import type { CandidateContent, ContentRegistry } from "../../content/model.js";
import type { CandidateStageEvidence } from "../../content/stage-engine.js";
import { mainPublisherContent } from "../../content/cli/index.js";
import { checkPublisherIACoverage } from "./check.js";
import { loadPublisherIAInput, publisherPackageRoot } from "./load.js";
import type { CoverageInput } from "./types.js";

const at = "2026-01-01T00:00:00Z", slotId = "sl_622lk7eoar" as const;
function fixture(): CoverageInput {
  const content: CandidateContent = { name: "Designer", brief: { audience: "Operators", goal: "Inspect", keyMessage: "Review items", callToAction: "Inspect", tone: "Clear", constraints: [], sourceAnswers: [], version: 1 },
    composition: { frame: { frameId: "frames.app-shell", configId: "default" }, libraryVersion: "v1", sections: [
      { key: "content", sectionId: "sections.content", configId: "default", intent: "continues", fields: [
        { key: "body", source: "writer", locale: "en", ref: { id: "ps.0000000001", locale: "en" } },
      ] },
    ] }, links: [], typeSettings: {}, openQuestions: [] };
  const revision = createContentRevision(content, "r1", at);
  const registry: ContentRegistry = { workspace: { consumerId: "sample", defaultLocale: "en", locales: ["en"], deployTargets: [], destinations: [] },
    slots: [{ id: slotId, aliases: [], locales: ["en"], l1: "websites", l2: "admin", position: { name: "designer", order: 0 }, name: "Designer", kind: "content", route: "/agents/designer", devOnly: false, tags: [], releases: [], createdAt: at }],
    candidates: [{ ...content, id: "designer", slotId, origin: "agent-draft", state: "draft", revision: "r1", tags: [], history: [revision], updatedAt: at }] };
  return { contentTree: { schemaVersion: 1, nodes: [{ id: "websites", label: "Websites", children: [{ id: "admin", label: "Admin", frame: "app-shell" }] }] },
    declaredSlots: [slotId], registry, formatTree: { nodes: [] }, formats: [],
    designer: [{ id: "frames.app-shell" }, { id: "sections.content", passageSchema: "passages.content" }],
    writer: [{ id: "passages.content", kind: "schema", sectionId: "sections.content" }, { id: "ps.0000000001", kind: "record", schema: "passages.content", locales: ["en"] }],
    libraries: [{ consumerId: "sample", version: "v1", frames: [{ id: "frames.app-shell", configIds: ["default"] }], sections: [{ id: "sections.content", configIds: ["default"] }], assetIds: [] }],
    evidence: [], edges: [], needs: [], unavailable: [] };
}
function proof(input: CoverageInput): CandidateStageEvidence {
  const candidate = input.registry!.candidates[0]!;
  const done = { status: "Done" as const, findings: [] };
  return { candidateId: candidate.id, revision: candidate.revision, digest: candidate.history.at(-1)!.digest,
    words: done, visuals: done, assembly: done, review: done, approval: done, release: done };
}
const slot = (report: ReturnType<typeof checkPublisherIACoverage>) => report.leaves.find(row => row.id === `publisher:slot/${slotId}`)!;
const temps: string[] = [];
afterEach(() => { for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("Publisher IA coverage", () => {
  it("emits one named P0 for a declared missing leaf", () => {
    const input = fixture(); input.registry = { ...input.registry!, slots: [], candidates: [] };
    const findings = checkPublisherIACoverage(input).findings.filter(row => row.code === "IA-MISSING-LEAF");
    expect(findings).toEqual([expect.objectContaining({ subject: `publisher:slot/${slotId}`, priority: "P0" })]);
  });
  it("emits one named P0 for a dangling reference and records both connection directions", () => {
    const input = fixture(); input.edges.push({ from: "designer:sections.content", to: "writer:ps.0000000002", kind: "uses", evidence: "fixture" });
    const report = checkPublisherIACoverage(input);
    expect(report.findings.filter(row => row.code === "IA-DANGLING")).toEqual([expect.objectContaining({ subject: "designer:sections.content", target: "writer:ps.0000000002", priority: "P0" })]);
    expect(report.nodes.find(row => row.id === "writer:ps.0000000001")!.usedBy).toContain("publisher:candidate/designer");
  });
  it("emits one named orphan for one registered item without a consumer", () => {
    const input = fixture(); input.designer.push({ id: "sections.empty-state" });
    const report = checkPublisherIACoverage(input);
    expect(report.findings.filter(row => row.code === "IA-ORPHAN" && row.subject === "designer:sections.empty-state")).toEqual([
      expect.objectContaining({ priority: "P2" }),
    ]);
    expect(report.summary.orphans).toEqual(["designer:sections.empty-state"]);
  });
  it("keeps ids stable through regrouping and flags registry items outside the tree", () => {
    const input = fixture(), before = slot(checkPublisherIACoverage(input));
    input.registry = { ...input.registry!, slots: input.registry!.slots.map(row => ({ ...row, l2: "moved" })) };
    const report = checkPublisherIACoverage(input);
    expect(slot(report).id).toBe(before.id);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "IA-OUTSIDE-TREE", subject: before.id, priority: "P0" }));
  });
  it("does not infer checked or approved from candidate state, format built labels or empty proofs", () => {
    const input = fixture();
    input.registry = { ...input.registry!, candidates: input.registry!.candidates.map(row => ({ ...row, state: "active" })) };
    expect(slot(checkPublisherIACoverage(input)).state).toBe("draft");
    const bare = fixture(); bare.evidence = [{ ...proof(bare), words: undefined, visuals: undefined, assembly: undefined, review: undefined }];
    expect(slot(checkPublisherIACoverage(bare)).state).toBe("draft");
  });
  it("requires current authentic revision evidence and owner approval", () => {
    const input = fixture(); input.evidence = [proof(input)];
    expect(slot(checkPublisherIACoverage(input)).state).toBe("checked");
    const candidate = input.registry!.candidates[0]!;
    input.registry = { ...input.registry!, candidates: [{ ...candidate, approval: { by: "owner", at, revision: "r1", digest: candidate.history[0]!.digest, source: "owner" } }] };
    expect(slot(checkPublisherIACoverage(input)).state).toBe("approved");
    input.evidence = [{ ...proof(input), digest: "0".repeat(64) }];
    expect(slot(checkPublisherIACoverage(input)).state).toBe("draft");
    input.evidence = [proof(input)];
    input.registry = { ...input.registry!, candidates: [{ ...input.registry!.candidates[0]!, name: "Changed without snapshot" }] };
    const report = checkPublisherIACoverage(input);
    expect(slot(report).state).toBe("draft");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "IA-REVISION-INTEGRITY", priority: "P0" }));
  });
  it("uses native worst-stage rollups, preserves failing proof, and never calls a candidate-free slot done", () => {
    const input = fixture(); input.evidence = [{ ...proof(input), visuals: { status: "Failing", findings: [{ path: "visuals", rule: "fixture", message: "Failed" }] } }];
    let report = checkPublisherIACoverage(input);
    expect(slot(report).stages.assemble).toBe("Failing");
    expect(slot(report).stages.review).toBe("Waiting");
    input.registry = { ...input.registry!, candidates: [] }; input.evidence = [];
    report = checkPublisherIACoverage(input);
    expect(slot(report).state).toBe("absent"); expect(slot(report).stages.define).toBe("Needs input");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "IA-UNFILLED", priority: "P1", subject: slot(report).id }));
  });
  it("checks exact consumer version/config, missing Writer schemas and a mismatched schema owner", () => {
    const input = fixture(); input.libraries = [{ ...input.libraries[0]!, version: "other" }];
    let report = checkPublisherIACoverage(input);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "IA-COMPOSITION-REFERENCE", priority: "P0" }));
    input.libraries = fixture().libraries; input.writer = input.writer.filter(row => row.id !== "passages.content");
    report = checkPublisherIACoverage(input);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "IA-DANGLING", target: "writer:passages.content", priority: "P0" }));
    input.writer = [{ id: "passages.content", kind: "schema", sectionId: "sections.wrong" }];
    expect(checkPublisherIACoverage(input).findings).toContainEqual(expect.objectContaining({ code: "IA-SCHEMA-OWNER", priority: "P0" }));
  });
  it("rejects a passage whose registered schema belongs to a different section", () => {
    const input = fixture(); input.evidence = [proof(input)];
    input.designer.push({ id: "sections.empty-state", passageSchema: "passages.empty-state" });
    input.writer.push({ id: "passages.empty-state", kind: "schema", sectionId: "sections.empty-state" });
    input.writer = input.writer.map(row => row.id === "ps.0000000001" ? { ...row, schema: "passages.empty-state" } : row);
    const report = checkPublisherIACoverage(input);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "IA-COPY-SCHEMA", priority: "P0", subject: "publisher:candidate/designer" }));
    expect(slot(report).state).toBe("draft");
  });
  it("detects one cycle, validates reverse ownership without inventing a consumption cycle", () => {
    const input = fixture();
    expect(checkPublisherIACoverage(input).summary.cycles).toEqual([]);
    input.edges.push({ from: "writer:ps.0000000001", to: "publisher:candidate/designer", kind: "uses", evidence: "fixture-cycle" });
    const report = checkPublisherIACoverage(input);
    expect(report.summary.cycles).toHaveLength(1);
    expect(report.findings.filter(row => row.code === "IA-CYCLE")).toHaveLength(1);
  });
  it("distinguishes unavailable package input from a proven dangling reference", () => {
    const input = fixture(); input.writer = []; input.unavailable = ["writer"];
    const report = checkPublisherIACoverage(input);
    expect(report.summary.unresolved.some(row => row.to === "writer:passages.content")).toBe(true);
    expect(report.findings.some(row => row.code === "IA-DANGLING" && row.target?.startsWith("writer:"))).toBe(false);
  });
  it("reads the real catalog without fixtures, remains cwd-independent and preserves all input bytes", () => {
    const input = loadPublisherIAInput(), before = JSON.stringify(input);
    const report = checkPublisherIACoverage(input);
    expect(input.registry).toBeUndefined(); expect(input.declaredSlots).toHaveLength(18);
    expect(input.formats).toHaveLength(6); expect(report.summary.states.draft).toBe(6);
    expect(report.summary.states.checked).toBe(0); expect(report.summary.states.approved).toBe(0);
    expect(report.basis.registryObserved).toBe(false); expect(report.basis.needs.some(row => row.includes("ContentRegistry"))).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(checkPublisherIACoverage(input))).toBe(JSON.stringify(report));
  });
  it("registers a read-only package command and emits the same real JSON report and summary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-ia-")); temps.push(dir);
    expect(await mainPublisherContent(["ia-coverage", "--help"])).toMatchObject({ exitCode: 0 });
    const out = join(dir, "ia-coverage.json"), result = await mainPublisherContent(["ia-coverage", "--out", out]);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(readFileSync(out, "utf8")); expect(report.kind).toBe("publisher-ia-coverage");
    expect(result.data).toMatchObject({ summary: report.summary });
    const protectedFile = join(dir, "registry.json"); writeFileSync(protectedFile, '{"slots":[]}');
    expect((await mainPublisherContent(["ia-coverage", "--out", protectedFile])).exitCode).toBe(2);
    expect(readFileSync(protectedFile, "utf8")).toBe('{"slots":[]}');
  });
});

describe("guard regressions", () => {
  it("requires an active selected candidate for complete admin reachability", () => {
    const input = fixture(), source = input.registry!;
    const ids = [slotId, "sl_lsqwmhpf6l", "sl_hfkj3prso2"] as const;
    const routes = ["/agents/designer", "/agents/writer", "/agents/publisher"];
    input.declaredSlots = [...ids];
    input.registry = { ...source, slots: ids.map((id, index) => ({ ...source.slots[0]!, id, route: routes[index] })),
      candidates: ids.map((id, index) => ({ ...source.candidates[0]!, id: `page${index}`, slotId: id })) };
    const report = checkPublisherIACoverage(input);
    expect(report.basis.adminInputsComplete).toBe(false);
    expect(report.nodes.find(row => row.id === "writer:ps.0000000001")!.admin).toBe("unknown");
  });
  it("keeps required unavailable package resolution below checked", () => {
    const input = fixture(); input.evidence = [proof(input)]; input.writer = []; input.unavailable = ["writer"];
    const report = checkPublisherIACoverage(input);
    expect(slot(report).state).toBe("draft"); expect(slot(report).stages.assemble).toBe("Needs input");
  });
  it("does not inspect bodies of excluded or route-less pages", () => {
    const input = fixture(); input.evidence = [proof(input)];
    let inspected = 0;
    const outside = { ...input.registry!.candidates[0]!, id: "outside", slotId: "sl_lsqwmhpf6l" as const,
      get composition() { inspected++; throw new Error("Outside scope body must not be read"); } };
    input.registry = { ...input.registry!, slots: [...input.registry!.slots, { ...input.registry!.slots[0]!, id: "sl_lsqwmhpf6l", route: undefined }], candidates: [...input.registry!.candidates, outside] };
    const report = checkPublisherIACoverage(input);
    expect(inspected).toBe(0); expect(slot(report).state).toBe("checked");
    expect(report.summary.excludedSlots).toEqual(["sl_lsqwmhpf6l"]);
  });
  it("rejects ambiguous Writer records but permits distinct-locale translations", () => {
    const root = mkdtempSync(join(tmpdir(), "writer-ia-identity-")); temps.push(root);
    mkdirSync(join(root, "slots")); mkdirSync(join(root, "records"));
    writeFileSync(join(root, "slots/passages.json"), "[]");
    const row = { id: "st.0000000001", text: "One", status: "draft" };
    const path = join(root, "records/copy.json");
    writeFileSync(path, JSON.stringify({ locale: "en", records: [row, { ...row, text: "Two" }] }));
    expect(() => loadPublisherIAInput({ writerCatalog: root })).toThrow(/Duplicate Writer record/);
    writeFileSync(path, JSON.stringify({ locales: { en: { records: [row] }, ar: { records: [{ ...row, text: "آخر" }] } } }));
    expect(loadPublisherIAInput({ writerCatalog: root }).writer.find(entry => entry.id === row.id)!.locales).toEqual(["ar", "en"]);
  });
  it("rejects copy available only in a different locale", () => {
    const input = fixture(); input.evidence = [proof(input)];
    input.writer = input.writer.map(row => row.kind === "record" ? { ...row, locales: ["ar"] } : row);
    const report = checkPublisherIACoverage(input);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "IA-COPY-LOCALE", priority: "P0" }));
    expect(slot(report).state).toBe("draft");
  });
  it("refuses report writes into implicit dist input directories", async () => {
    const path = join(publisherPackageRoot, "dist/ia-coverage-source-guard.json");
    const result = await mainPublisherContent(["ia-coverage", "--out", path]);
    if (existsSync(path)) { rmSync(path); }
    expect(result.exitCode).toBe(2);
  });
  it("reports legacy inline copy instead of claiming a registered Writer link", () => {
    const input = fixture(), candidate = input.registry!.candidates[0]!;
    const composition = { ...candidate.composition!, sections: candidate.composition!.sections.map(section => ({ ...section, fields: [{ key: "body", locale: "en", source: "writer" as const, value: "Unregistered words" }] })) };
    const next = { ...candidate, composition, history: [createContentRevision({ ...candidate, composition }, "r1", at)] };
    input.registry = { ...input.registry!, candidates: [next] }; input.evidence = [proof(input)];
    const report = checkPublisherIACoverage(input);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "IA-COPY-REF", priority: "P0" }));
    expect(slot(report).state).toBe("draft");
  });
  it("rejects duplicate declared IA groups", () => {
    const input = fixture(); input.contentTree = { ...input.contentTree, nodes: [...input.contentTree.nodes, input.contentTree.nodes[0]!] };
    expect(checkPublisherIACoverage(input).findings).toContainEqual(expect.objectContaining({ code: "IA-DUPLICATE", priority: "P0", subject: "slots:websites" }));
  });
  it("does not advance a fill whose owning slot identity is ambiguous", () => {
    const input = fixture(); input.evidence = [proof(input)];
    input.registry = { ...input.registry!, slots: [...input.registry!.slots, input.registry!.slots[0]!] };
    const report = checkPublisherIACoverage(input);
    expect(slot(report).registered).toBe(false); expect(slot(report).state).toBe("draft");
    expect(slot(report).stages.define).toBe("Failing");
  });
  it("checks pinned historical bytes and keeps out-of-scope dependencies unresolved", () => {
    const input = fixture(), current = input.registry!.candidates[0]!;
    const source = { ...current, id: "source" };
    const composition = { ...current.composition!, sections: current.composition!.sections.map(section => ({ ...section,
      ref: { candidateId: "source", revision: "r1" as const, sectionKey: section.key } })) };
    const root = { ...current, composition, history: [createContentRevision({ ...current, composition }, "r1", at)] };
    input.registry = { ...input.registry!, candidates: [root, source] };
    expect(checkPublisherIACoverage(input).findings.some(row => row.code === "IA-COMPOSITION-REFERENCE")).toBe(false);
    input.registry = { ...input.registry!, candidates: [root, { ...source, history: [{ ...source.history[0]!, digest: "0".repeat(64) }] }] };
    expect(checkPublisherIACoverage(input).findings).toContainEqual(expect.objectContaining({ code: "IA-COMPOSITION-REFERENCE", subject: "publisher:candidate/designer", message: expect.stringContaining("pinned-revision-digest") }));
    let inspected = 0;
    input.registry = { ...input.registry!, slots: [...input.registry!.slots, { ...input.registry!.slots[0]!, id: "sl_lsqwmhpf6l", route: undefined }],
      candidates: [root, { ...source, slotId: "sl_lsqwmhpf6l", get history() { inspected++; throw new Error("Excluded history must not be inspected"); } }] };
    const report = checkPublisherIACoverage(input);
    expect(inspected).toBe(0);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "IA-OUT-OF-SCOPE", priority: "P1", subject: "publisher:candidate/designer" }));
    expect(slot(report).state).toBe("draft");
  });
  it("runs the emitted package command from an unrelated cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-ia-cwd-")); temps.push(dir);
    const path = join(dir, "ia-coverage.json");
    const run = spawnSync(process.execPath, [join(publisherPackageRoot, "dist/content/node.js"), "ia-coverage", "--out", path], { cwd: dir, encoding: "utf8" });
    expect(run.status, run.stderr).toBe(1);
    const report = JSON.parse(readFileSync(path, "utf8"));
    expect(report.summary.levels).toEqual({ L0: 2, L1: 12, L2: 16, L3: 24 });
    expect(report.summary.states).toEqual({ absent: 18, draft: 6, checked: 0, approved: 0 });
  });
});
