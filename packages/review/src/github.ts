import { REVIEW_EVIDENCE_VERSION } from "./types.js";
import type { ReviewCheckConclusion, ReviewDecision, ReviewEvidenceBundle } from "./types.js";

/** Minimal GitHub GraphQL-style page marker used to prove a collection is complete. */
export interface GitHubPageInfo { readonly hasNextPage: boolean; }
/** A caller-provided GitHub GraphQL-style connection. No network access occurs here. */
export interface GitHubConnection<T> { readonly nodes: readonly T[]; readonly pageInfo: GitHubPageInfo; }
/** GitHub-shaped check data accepted by the normalizer. */
export interface GitHubCheckNode { readonly name: string; readonly conclusion: string | null; readonly headSha?: string; readonly head_sha?: string; }
/** GitHub-shaped review data accepted by the normalizer. */
export interface GitHubReviewNode {
  readonly id: string;
  readonly state: string | null;
  readonly author?: { readonly login?: string | null } | null;
  readonly submittedAt?: string | null;
  readonly commit?: { readonly oid?: string | null } | null;
  readonly commit_id?: string | null;
}
/** GitHub-shaped review-thread data accepted by the normalizer. */
export interface GitHubReviewThreadNode { readonly id: string; readonly isResolved: boolean; }
/** Caller-provided snapshot of the GitHub data needed for a review decision. */
export interface GitHubReviewEvidencePayload {
  readonly pullRequest: { readonly id: string; readonly headRefOid: string; };
  readonly checks: GitHubConnection<GitHubCheckNode>;
  readonly reviews: GitHubConnection<GitHubReviewNode>;
  readonly reviewThreads: GitHubConnection<GitHubReviewThreadNode>;
}

function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function record(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function nodes(value: unknown): readonly unknown[] { const candidate = record(value).nodes; return Array.isArray(candidate) ? candidate : []; }
function isComplete(value: unknown): boolean { return record(record(value).pageInfo).hasNextPage === false; }

function normalizeCheckConclusion(value: unknown): ReviewCheckConclusion {
  switch (stringValue(value).toUpperCase()) {
    case "SUCCESS": return "success";
    case "FAILURE": case "STARTUP_FAILURE": case "STALE": return "failure";
    case "NEUTRAL": return "neutral";
    case "SKIPPED": return "skipped";
    case "CANCELLED": return "cancelled";
    case "TIMED_OUT": return "timed-out";
    case "ACTION_REQUIRED": return "action-required";
    case "PENDING": case "QUEUED": case "IN_PROGRESS": case "": return "pending";
    default: return "unknown";
  }
}
function normalizeReviewDecision(value: unknown): ReviewDecision {
  switch (stringValue(value).toUpperCase()) {
    case "APPROVED": return "approved";
    case "CHANGES_REQUESTED": return "changes-requested";
    case "COMMENTED": return "commented";
    case "DISMISSED": return "dismissed";
    case "PENDING": case "": return "pending";
    default: return "unknown";
  }
}

/**
 * Normalizes a caller-provided GitHub snapshot into the root evidence model.
 * It performs no network access, token lookup, environment read, or provider
 * mutation. A connection with another page is deliberately marked incomplete.
 */
export function normalizeGitHubReviewEvidence(payload: GitHubReviewEvidencePayload): ReviewEvidenceBundle {
  const source = record(payload);
  const pullRequest = record(source.pullRequest);
  const headSha = stringValue(pullRequest.headRefOid);
  const checksConnection = source.checks;
  const reviewsConnection = source.reviews;
  const threadsConnection = source.reviewThreads;
  return {
    schemaVersion: REVIEW_EVIDENCE_VERSION,
    headSha,
    paginationComplete: isComplete(checksConnection) && isComplete(reviewsConnection) && isComplete(threadsConnection),
    checks: nodes(checksConnection).map((node) => { const check = record(node); return { name: stringValue(check.name), conclusion: normalizeCheckConclusion(check.conclusion), headSha: stringValue(check.headSha) || stringValue(check.head_sha) || headSha }; }),
    reviews: nodes(reviewsConnection).map((node) => { const review = record(node); const commit = record(review.commit); const author = record(review.author); return { id: stringValue(review.id), reviewerId: stringValue(author.login), submittedAt: stringValue(review.submittedAt), state: normalizeReviewDecision(review.state), headSha: stringValue(commit.oid) || stringValue(review.commit_id) }; }),
    threads: nodes(threadsConnection).map((node) => { const thread = record(node); return { id: stringValue(thread.id), isResolved: thread.isResolved === true, headSha }; }),
  };
}
