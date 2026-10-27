import type { CompositionSection, ContentFinding } from "./composition.js";
import { computeContentDigest } from "./digest.js";
import { isContentJson } from "./json.js";
import type { ContentCandidate, ContentRegistry } from "./model.js";
import { validateContentRevisionIntegrity } from "./revisions.js";
import { validateContentRegistry } from "./validate.js";

export type ContentApprovalPurpose = "activation" | "publish";

/** Node-only digest-bound approval prerequisite; no stage or publication is performed. */
export function checkContentApproval(value: unknown, purpose: ContentApprovalPurpose): readonly ContentFinding[] {
  if (!isContentJson(value)) return [{ path: "candidate", rule: "content-json", message: "Expected finite, acyclic JSON records" }];
  const findings = [...validateContentRevisionIntegrity(value)];
  const add = (rule: string, message: string) => findings.push({ path: "candidate.approval", rule, message });
  if (purpose !== "activation" && purpose !== "publish") add("approval-purpose", "Expected activation or publish");
  if (findings.length) return findings;
  const candidate = value as unknown as ContentCandidate;
  const approval = candidate.approval;
  if (!approval) { add("approval-required", "Current revision requires recorded approval"); return findings; }
  if (approval.revision !== candidate.revision) add("approval-revision", "Approval does not cover the current revision");
  if (approval.digest !== computeContentDigest(candidate)) add("approval-digest", "Approval does not cover current content");
  if (purpose === "publish") {
    if (approval.source !== "owner") add("publish-owner-approval", "Publishing requires owner approval");
    if (candidate.state !== "active") add("publish-active-candidate", "Publishing requires an active candidate");
  }
  return findings;
}

/** Check only pinned snapshots: an unrelated source draft is not the referenced bytes. */
function checkPinnedIntegrity(registry: ContentRegistry, candidate: ContentCandidate, path: string): readonly ContentFinding[] {
  const findings: ContentFinding[] = [];
  const candidates = new Map(registry.candidates.map(value => [value.id, value]));
  function visit(section: CompositionSection, path: string, ancestors: ReadonlySet<string>): void {
    if (!section.ref) return;
    const ref = section.ref;
    const identity = JSON.stringify([ref.candidateId, ref.revision, ref.sectionKey]);
    if (ancestors.has(identity)) { findings.push({ path, rule: "section-reference-cycle", message: "Pinned section reference is cyclic" }); return; }
    const snapshot = candidates.get(ref.candidateId)?.history.find(value => value.revision === ref.revision);
    const target = snapshot?.content.composition?.sections.find(value => value.key === ref.sectionKey);
    if (!snapshot || !target) { findings.push({ path, rule: "unresolved-section-reference", message: "Pinned candidate revision and section key must exist" }); return; }
    if (snapshot.digest !== computeContentDigest(snapshot.content)) findings.push({ path, rule: "pinned-revision-digest", message: "Pinned snapshot content differs from its digest" });
    visit(target, `${path}.ref`, new Set([...ancestors, identity]));
  }
  candidate.composition?.sections.forEach((section, i) => visit(section, `${path}.composition.sections[${i}].ref`, new Set()));
  return findings;
}

/** Structural one-active/pointer checks plus current digest approval of every active candidate. */
export function checkContentActivation(value: unknown): readonly ContentFinding[] {
  if (!isContentJson(value)) return [{ path: "registry", rule: "content-json", message: "Expected finite, acyclic JSON records" }];
  const findings = [...validateContentRegistry(value)];
  if (findings.length) return findings;
  const registry = value as unknown as ContentRegistry;
  registry.candidates.forEach((candidate, i) => {
    if (candidate.state !== "active") return;
    findings.push(...checkContentApproval(candidate, "activation").map(f => ({ ...f, path: f.path.replace(/^candidate/, `registry.candidates[${i}]`) })));
    findings.push(...checkPinnedIntegrity(registry, candidate, `registry.candidates[${i}]`));
  });
  return findings;
}
