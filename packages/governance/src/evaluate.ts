import type {
  AppCheckOutput,
  GovernanceEvaluation,
  GovernanceFinding,
  PullRequestGovernanceInput,
  TenantGovernancePolicy,
} from "./types.js";

const SHA_PATTERN = /^[0-9a-f]{40,64}$/i;
const DEFAULT_CHANGED_FILE_LIMIT = 3_000;

function isTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isPath(value: string): boolean {
  return value.length > 0 && !value.startsWith("/") && !value.split("/").includes("..");
}

function compileSensitivePatterns(policy: TenantGovernancePolicy, findings: GovernanceFinding[]): RegExp[] {
  const patterns: RegExp[] = [];
  for (const source of policy.sensitivePathPatterns) {
    try {
      patterns.push(new RegExp(source));
    } catch {
      findings.push({ rule: "policy-pattern-valid", message: "A tenant policy contains an invalid sensitive-path pattern." });
    }
  }
  return patterns;
}

function checkPolicy(policy: TenantGovernancePolicy, findings: GovernanceFinding[]): void {
  if (policy.checkName.trim().length === 0 || policy.checkTitle.trim().length === 0) {
    findings.push({ rule: "policy-check-identity", message: "A tenant policy must provide a check name and title." });
  }
  if (policy.requiredReviewerLogin.trim().length === 0) {
    findings.push({ rule: "policy-reviewer", message: "A tenant policy must provide the required reviewer login." });
  }
  if (policy.ownerLogins.length === 0 || policy.ownerLogins.some((login) => login.trim().length === 0)) {
    findings.push({ rule: "policy-owners", message: "A tenant policy must provide at least one owner login." });
  }
}

function makeCheck(policy: TenantGovernancePolicy, input: PullRequestGovernanceInput, findings: readonly GovernanceFinding[]): AppCheckOutput {
  const conclusion = findings.length === 0 ? "success" : "failure";
  const summary = conclusion === "success"
    ? "Governance evidence is complete for the exact pull-request head."
    : findings.map((finding) => `- ${finding.rule}: ${finding.message}`).join("\n");
  return {
    name: policy.checkName || "governance-advisory",
    headSha: input.headSha,
    status: "completed",
    conclusion,
    output: { title: policy.checkTitle || "Governance advisory", summary },
  };
}

/**
 * Evaluates caller-supplied pull-request facts only. This function performs no
 * network I/O, fetches no tenant configuration, and never emits secret data.
 */
export function evaluatePullRequestGovernance(
  input: PullRequestGovernanceInput,
  policy: TenantGovernancePolicy,
): GovernanceEvaluation {
  const findings: GovernanceFinding[] = [];
  checkPolicy(policy, findings);
  const sensitivePatterns = compileSensitivePatterns(policy, findings);

  if (!SHA_PATTERN.test(input.baseSha) || !SHA_PATTERN.test(input.headSha) || input.baseSha === input.headSha) {
    findings.push({ rule: "exact-head-base", message: "The pull request must provide distinct full base and head commit identifiers." });
  }
  if (!Number.isSafeInteger(input.pullRequestNumber) || input.pullRequestNumber < 1 || input.repository.trim().length === 0) {
    findings.push({ rule: "pull-request-identity", message: "The pull request repository and number must be present." });
  }
  const limit = policy.changedFileLimit ?? DEFAULT_CHANGED_FILE_LIMIT;
  if (!Number.isSafeInteger(input.changedFileCount) || input.changedFileCount < 0 || input.changedFileCount > limit) {
    findings.push({ rule: "changed-file-limit", message: "The changed-file count is invalid or exceeds the policy limit." });
  }
  if (input.changedFiles.length !== input.changedFileCount || input.changedFiles.some((path) => !isPath(path))) {
    findings.push({ rule: "changed-files-complete", message: "Changed paths must be complete, relative repository paths." });
  }

  const sensitiveFiles = input.changedFiles.filter((path) => sensitivePatterns.some((pattern) => pattern.test(path)));
  if (input.review === undefined) {
    findings.push({ rule: "current-head-review", message: "A completed review for the exact pull-request head is required." });
  } else {
    const review = input.review;
    const effectiveState = review.latestStateChangingState ?? review.latestState;
    if (review.reviewedHeadSha !== input.headSha || !SHA_PATTERN.test(review.reviewedHeadSha) || !isTimestamp(review.submittedAt)) {
      findings.push({ rule: "current-head-review", message: "Review evidence must identify the exact head and a valid completion time." });
    }
    if (review.reviewerLogin !== policy.requiredReviewerLogin) {
      findings.push({ rule: "reviewer-identity", message: "Current-head review evidence must be from the configured reviewer." });
    }
    if (effectiveState === "DISMISSED" || effectiveState === "CHANGES_REQUESTED" || !["APPROVED", "COMMENTED"].includes(effectiveState)) {
      findings.push({ rule: "review-state", message: "The effective current-head review state is not accepted." });
    }
    if (!Number.isSafeInteger(review.inlineFindingCount) || review.inlineFindingCount < 0 || !Number.isSafeInteger(review.unresolvedThreadCount) || review.unresolvedThreadCount < 0 || review.inlineFindingCount > 0 || review.unresolvedThreadCount > 0) {
      findings.push({ rule: "review-findings", message: "Current-head review findings or unresolved threads must be zero." });
    }
    if (sensitiveFiles.length > 0) {
      const acknowledgement = input.acknowledgement;
      if (acknowledgement === undefined || acknowledgement.headSha !== input.headSha || !policy.ownerLogins.includes(acknowledgement.login) || !isTimestamp(acknowledgement.createdAt) || Date.parse(acknowledgement.createdAt) < Date.parse(review.submittedAt)) {
        findings.push({ rule: "sensitive-change-acknowledgement", message: "Sensitive changes require a post-review acknowledgement by a configured owner." });
      }
    }
  }

  return { findings, check: makeCheck(policy, input, findings) };
}
