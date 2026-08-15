import { REVIEW_EVIDENCE_VERSION } from "./types.js";
import type { ReviewCheckConclusion, ReviewDecision, ReviewEvidenceBundle } from "./types.js";

/** Minimal GitHub GraphQL-style page marker used to prove a collection is complete. */
export interface GitHubPageInfo { readonly hasNextPage: boolean; readonly hasPreviousPage: boolean; }
/** A caller-provided GitHub GraphQL-style connection. No network access occurs here. */
export interface GitHubConnection<T> { readonly nodes: readonly T[]; readonly pageInfo: GitHubPageInfo; }
/** GitHub-shaped check data accepted by the normalizer. */
export interface GitHubCheckNode { readonly name: string; readonly conclusion: string | null; readonly headSha?: string; readonly head_sha?: string; }
/**
 * GitHub-shaped review data accepted by the normalizer. `provider` is not
 * part of GitHub's own review shape -- GitHub has no concept of it -- so it
 * is read only when the caller has already attached one to the node before
 * calling this function. This normalizer never infers a provider from
 * `author.login` or any other GitHub-shaped field: pattern-matching a login
 * to guess which analyzer produced a review would hardcode vendor-shaped
 * knowledge into a package whose charter forbids that. If a caller's payload
 * omits `provider`, that is the caller's own gap to close, not a value this
 * function may invent.
 */
export interface GitHubReviewNode {
  readonly id: string;
  readonly state: string | null;
  readonly author?: { readonly login?: string | null } | null;
  readonly provider?: string | null;
  readonly submittedAt?: string | null;
  readonly commit?: { readonly oid?: string | null } | null;
  readonly commit_id?: string | null;
}
/** GitHub-shaped review-thread data accepted by the normalizer. */
export interface GitHubReviewThreadNode { readonly id: string; readonly isResolved: boolean; }
/** Caller-provided snapshot of the GitHub data needed for a review decision. */
export interface GitHubReviewEvidencePayload {
  readonly pullRequest: { readonly id: string; readonly headRefOid: string; readonly baseRefOid: string; };
  readonly checks: GitHubConnection<GitHubCheckNode>;
  readonly reviews: GitHubConnection<GitHubReviewNode>;
  readonly reviewThreads: GitHubConnection<GitHubReviewThreadNode>;
}

function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return {};
  return Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => "value" in descriptor)
    ? value as Record<string, unknown>
    : {};
}
function ownData(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
function isDenseDataArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  let entries = 0;
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === "length") continue;
    const index = Number(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= value.length || String(index) !== key || !descriptor || !("value" in descriptor)) return false;
    entries += 1;
  }
  return entries === value.length;
}
function nodes(value: unknown): readonly unknown[] {
  const candidate = ownData(record(value), "nodes");
  return isDenseDataArray(candidate) ? candidate : [];
}
function isComplete(value: unknown): boolean {
  const connection = record(value);
  const pageInfo = record(ownData(connection, "pageInfo"));
  return isDenseDataArray(ownData(connection, "nodes"))
    && ownData(pageInfo, "hasNextPage") === false
    && ownData(pageInfo, "hasPreviousPage") === false;
}

function reviewConnectionIsComplete(value: unknown): boolean {
  if (!isComplete(value)) return false;
  for (const node of nodes(value)) {
    const state = ownData(record(node), "state");
    if (typeof state !== "string" || !["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"].includes(state)) return false;
  }
  return true;
}

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
    case "PENDING": return "pending";
    case "": return "unknown";
    default: return "unknown";
  }
}

/**
 * Normalizes a caller-provided GitHub snapshot into the root evidence model.
 * It performs no network access, token lookup, environment read, or
 * GitHub-side mutation. A connection with another page is deliberately
 * marked incomplete.
 *
 * `reviewerId` is populated from `author.login`, which is provider-neutral
 * and opaque by design (see `ReviewRecord`'s own doc comment) -- and this
 * already covers bot- and app-authored reviews correctly, not just human
 * ones. GitHub's GraphQL `Actor` interface, which every kind of review
 * author implements (`User`, `Bot`, `Mannequin`, `Organization`), requires
 * `login` on all of them; a GitHub App's review author has a `login` the
 * same shape as a human's, so it normalizes into `reviewerId` with no
 * special-casing here and none needed.
 */
export function normalizeGitHubReviewEvidence(payload: GitHubReviewEvidencePayload): ReviewEvidenceBundle {
  const source = record(payload);
  const pullRequest = record(ownData(source, "pullRequest"));
  const headSha = stringValue(ownData(pullRequest, "headRefOid"));
  const baseSha = stringValue(ownData(pullRequest, "baseRefOid"));
  const checksConnection = ownData(source, "checks");
  const reviewsConnection = ownData(source, "reviews");
  const threadsConnection = ownData(source, "reviewThreads");
  return {
    schemaVersion: REVIEW_EVIDENCE_VERSION,
    headSha,
    baseSha,
    paginationComplete: isComplete(checksConnection) && reviewConnectionIsComplete(reviewsConnection) && isComplete(threadsConnection),
    checks: nodes(checksConnection).map((node) => { const check = record(node); return { name: stringValue(ownData(check, "name")), conclusion: normalizeCheckConclusion(ownData(check, "conclusion")), headSha: stringValue(ownData(check, "headSha")) || stringValue(ownData(check, "head_sha")) }; }),
    reviews: nodes(reviewsConnection)
      .filter((node) => ownData(record(node), "state") !== "PENDING")
      // `provider` is read only from what the caller already attached to the
      // node (see GitHubReviewNode's own doc comment) -- never inferred from
      // `author.login` or any other GitHub-shaped field.
      .map((node) => { const review = record(node); const commit = record(ownData(review, "commit")); const author = record(ownData(review, "author")); return { id: stringValue(ownData(review, "id")), reviewerId: stringValue(ownData(author, "login")), provider: stringValue(ownData(review, "provider")), submittedAt: stringValue(ownData(review, "submittedAt")), state: normalizeReviewDecision(ownData(review, "state")), headSha: stringValue(ownData(commit, "oid")) || stringValue(ownData(review, "commit_id")) }; }),
    threads: nodes(threadsConnection).map((node) => { const thread = record(node); return { id: stringValue(ownData(thread, "id")), isResolved: ownData(thread, "isResolved") === true, headSha }; }),
  };
}
