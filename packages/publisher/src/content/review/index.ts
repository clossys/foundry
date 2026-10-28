import { isContentJson } from "../json.js";
import type { CopyFinding } from "../composition.js";
import { computeStageReport } from "../stage-engine.js";
import { validateContentCandidate } from "../validate.js";
import { isRevisionId } from "../vocabulary.js";
import { reviewCopy } from "./copy.js";
import { reviewReferences } from "./references.js";
import { reviewRoutes } from "./routes.js";
import type { Need, ReviewContext, ReviewFinding, ReviewInput, ReviewReport } from "./types.js";

export type { Need, ReviewCheck, ReviewCopySchema, ReviewFinding, ReviewInput, ReviewLibrarySnapshot, ReviewReport, ReviewSectionRegistration } from "./types.js";

/** Review is read-only. The caller supplies the freshly computed digest and instant;
 * registration is not approval, and this report never creates content or releases.
 */
export function reviewCandidate(input: ReviewInput): ReviewReport {
  if (!input || typeof input !== "object" || !input.registry || !isContentJson(input.registry)
    || !Array.isArray(input.registry.candidates) || !Array.isArray(input.registry.slots) || !Array.isArray(input.libraries)
    || typeof input.candidateId !== "string" || !input.candidateId.trim()
    || typeof input.digest !== "string" || input.digest.length !== 64 || !/^[a-f0-9]{64}$/.test(input.digest)
    || typeof input.raisedAt !== "string" || !input.raisedAt.trim() || !Number.isFinite(Date.parse(input.raisedAt))) {
    throw new TypeError("Review requires a JSON registry, candidate identity, current sha256 digest, libraries and explicit timestamp");
  }
  const candidates = input.registry.candidates.filter(row => row?.id === input.candidateId);
  if (candidates.length !== 1) throw new TypeError("Review requires exactly one selected candidate");
  const candidate = candidates[0]!;
  if (!isRevisionId(candidate.revision)) throw new TypeError("Review requires a pinned candidate revision");
  const slots = input.registry.slots.filter(row => row?.id === candidate.slotId);
  if (slots.length !== 1 || !Array.isArray(slots[0]!.locales) || !slots[0]!.locales.length) throw new TypeError("Review requires an unambiguous slot with declared locales");
  const slot = slots[0]!;
  const findings: ReviewFinding[] = [], needs: Need[] = [], copyFindings: CopyFinding[] = [];
  const findingKeys = new Set<string>(), needKeys = new Set<string>();
  const context: ReviewContext = {
    input, registry: input.registry, candidate, slot, sections: [],
    add(check, path, rule, message) {
      const key = JSON.stringify([check, path, rule, message]);
      if (!findingKeys.has(key)) { findingKeys.add(key); findings.push({ check, path, rule, message }); }
    },
    copyFinding(finding) { copyFindings.push(finding); },
    need(kind, target, reference, detail) {
      const key = JSON.stringify([candidate.slotId, candidate.id, kind, target, reference]);
      if (!needKeys.has(key)) {
        needKeys.add(key);
        needs.push({ id: `need_${encodeURIComponent(key)}`, kind, target, slotId: candidate.slotId, ref: reference, detail, raisedAt: input.raisedAt });
      }
    },
  };
  const finish = (): ReviewReport => ({
    candidateId: candidate.id, revision: candidate.revision, digest: input.digest, findings, needs,
    ...(copyFindings.length ? { copyFindings } : {}),
    checkedAgainst: { libraryVersion: typeof candidate.composition?.libraryVersion === "string" ? candidate.composition.libraryVersion : null, locales: [...slot.locales] },
  });
  const shape = validateContentCandidate(candidate);
  if (shape.length) {
    shape.forEach(f => context.add("closed-world", f.path, f.rule, f.message));
    if (shape.some(f => f.rule !== "composition-or-redirect")) return finish();
  }
  const definition = computeStageReport(candidate).stages.define;
  if (definition.status === "Failing") definition.findings.forEach(f => context.add("closed-world", f.path, f.rule, f.message));
  if (candidate.history.at(-1)?.digest !== input.digest) {
    context.add("closed-world", "candidate.revision", "current-content-digest", "The current content digest differs from its latest stored revision");
  }
  context.sections = reviewReferences(context);
  reviewCopy(context);
  reviewRoutes(context);
  return finish();
}
