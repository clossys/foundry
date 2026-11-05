import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { computeStageReport, canTransitionCandidateState, transitionContentCandidate } from "./stage-engine.js";
import type { CandidateStageEvidence } from "./stage-engine.js";
import type { CandidateContent, ContentCandidate } from "./model.js";
import { CANDIDATE_STATES } from "./vocabulary.js";
import { rollUpStageStatuses } from "./stages.js";
import { computeContentDigest } from "./digest.js";
import { createContentRevision } from "./revisions.js";
import { at } from "./__fixtures__/review.js";
import { snapshotCandidate, stageCandidate, stageEvidence, stageResult, transitionedAt } from "./__fixtures__/stage-engine.js";

const finding = { path: "candidate.composition", rule: "external-check", message: "Check needs attention" };
const statuses = (candidate: ContentCandidate, evidence?: CandidateStageEvidence) =>
  Object.fromEntries(Object.entries(computeStageReport(candidate, evidence).stages).map(([stage, result]) => [stage, result.status]));

describe("evidence-derived five-stage reports", () => {
  it("reports a real snapshot with current owner approval and bound external proof", () => {
    const candidate = stageCandidate(); const evidence = stageEvidence(candidate);
    const before = structuredClone({ candidate, evidence });
    const report = computeStageReport(candidate, evidence);
    expect(report).toMatchObject({ candidateId: candidate.id, revision: "r1", digest: candidate.history[0]!.digest, overall: "Done" });
    expect(statuses(candidate, evidence)).toEqual({ define: "Done", assemble: "Done", review: "Done", approve: "Done", publish: "Done" });
    expect(report.assemble).toEqual({ words: "Done", visuals: "Done", assembly: "Done" });
    expect(Object.values(report.stages).every(result => result.findings.length === 0)).toBe(true);
    expect({ candidate, evidence }).toEqual(before);
  });

  it("does not infer external checks or a release from an active state", () => {
    const candidate = stageCandidate();
    expect(statuses(candidate)).toEqual({ define: "Done", assemble: "Waiting", review: "Waiting", approve: "Waiting", publish: "Waiting" });
    expect(computeStageReport(candidate).overall).toBe("Waiting");
    const evidence = stageEvidence(candidate); delete (evidence as any).release;
    expect(statuses(candidate, evidence).publish).toBe("Waiting");
  });

  it.each(["words", "visuals", "assembly", "review", "approval", "release"] as const)("waits for missing %s evidence even when all other checks completed", key => {
    const candidate = stageCandidate(); const evidence = stageEvidence(candidate);
    delete (evidence as any)[key];
    const stage = { words: "assemble", visuals: "assemble", assembly: "assemble", review: "review", approval: "approve", release: "publish" }[key] as "assemble" | "review" | "approve" | "publish";
    expect(computeStageReport(candidate, evidence).stages[stage].status).toBe("Waiting");
  });

  it.each(["audience", "goal", "keyMessage", "callToAction", "tone"] as const)("requires brief %s", field => {
    const base = stageCandidate();
    const candidate = snapshotCandidate({ ...base, brief: { ...base.brief, [field]: " \t " } });
    const report = computeStageReport(candidate, stageEvidence(candidate));
    expect(report.stages.define.status).toBe("Needs input");
    expect(report.stages.define.findings.length).toBeGreaterThan(0);
    expect(report.stages.review.status).toBe("Waiting");
    expect(report.stages.approve.status).toBe("Waiting");
    expect(report.stages.publish.status).toBe("Waiting");
    expect(report.overall).toBe("Needs input");
  });

  it("distinguishes blocking questions from nonblocking questions", () => {
    const base = stageCandidate();
    const question = { field: "brief.goal", question: "Which goal?", blocking: false };
    const nonblocking = snapshotCandidate({ ...base, openQuestions: [question] });
    expect(computeStageReport(nonblocking, stageEvidence(nonblocking)).stages.define.status).toBe("Done");
    const blocking = snapshotCandidate({ ...base, openQuestions: [{ ...question, blocking: true }] });
    expect(computeStageReport(blocking, stageEvidence(blocking)).stages.define.status).toBe("Needs input");
  });

  it("asks for assembly input when a draft has neither composition nor redirect", () => {
    const base = stageCandidate();
    const { composition: _composition, ...incomplete } = base;
    const content = { ...base.history[0]!.content } as any; delete content.composition;
    const digest = computeContentDigest(content);
    const candidate: ContentCandidate = { ...incomplete, state: "draft", history: [{ revision: "r1", digest, content, createdAt: at }], approval: { ...base.approval!, digest } };
    expect(computeStageReport(candidate, stageEvidence(candidate)).stages.assemble.status).toBe("Needs input");
  });

  it("makes redirect assembly inapplicable while keeping downstream proof required", () => {
    const { composition: _composition, ...base } = stageCandidate();
    const candidate = snapshotCandidate({ ...base, redirectTarget: "/destination" });
    const evidence = stageEvidence(candidate);
    delete (evidence as any).words; delete (evidence as any).visuals; delete (evidence as any).assembly;
    const report = computeStageReport(candidate, evidence);
    expect(report.stages.assemble.status).toBe("Not applicable");
    expect(report.assemble).toEqual({ words: "Not applicable", visuals: "Not applicable", assembly: "Not applicable" });
    expect(report.stages.review.status).toBe("Done");
    expect(report.stages.publish.status).toBe("Done");
    delete (evidence as any).review;
    expect(statuses(candidate, evidence).review).toBe("Waiting");
    expect(statuses(candidate, evidence).approve).toBe("Waiting");
  });

  it("allows a genuinely absent visual requirement without weakening assembly checks", () => {
    const base = stageCandidate();
    const candidate = snapshotCandidate({ ...base, typeSettings: {}, composition: { ...base.composition!, sections: base.composition!.sections.map(({ assets: _assets, ...section }) => section) } });
    const evidence = { ...stageEvidence(candidate), visuals: stageResult("Not applicable") };
    expect(computeStageReport(candidate, evidence).stages.assemble.status).toBe("Done");
    expect(computeStageReport(candidate, evidence).assemble.visuals).toBe("Not applicable");
  });

  it("requires an assembly check for a composition even when proof claims Not applicable", () => {
    const candidate = { ...stageCandidate(), state: "draft" as const };
    const evidence = { ...stageEvidence(candidate), assembly: stageResult("Not applicable") };
    const report = computeStageReport(candidate, evidence);
    expect(report.assemble.assembly).toBe("Waiting");
    expect(report.stages.assemble.status).toBe("Waiting");
    expect(() => transitionContentCandidate(candidate, "in-review", evidence, transitionedAt)).toThrow(TypeError);
  });

  it.each(["words", "visuals", "assembly"] as const)("rolls up a failing %s check and preserves its finding", key => {
    const candidate = stageCandidate();
    const evidence = { ...stageEvidence(candidate), [key]: { status: "Failing" as const, findings: [finding] } };
    const report = computeStageReport(candidate, evidence);
    expect(report.assemble[key]).toBe("Failing");
    expect(report.stages.assemble.status).toBe("Failing");
    expect(report.stages.assemble.findings).toContainEqual(finding);
    expect(report.stages.review.status).toBe("Waiting");
    expect(report.overall).toBe(rollUpStageStatuses(Object.values(report.stages).map(result => result.status)));
    expect(report.overall).toBe("Failing");
  });

  it("preserves actual downstream failure while an upstream stage is waiting", () => {
    const candidate = stageCandidate();
    const evidence = { ...stageEvidence(candidate), words: stageResult("Waiting"), review: { status: "Failing" as const, findings: [finding] }, approval: stageResult("Needs input") };
    const report = computeStageReport(candidate, evidence);
    expect(report.stages.review.status).toBe("Failing");
    expect(report.stages.review.findings).toContainEqual(finding);
    expect(report.stages.approve.status).toBe("Needs input");
    expect(report.stages.publish.status).toBe("Waiting");
    expect(report.overall).toBe("Failing");
  });

  it.each(["review", "approval", "release"] as const)("does not let %s skip required proof with Not applicable", key => {
    const candidate = stageCandidate();
    const evidence = { ...stageEvidence(candidate), [key]: stageResult("Not applicable") };
    const stage = { review: "review", approval: "approve", release: "publish" }[key] as "review" | "approve" | "publish";
    expect(computeStageReport(candidate, evidence).stages[stage].status).not.toBe("Done");
    expect(computeStageReport(candidate, evidence).stages[stage].status).not.toBe("Not applicable");
  });

  it("rejects a Done claim that carries unresolved findings", () => {
    const candidate = stageCandidate();
    const evidence = { ...stageEvidence(candidate), review: { status: "Done" as const, findings: [finding] } };
    const report = computeStageReport(candidate, evidence);
    expect(report.stages.review.status).toBe("Failing");
    expect(report.stages.review.findings).toContainEqual(finding);
    expect(report.overall).toBe("Failing");
  });

  it.each([{ status: "green", findings: [] }, { status: "Done", findings: "not findings" }])("reports malformed external check data as Failing (%j)", review => {
    const candidate = stageCandidate();
    const evidence = { ...stageEvidence(candidate), review } as unknown as CandidateStageEvidence;
    expect(computeStageReport(candidate, evidence).stages.review.status).toBe("Failing");
  });

  it.each(["candidateId", "revision", "digest"] as const)("rejects evidence with a mismatched %s", key => {
    const candidate = stageCandidate();
    const evidence = { ...stageEvidence(candidate), [key]: key === "revision" ? "r2" : "different" } as CandidateStageEvidence;
    const report = computeStageReport(candidate, evidence);
    expect(report.overall).toBe("Failing");
    expect(report.stages.publish.status).not.toBe("Done");
    expect(Object.values(report.stages).some(result => result.findings.length > 0)).toBe(true);
  });

  it.each(["current", "snapshot"] as const)("rejects unsaved %s content even with the old digest proof", location => {
    const candidate = stageCandidate() as any; const evidence = stageEvidence(candidate);
    if (location === "current") candidate.composition.sections[0].fields[0].value = "Unsaved copy";
    else candidate.history[0].content.composition.sections[0].fields[0].value = "Changed snapshot";
    expect(computeStageReport(candidate, evidence).overall).toBe("Failing");
  });

  it("compares JSON object keys independently of insertion order and ignores workflow tags", () => {
    const base = stageCandidate();
    const candidate = { ...base, brief: Object.fromEntries(Object.entries(base.brief).reverse()) as unknown as ContentCandidate["brief"], typeSettings: Object.fromEntries(Object.entries(base.typeSettings).reverse()), tags: ["bundle:sample"], updatedAt: transitionedAt };
    expect(computeStageReport(candidate, stageEvidence(candidate)).overall).toBe("Done");
  });

  it("keeps section array order significant when comparing a current revision", () => {
    const base = stageCandidate(); const section = base.composition!.sections[0]!;
    const candidate = snapshotCandidate({ ...base, composition: { ...base.composition!, sections: [section, { ...section, key: "second" }] } });
    const reordered = { ...candidate, composition: { ...candidate.composition!, sections: [...candidate.composition!.sections].reverse() } };
    expect(computeStageReport(reordered, stageEvidence(candidate)).overall).toBe("Failing");
  });

  it.each([null, [], {}, { id: "sample", revision: "latest" }])("rejects input without a report identity (%j)", value => {
    expect(() => computeStageReport(value as any)).toThrow(TypeError);
  });

  it.each([{ history: null }, { brief: { goal: 1 } }])("reports malformed content with a valid candidate identity (%j)", patch => {
    const value = { ...stageCandidate(), ...patch } as any;
    expect(() => computeStageReport(value)).not.toThrow();
    expect(computeStageReport(value).stages.define.status).toBe("Failing");
    expect(computeStageReport(value).overall).toBe("Failing");
  });

  it("requires current revision and digest approval metadata in addition to external proof", () => {
    const candidate = stageCandidate(); const evidence = stageEvidence(candidate);
    const { approval: _approval, ...unapproved } = candidate;
    expect(computeStageReport(unapproved, evidence).stages.approve.status).not.toBe("Done");
    for (const approval of [{ ...candidate.approval!, revision: "r2" as const }, { ...candidate.approval!, digest: "stale" }]) {
      expect(computeStageReport({ ...candidate, approval }, evidence).stages.approve.status).toBe("Failing");
    }
    delete (evidence as any).approval;
    expect(computeStageReport(candidate, evidence).stages.approve.status).toBe("Waiting");
  });

  it("accepts imported r1 baseline activation but requires owner approval to Publish", () => {
    const base = stageCandidate();
    const candidate = { ...base, origin: "imported" as const, state: "approved" as const, approval: { ...base.approval!, source: "imported-baseline" as const } };
    const evidence = stageEvidence(candidate);
    expect(computeStageReport(candidate, evidence).stages.approve.status).toBe("Done");
    const active = transitionContentCandidate(candidate, "active", evidence, transitionedAt);
    expect(active.state).toBe("active");
    expect(computeStageReport(active, evidence).stages.publish.status).not.toBe("Done");
    expect(computeStageReport({ ...active, approval: { ...active.approval!, source: "owner" } }, evidence).stages.publish.status).toBe("Done");
  });

  it("refuses baseline approval outside an imported candidate's first revision", () => {
    const base = stageCandidate();
    const wrongOrigin = { ...base, approval: { ...base.approval!, source: "imported-baseline" as const } };
    expect(computeStageReport(wrongOrigin, stageEvidence(wrongOrigin)).stages.approve.status).toBe("Failing");
    const content: CandidateContent = { ...base, name: "Revised" }; const next = createContentRevision(content, "r2", transitionedAt);
    const later: ContentCandidate = { ...base, ...content, origin: "imported", revision: "r2", history: [...base.history, next], approval: { ...base.approval!, source: "imported-baseline", revision: "r2", digest: next.digest } };
    expect(computeStageReport(later, stageEvidence(later)).stages.approve.status).toBe("Failing");
  });

  it("requires active state for a proven owner-approved publication", () => {
    const candidate = { ...stageCandidate(), state: "approved" as const };
    expect(computeStageReport(candidate, stageEvidence(candidate)).stages.publish.status).not.toBe("Done");
  });
});

