import { candidateRevisionContent, computeContentDigest } from "./digest.js";
import type { CandidateContent, ContentRevision } from "./model.js";
import type { ContentFinding } from "./composition.js";
import type { ContentCandidate } from "./model.js";
import { validateContentCandidate, validateCandidateContent } from "./validate.js";
import { isRevisionId } from "./vocabulary.js";
import type { RevisionId } from "./vocabulary.js";

function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}

/** Copy first, then deeply freeze: later edits to the caller's draft cannot rewrite history. */
export function createContentRevision(content: CandidateContent, revision: RevisionId, createdAt: string): ContentRevision {
  if (!isRevisionId(revision)) throw new TypeError("A snapshot requires a pinned revision");
  if (typeof createdAt !== "string" || !createdAt.trim() || !Number.isFinite(Date.parse(createdAt))) throw new TypeError("A snapshot requires a timestamp");
  const findings = validateCandidateContent(content);
  if (findings.length) throw new TypeError(findings.map(f => `${f.path}: ${f.rule}`).join("; "));
  const copy = structuredClone(candidateRevisionContent(content));
  return immutable({ revision, digest: computeContentDigest(copy), content: copy, createdAt });
}

/** Append rN+1 without accepting replacements, gaps, or changed snapshot digests. */
export function appendContentRevision(history: readonly ContentRevision[], content: CandidateContent, createdAt: string): readonly ContentRevision[] {
  const preserved = history.map((snapshot, i) => {
    if (snapshot.revision !== `r${i + 1}` || snapshot.digest !== computeContentDigest(snapshot.content)) throw new TypeError("History must contain unchanged, sequential snapshots");
    return createContentRevision(snapshot.content, snapshot.revision, snapshot.createdAt);
  });
  // Filter and workflow edits preserve the existing revision rather than minting an identical one.
  if (preserved.at(-1)?.digest === computeContentDigest(content)) return Object.freeze(preserved);
  const next = createContentRevision(content, `r${history.length + 1}`, createdAt);
  return Object.freeze([...preserved, next]);
}

/** Digest integrity is a separate Node check; structural canvas validators stay runtime-neutral. */
export function validateContentRevisionIntegrity(value: unknown): readonly ContentFinding[] {
  const findings = [...validateContentCandidate(value)];
  if (findings.length) return findings;
  const candidate = value as ContentCandidate;
  candidate.history.forEach((snapshot, i) => {
    if (snapshot.digest !== computeContentDigest(snapshot.content)) findings.push({ path: `candidate.history[${i}].digest`, rule: "revision-digest", message: "Snapshot content digest differs" });
  });
  if (candidate.history.at(-1)?.digest !== computeContentDigest(candidate)) findings.push({ path: "candidate.revision", rule: "snapshot-content", message: "Current content differs from its snapshot" });
  return findings;
}
