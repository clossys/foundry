export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";

export interface CurrentHeadReview {
  readonly reviewedHeadSha: string;
  readonly submittedAt: string;
  readonly reviewerLogin: string;
  readonly latestState: ReviewState;
  readonly latestStateChangingState?: Exclude<ReviewState, "COMMENTED">;
  readonly inlineFindingCount: number;
  readonly unresolvedThreadCount: number;
}

export interface PullRequestGovernanceInput {
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly changedFileCount: number;
  readonly changedFiles: readonly string[];
  readonly review?: CurrentHeadReview;
  readonly acknowledgement?: {
    readonly login: string;
    readonly headSha: string;
    readonly createdAt: string;
  };
}

export interface TenantGovernancePolicy {
  readonly checkName: string;
  readonly checkTitle: string;
  readonly requiredReviewerLogin: string;
  readonly ownerLogins: readonly string[];
  readonly sensitivePathPatterns: readonly string[];
  readonly changedFileLimit?: number;
}

export type GovernanceConclusion = "success" | "failure";

export interface GovernanceFinding {
  readonly rule: string;
  readonly message: string;
}

/** A GitHub App adapter can send this object directly to its checks API. */
export interface AppCheckOutput {
  readonly name: string;
  readonly headSha: string;
  readonly status: "completed";
  readonly conclusion: GovernanceConclusion;
  readonly output: {
    readonly title: string;
    readonly summary: string;
  };
}

export interface GovernanceEvaluation {
  readonly findings: readonly GovernanceFinding[];
  readonly check: AppCheckOutput;
}