describe("guarded candidate state transitions", () => {
  it("defines the complete legal state graph, including valid identity transitions", () => {
    const edges = new Set(["draft:in-review", "in-review:draft", "in-review:approved", "approved:draft", "approved:active", "active:retired"]);
    for (const from of CANDIDATE_STATES) for (const to of CANDIDATE_STATES) {
      expect(canTransitionCandidateState(from, to), `${from} -> ${to}`).toBe(from === to || edges.has(`${from}:${to}`));
    }
    expect(canTransitionCandidateState("unknown" as any, "unknown" as any)).toBe(false);
  });

  it("moves through review, approval, activation and terminal retirement with explicit time", () => {
    const draft = { ...stageCandidate(), state: "draft" as const }; const evidence = stageEvidence(draft);
    const before = structuredClone({ draft, evidence });
    let candidate = transitionContentCandidate(draft, "in-review", evidence, transitionedAt);
    candidate = transitionContentCandidate(candidate, "approved", evidence, transitionedAt);
    candidate = transitionContentCandidate(candidate, "active", evidence, transitionedAt);
    candidate = transitionContentCandidate(candidate, "retired", evidence, transitionedAt);
    expect(candidate.state).toBe("retired"); expect(candidate.updatedAt).toBe(transitionedAt);
    expect(candidate).not.toBe(draft); expect({ draft, evidence }).toEqual(before);
    for (const next of CANDIDATE_STATES.filter(value => value !== "retired")) {
      expect(() => transitionContentCandidate(candidate, next, evidence, transitionedAt)).toThrow(TypeError);
    }
  });

  it.each(["draft", "in-review", "approved", "active", "retired"] as const)("allows a valid %s no-op without mutating its input", state => {
    const candidate = { ...stageCandidate(), state }; const before = structuredClone(candidate);
    expect(transitionContentCandidate(candidate, state, stageEvidence(candidate), transitionedAt)).toMatchObject({ state, updatedAt: transitionedAt });
    expect(candidate).toEqual(before);
  });

  it.each(["in-review", "approved"] as const)("clears recorded approval when returning %s to draft", state => {
    const candidate = { ...stageCandidate(), state }; const before = structuredClone(candidate);
    const draft = transitionContentCandidate(candidate, "draft", stageEvidence(candidate), transitionedAt);
    expect(draft.state).toBe("draft"); expect(draft.approval).toBeUndefined(); expect(candidate).toEqual(before);
  });

  it("guards entering review on both brief and assembly completion", () => {
    const draft = { ...stageCandidate(), state: "draft" as const };
    const incomplete = snapshotCandidate({ ...draft, brief: { ...draft.brief, goal: "" } });
    expect(() => transitionContentCandidate(incomplete, "in-review", stageEvidence(incomplete), transitionedAt)).toThrow(TypeError);
    const evidence = { ...stageEvidence(draft), assembly: stageResult("Waiting") };
    expect(() => transitionContentCandidate(draft, "in-review", evidence, transitionedAt)).toThrow(TypeError);
  });

  it("guards approval on completed Review and bound approval proof", () => {
    const candidate = { ...stageCandidate(), state: "in-review" as const };
    for (const evidence of [{ ...stageEvidence(candidate), review: stageResult("Failing") }, { ...stageEvidence(candidate), approval: undefined }]) {
      expect(() => transitionContentCandidate(candidate, "approved", evidence, transitionedAt)).toThrow(TypeError);
    }
  });

  it("guards activation on every prior stage, but does not require a release first", () => {
    const candidate = { ...stageCandidate(), state: "approved" as const }; const evidence = stageEvidence(candidate);
    delete (evidence as any).release;
    expect(transitionContentCandidate(candidate, "active", evidence, transitionedAt).state).toBe("active");
    expect(() => transitionContentCandidate(candidate, "active", { ...evidence, review: stageResult("Waiting") }, transitionedAt)).toThrow(TypeError);
  });

  it("cannot borrow a sibling candidate's successful report to pass a transition", () => {
    const sibling = stageCandidate(); const candidate = { ...sibling, id: "sibling", state: "approved" as const };
    expect(() => transitionContentCandidate(candidate, "active", stageEvidence(sibling), transitionedAt)).toThrow(TypeError);
  });

  it.each(["", "not-a-timestamp"])("rejects an invalid transition timestamp (%s)", updatedAt => {
    const candidate = stageCandidate();
    expect(() => transitionContentCandidate(candidate, "retired", stageEvidence(candidate), updatedAt)).toThrow(TypeError);
  });

  it("rejects invalid direct state jumps even with complete evidence", () => {
    const candidate = { ...stageCandidate(), state: "draft" as const };
    expect(() => transitionContentCandidate(candidate, "active", stageEvidence(candidate), transitionedAt)).toThrow(TypeError);
  });
});

describe("stage engine runtime boundary", () => {
  it("imports and computes from the public barrel while every Node built-in is refused", () => {
    const target = new URL("./index.ts", import.meta.url).href;
    const candidate = stageCandidate(); const evidence = stageEvidence(candidate);
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { register } from 'node:module';
      register('data:text/javascript,' + encodeURIComponent(
        "export async function resolve(specifier, context, next) {" +
        "if (specifier.startsWith('node:')) throw new Error('Node builtin reached: ' + specifier);" +
        "if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) specifier = specifier.slice(0, -3) + '.ts';" +
        "return next(specifier, context); }"
      ));
      const content = await import(${JSON.stringify(target)});
      const report = content.computeStageReport(${JSON.stringify(candidate)}, ${JSON.stringify(evidence)});
      if (report.overall !== 'Done') throw new Error('Bound fixture did not complete');
      if (!content.canTransitionCandidateState('draft', 'in-review')) throw new Error('Missing transition graph');
      if (typeof content.transitionContentCandidate !== 'function') throw new Error('Missing guarded transition');
    `], { encoding: "utf8" });
    expect(result.stderr).toBe(""); expect(result.status).toBe(0);
  });
});
