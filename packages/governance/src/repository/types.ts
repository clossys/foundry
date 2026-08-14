/** The newest repository profile shape supported by this package version. */
export const REPOSITORY_PROFILE_VERSION = 2 as const;

/** The original profile shape remains accepted for existing consumers. */
export const LEGACY_REPOSITORY_PROFILE_VERSION = 1 as const;

/** Dense, read-only array values accepted by the repository contracts. */
export type RepositoryList<T> = readonly T[];

/** A consumer-owned command that tooling may invoke from the repository. */
export interface RepositoryCommand {
  /** Stable lowercase name, using hyphens or colons as separators. */
  readonly name: string;
  /** The command line exactly as the consumer declares it. */
  readonly run: string;
  /** Optional repository-relative working directory. */
  readonly cwd?: string;
}

/** Where a caller intends one requirement to be resolved. */
export type RepositoryRequirementScope = "repository" | "workspace" | "machine";

/** A capability only needs to be present; its concrete value is caller-owned. */
export interface RepositoryPresenceConstraint {
  readonly kind: "present";
}

/** A capability must equal one of the consumer's explicitly accepted values. */
export interface RepositoryOneOfConstraint {
  readonly kind: "one-of";
  readonly values: RepositoryList<string>;
}

/** Neutral constraints understood by the pure evaluator. */
export type RepositoryRequirementConstraint = RepositoryPresenceConstraint | RepositoryOneOfConstraint;

/** One consumer-authored upward requirement. */
export interface RepositoryRequirement {
  /** Stable, provider-neutral capability identifier. */
  readonly id: string;
  readonly scope: RepositoryRequirementScope;
  readonly constraint: RepositoryRequirementConstraint;
}

/** The legacy schema shipped before upward requirements were modeled. */
export interface RepositoryProfileV1 {
  readonly schemaVersion: typeof LEGACY_REPOSITORY_PROFILE_VERSION;
  readonly defaultBranch: string;
  readonly commands: RepositoryList<RepositoryCommand>;
  readonly protectedPaths: RepositoryList<string>;
}

/**
 * Current consumer-owned repository values. The package defines and validates
 * the shape only; it ships no repository profile or requirement instance.
 */
export interface RepositoryProfileV2 {
  readonly schemaVersion: typeof REPOSITORY_PROFILE_VERSION;
  readonly defaultBranch: string;
  readonly commands: RepositoryList<RepositoryCommand>;
  readonly protectedPaths: RepositoryList<string>;
  readonly requirements: RepositoryList<RepositoryRequirement>;
}

/** Both deliberately supported profile versions. New declarations use v2. */
export type RepositoryProfile = RepositoryProfileV1 | RepositoryProfileV2;

/**
 * One discovered v2 declaration, associated with the opaque source identifier
 * selected by the caller. Discovery and source identity stay outside Foundry.
 */
export interface RepositoryRequirementDeclaration {
  readonly source: string;
  readonly requirements: RepositoryList<RepositoryRequirement>;
}

/** Normalized evidence states supplied by a caller after its own discovery. */
export type RepositoryObservationState = "observed" | "absent" | "unknown";

/**
 * One caller-normalized observation. The type mirrors runtime strictness:
 * repository scope requires `source`, shared scopes forbid it, `observed`
 * requires `value`, and `absent`/`unknown` forbid a value.
 */
export type RepositoryRequirementObservation = {
  readonly id: string;
} & (
  | { readonly scope: "repository"; readonly source: string }
  | { readonly scope: "workspace" | "machine"; readonly source?: never }
) & (
  | { readonly state: "observed"; readonly value: string }
  | { readonly state: "absent" | "unknown"; readonly value?: never }
);

/** Strict input to the pure multi-declaration evaluator. */
export interface RepositoryRequirementsEvaluationInput {
  readonly declarations: RepositoryList<RepositoryRequirementDeclaration>;
  readonly observations: RepositoryList<RepositoryRequirementObservation>;
}

/** The four evidence outcomes for one valid declared requirement group. */
export type RepositoryRequirementStatus = "satisfied" | "unsatisfied" | "conflicting" | "unknown";

/** One deterministic result for one resolved scope + requirement identity. */
export interface RepositoryRequirementEvaluation {
  readonly id: string;
  readonly scope: RepositoryRequirementScope;
  /** Present only for a repository-scoped result. */
  readonly source?: string;
  /** Every declaration source contributing to this result, in input order. */
  readonly declaredBy: RepositoryList<string>;
  readonly status: RepositoryRequirementStatus;
  /** Compatible accepted values; absent when presence alone is enough. */
  readonly acceptedValues?: RepositoryList<string>;
}

/** Overall report status; invalid means the evaluator input failed strict validation. */
export type RepositoryRequirementsEvaluationStatus = RepositoryRequirementStatus | "invalid";

/** Complete deterministic report from `evaluateRepositoryRequirements`. */
export interface RepositoryRequirementsEvaluation {
  readonly ok: boolean;
  readonly status: RepositoryRequirementsEvaluationStatus;
  readonly requirements: RepositoryList<RepositoryRequirementEvaluation>;
  readonly findings: RepositoryList<RepositoryRequirementFinding>;
}

export type RepositoryProfileFindingRule =
  | "profile-shape"
  | "unknown-field"
  | "schema-version"
  | "default-branch"
  | "commands-shape"
  | "command-name"
  | "duplicate-command-name"
  | "command-shape"
  | "command-run"
  | "command-cwd"
  | "protected-paths-shape"
  | "protected-path"
  | "duplicate-protected-path"
  | "requirements-shape"
  | "requirement-shape"
  | "requirement-id"
  | "requirement-scope"
  | "duplicate-requirement"
  | "constraint-shape"
  | "constraint-kind"
  | "constraint-values-shape"
  | "constraint-value"
  | "duplicate-constraint-value";

/** One deterministic structural finding, attributed to its input path. */
export interface RepositoryProfileFinding {
  readonly rule: RepositoryProfileFindingRule;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}

export type RepositoryRequirementFindingRule =
  | "evaluation-shape"
  | "evaluation-unknown-field"
  | "declarations-shape"
  | "declaration-shape"
  | "declaration-unknown-field"
  | "declaration-source"
  | "duplicate-declaration-source"
  | "observations-shape"
  | "observation-shape"
  | "observation-unknown-field"
  | "observation-id"
  | "observation-scope"
  | "observation-source"
  | "observation-state"
  | "observation-value"
  | "duplicate-observation"
  | "requirement-conflicting"
  | "requirement-unsatisfied"
  | "requirement-unknown";

/** A stable reason the evaluation input or one requirement did not pass. */
export interface RepositoryRequirementFinding {
  readonly rule: RepositoryRequirementFindingRule | RepositoryProfileFindingRule;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}
