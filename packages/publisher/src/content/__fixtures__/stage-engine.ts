import type { ContentCandidate } from "../model.js";
import type { CandidateStageEvidence, StageResult } from "../stage-engine.js";
import { createContentRevision } from "../revisions.js";
import { at, reviewFixture } from "./review.js";

export const transitionedAt = "2026-01-02T00:00:00Z";

/** Real revision and approval bytes, with mutable test copies kept outside history. */
export function stageCandidate(): ContentCandidate {
  return structuredClone(reviewFixture().candidates[0]!);
}

export function stageResult(status: StageResult["status"] = "Done"): StageResult {
  return { status, findings: [] };
}

export function stageEvidence(candidate: ContentCandidate): CandidateStageEvidence {
  return {
    candidateId: candidate.id, revision: candidate.revision, digest: candidate.history.at(-1)!.digest,
    words: stageResult(), visuals: stageResult(), assembly: stageResult(),
    review: stageResult(), approval: stageResult(), release: stageResult(),
  };
}

/** Rebuild valid r1 content so tests isolate readiness from stale-snapshot rejection. */
export function snapshotCandidate(candidate: ContentCandidate): ContentCandidate {
  const snapshot = createContentRevision(candidate, "r1", at);
  return {
    ...candidate, revision: "r1", history: [snapshot],
    ...(candidate.approval ? { approval: { ...candidate.approval, revision: "r1", digest: snapshot.digest } } : {}),
  };
}
