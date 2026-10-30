import type { ContentFinding } from "./composition.js";
import { isContentJson } from "./json.js";
import type { CandidateContent, ContentCandidate } from "./model.js";
import { rollUpStageStatuses, STAGE_STATUSES } from "./stages.js";
import type { StageStatus } from "./stages.js";
import { validateContentCandidate } from "./validate.js";
import { CANDIDATE_STATES, isRevisionId } from "./vocabulary.js";
import type { CandidateState, RevisionId } from "./vocabulary.js";

export type StageKey = "define" | "assemble" | "review" | "approve" | "publish";
export interface StageResult {
  readonly status: StageStatus;
  readonly findings: readonly ContentFinding[];
}
/** External checks must cover these exact candidate, revision, and snapshot bytes. */
export interface CandidateStageEvidence {
  readonly candidateId: string;
  readonly revision: RevisionId;
  readonly digest: string;
  readonly words?: StageResult;
  readonly visuals?: StageResult;
  readonly assembly?: StageResult;
  readonly review?: StageResult;
  readonly approval?: StageResult;
  readonly release?: StageResult;
}
export interface StageReport {
  readonly candidateId: string;
  readonly revision: RevisionId;
  readonly digest: string;
  readonly stages: Readonly<Record<StageKey, StageResult>>;
  readonly assemble: Readonly<{ words: StageStatus; visuals: StageStatus; assembly: StageStatus }>;
  readonly overall: StageStatus;
}

const finding = (path: string, rule: string, message: string): ContentFinding => ({ path, rule, message });
const result = (status: StageStatus, findings: readonly ContentFinding[] = []): StageResult => ({ status, findings });
const complete = (value: StageResult): boolean => value.status === "Done" || value.status === "Not applicable";
const contentKeys: readonly (keyof CandidateContent)[] = ["name", "brief", "composition", "redirectTarget", "pageMeta", "pageMetaAssets", "links", "typeSettings", "openQuestions"];

/** JSON value equality ignores object insertion order and preserves array order. */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameValue(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = left as Record<string, unknown>; const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

function combine(values: readonly StageResult[]): StageResult {
  return result(rollUpStageStatuses(values.map(value => value.status)), values.flatMap(value => value.findings));
}

/** An unsuccessful own check remains visible even while its prerequisite is blocked. */
function gated(value: StageResult, prerequisites: readonly StageResult[], stage: StageKey): StageResult {
  if (prerequisites.every(complete) || value.status === "Failing" || value.status === "Needs input") return value;
  return result("Waiting", [...value.findings, finding(`stages.${stage}`, "stage-prerequisite", "Earlier required stages must be complete")]);
}

function proofResult(value: unknown, key: string, allowNotApplicable: boolean): StageResult {
  if (value === undefined) return result("Waiting");
  const invalid = () => result("Failing", [finding(`evidence.${key}`, "stage-evidence", "Expected a known status and structured findings")]);
  if (!isContentJson(value) || !value || Array.isArray(value) || typeof value !== "object") return invalid();
  const proof = value as Record<string, unknown>;
  if (!STAGE_STATUSES.includes(proof.status as StageStatus) || !Array.isArray(proof.findings)
    || !proof.findings.every((entry: unknown) => {
      if (!entry || Array.isArray(entry) || typeof entry !== "object") return false;
      const item = entry as Record<string, unknown>;
      return typeof item.path === "string" && typeof item.rule === "string" && typeof item.message === "string";
    })) {
    return invalid();
  }
  const findings = proof.findings.map(entry => ({ ...(entry as ContentFinding) }));
  const status = proof.status as StageStatus;
  if ((status === "Done" || status === "Not applicable") && findings.length) return result("Failing", findings);
  if (status === "Not applicable" && !allowNotApplicable) {
    return result("Waiting", [finding(`evidence.${key}`, "required-stage-proof", "This stage requires an applicable check")]);
  }
  return result(status, findings);
}

function report(candidate: ContentCandidate, digest: string, stages: StageReport["stages"], assemble: StageReport["assemble"]): StageReport {
  return {
    candidateId: candidate.id, revision: candidate.revision, digest, stages, assemble,
    overall: rollUpStageStatuses(Object.values(stages).map(value => value.status)),
  };
}

/**
 * Derive readiness without I/O. Digest authenticity and external check execution
 * belong upstream; this engine binds supplied proof to the stored snapshot and
 * rejects current content that differs from that snapshot.
 * A missing or invalid report identity throws; malformed content returns Failing.
 */
export function computeStageReport(candidate: ContentCandidate, evidence?: CandidateStageEvidence): StageReport {
  if (!candidate || typeof candidate !== "object" || typeof candidate.id !== "string" || !candidate.id.trim() || !isRevisionId(candidate.revision)) {
    throw new TypeError("A stage report requires a candidate identity and pinned revision");
  }
  const latest = Array.isArray(candidate.history) ? candidate.history.at(-1) : undefined;
  const digest = typeof latest?.digest === "string" ? latest.digest : "";
  const missingAssembly = candidate.composition === undefined && candidate.redirectTarget === undefined;
  const findings = isContentJson(candidate) ? validateContentCandidate(candidate).filter(value => {
    // An incomplete current draft may have an equally incomplete latest snapshot.
    if (value.rule !== "composition-or-redirect" || !missingAssembly) return true;
    if (value.path === "candidate") return false;
    return !(value.path === `candidate.history[${candidate.history.length - 1}].content`
      && latest?.content?.composition === undefined && latest?.content?.redirectTarget === undefined);
  }) : [finding("candidate", "content-json", "Expected finite, acyclic JSON records")];
  if (!findings.length && latest && !contentKeys.every(key => sameValue(candidate[key], latest.content[key]))) {
    findings.push(finding("candidate.revision", "snapshot-content", "Current content differs from its latest revision snapshot"));
  }
  if (findings.length) {
    return report(candidate, digest, {
      define: result("Failing", findings), assemble: result("Waiting"), review: result("Waiting"),
      approve: result("Waiting"), publish: result("Waiting"),
    }, { words: "Waiting", visuals: "Waiting", assembly: "Waiting" });
  }

  const defineFindings: ContentFinding[] = [];
  for (const key of ["audience", "goal", "keyMessage", "callToAction", "tone"] as const) {
    if (!candidate.brief[key].trim()) defineFindings.push(finding(`candidate.brief.${key}`, "brief-required", "Complete this brief field"));
  }
  candidate.openQuestions.forEach((question, index) => {
    if (question.blocking) defineFindings.push(finding(`candidate.openQuestions[${index}]`, "blocking-question", question.question));
  });
  const define = result(defineFindings.length ? "Needs input" : "Done", defineFindings);
  const bindingFindings: ContentFinding[] = [];
  if (evidence !== undefined) {
    if (evidence?.candidateId !== candidate.id) bindingFindings.push(finding("evidence.candidateId", "evidence-candidate", "Evidence must cover this candidate"));
    if (evidence?.revision !== candidate.revision) bindingFindings.push(finding("evidence.revision", "evidence-revision", "Evidence must cover the current revision"));
    if (evidence?.digest !== digest) bindingFindings.push(finding("evidence.digest", "evidence-digest", "Evidence must cover the current snapshot digest"));
  }
  const check = (key: "words" | "visuals" | "assembly" | "review" | "approval" | "release", allowNotApplicable = true): StageResult => {
    const own = proofResult(evidence?.[key], key, allowNotApplicable);
    return bindingFindings.length ? result("Failing", [...bindingFindings, ...own.findings]) : own;
  };
  const redirect = candidate.redirectTarget !== undefined;
  const words = redirect ? result("Not applicable") : check("words");
  const visuals = redirect ? result("Not applicable") : check("visuals");
  let assembly = redirect ? result("Not applicable") : check("assembly", false);
  if (missingAssembly) assembly = combine([assembly, result("Needs input", [finding("candidate", "composition-or-redirect", "Provide a composition or redirect target")])]);
  const assemble = combine([words, visuals, assembly]);
  const review = gated(check("review", false), [define, assemble], "review");

  const approvalFindings: ContentFinding[] = [];
  const approval = candidate.approval;
  if (approval) {
    if (approval.revision !== candidate.revision) approvalFindings.push(finding("candidate.approval.revision", "approval-revision", "Approval must cover the current revision"));
    if (approval.digest !== digest) approvalFindings.push(finding("candidate.approval.digest", "approval-digest", "Approval must cover the current snapshot digest"));
    if (approval.source === "imported-baseline" && (candidate.origin !== "imported" || candidate.revision !== "r1")) {
      approvalFindings.push(finding("candidate.approval.source", "imported-baseline-scope", "Baseline activation requires an imported candidate's first revision"));
    }
  }
  const recordedApproval = approvalFindings.length ? result("Failing", approvalFindings)
    : approval ? result("Done") : result("Waiting", [finding("candidate.approval", "approval-required", "Record current revision approval")]);
  const approve = gated(combine([check("approval", false), recordedApproval]), [define, assemble, review], "approve");
  const publicationRequirements: StageResult[] = [check("release", false)];
  if (candidate.state !== "active") publicationRequirements.push(result("Waiting", [finding("candidate.state", "publish-active-candidate", "Publishing requires an active candidate")]));
  if (approval && approval.source !== "owner") publicationRequirements.push(result("Failing", [finding("candidate.approval.source", "publish-owner-approval", "Publishing requires owner approval")]));
  const publish = gated(combine(publicationRequirements), [define, assemble, review, approve], "publish");
  return report(candidate, digest, { define, assemble, review, approve, publish }, {
    words: words.status, visuals: visuals.status, assembly: assembly.status,
  });
}

/** Retired candidates are terminal; valid identity transitions are permitted. */
export function canTransitionCandidateState(from: CandidateState, to: CandidateState): boolean {
  if (!CANDIDATE_STATES.includes(from) || !CANDIDATE_STATES.includes(to)) return false;
  if (from === to) return true;
  return (from === "draft" && to === "in-review")
    || (from === "in-review" && (to === "draft" || to === "approved"))
    || (from === "approved" && (to === "draft" || to === "active"))
    || (from === "active" && to === "retired");
}

/** Compute guards from evidence, then copy; state changes never release content. */
export function transitionContentCandidate(candidate: ContentCandidate, next: CandidateState, evidence: CandidateStageEvidence | undefined, updatedAt: string): ContentCandidate {
  if (typeof updatedAt !== "string" || !updatedAt.trim() || !Number.isFinite(Date.parse(updatedAt))) throw new TypeError("A state transition requires an explicit timestamp");
  if (!candidate || !canTransitionCandidateState(candidate.state, next)) throw new TypeError("Illegal candidate state transition");
  const current = computeStageReport(candidate, evidence);
  const required: readonly StageKey[] = candidate.state === next ? []
    : next === "in-review" ? ["define", "assemble"]
      : next === "approved" ? ["define", "assemble", "review", "approve"]
        : next === "active" ? ["define", "assemble", "review", "approve"] : [];
  if (required.some(key => !complete(current.stages[key]))) throw new TypeError("Required candidate stages are incomplete");
  const copy = structuredClone(candidate);
  if (next === "draft" && candidate.state !== "draft") {
    const { approval: _approval, ...draft } = copy;
    return { ...draft, state: next, updatedAt };
  }
  return { ...copy, state: next, updatedAt };
}
