/** The newest repository profile shape supported by this package version. */
export const REPOSITORY_PROFILE_VERSION = 3 as const;

/** The requirements-only profile remains accepted for existing consumers. */
export const PREVIOUS_REPOSITORY_PROFILE_VERSION = 2 as const;

/** The original profile shape remains accepted for existing consumers. */
export const LEGACY_REPOSITORY_PROFILE_VERSION = 1 as const;

/**
 * The one location a consumer's declaration lives (issue #315). The
 * validator locates a declaration here without being told where it is; a
 * declaration found anywhere else is reported as a distinct finding rather
 * than treated as absent, which would silently read as "no declaration."
 */
export const CANONICAL_REPOSITORY_PROFILE_PATH = "governance/repository-profile.json" as const;

/**
 * The closed, two-segment `<category>.<subject>` requirement-id grammar
 * (issue #316): the id names the slot a constraint fills, never the value
 * the constraint currently holds. `runtime` is what executes the code,
 * `tool` is what the work is done with, and `dependency` is what the
 * repository consumes.
 */
export const REQUIREMENT_ID_CATEGORIES = ["runtime", "tool", "dependency"] as const;

/** One category admitted by the requirement-id grammar. */
export type RepositoryRequirementIdCategory = (typeof REQUIREMENT_ID_CATEGORIES)[number];

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

/** Why a caller has admitted one direct child into its repository root vocabulary. */
export type RepositoryRootEntryClassification =
  | "canonical"
  | "extension"
  | "exception"
  | "compatibility-alias"
  | "legacy-artifact";

/** The caller's explicit presence decision for one declared direct child. */
export type RepositoryRootEntryDisposition = "required" | "allowed" | "prohibited";

/** One caller-owned direct-child declaration for an exact repository root. */
export interface RepositoryRootEntry {
  /** A single direct-child name, never a relative or absolute path. */
  readonly name: string;
  readonly classification: RepositoryRootEntryClassification;
  readonly disposition: RepositoryRootEntryDisposition;
}

/** The legacy schema shipped before upward requirements were modeled. */
export interface RepositoryProfileV1 {
  readonly schemaVersion: typeof LEGACY_REPOSITORY_PROFILE_VERSION;
  readonly defaultBranch: string;
  readonly commands: RepositoryList<RepositoryCommand>;
  readonly protectedPaths: RepositoryList<string>;
}

/** Requirements-only schema retained for existing consumers. */
export interface RepositoryProfileV2 {
  readonly schemaVersion: typeof PREVIOUS_REPOSITORY_PROFILE_VERSION;
  readonly defaultBranch: string;
  readonly commands: RepositoryList<RepositoryCommand>;
  readonly protectedPaths: RepositoryList<string>;
  readonly requirements: RepositoryList<RepositoryRequirement>;
}

/** Current profile: requirements plus an exact, caller-owned root vocabulary. */
export interface RepositoryProfileV3 {
  readonly schemaVersion: typeof REPOSITORY_PROFILE_VERSION;
  readonly defaultBranch: string;
  readonly commands: RepositoryList<RepositoryCommand>;
  readonly protectedPaths: RepositoryList<string>;
  readonly requirements: RepositoryList<RepositoryRequirement>;
  readonly rootEntries: RepositoryList<RepositoryRootEntry>;
}

/** Every deliberately supported closed profile version. New declarations use v3. */
export type RepositoryProfile = RepositoryProfileV1 | RepositoryProfileV2 | RepositoryProfileV3;

/**
 * One discovered requirements declaration, associated with the opaque source
 * identifier selected by the caller. Discovery and source identity stay
 * outside Foundry.
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

/** Already-discovered direct children paired with the caller's exact vocabulary. */
export interface RepositoryRootEvaluationInput {
  readonly rootEntries: RepositoryList<RepositoryRootEntry>;
  readonly observedEntries: RepositoryList<string>;
}

/** One declared or unknown direct child's structural result. */
export type RepositoryRootEntryEvaluation =
  | {
      readonly name: string;
      readonly classification: RepositoryRootEntryClassification;
      readonly disposition: RepositoryRootEntryDisposition;
      readonly observed: boolean;
      readonly status: "satisfied" | "missing" | "prohibited";
    }
  | {
      readonly name: string;
      readonly observed: true;
      readonly status: "unknown";
    };

/** Overall exact-root proof state. */
export type RepositoryRootEvaluationStatus = "satisfied" | "nonconforming" | "invalid";

/** Complete deterministic report from `evaluateRepositoryRoot`. */
export interface RepositoryRootEvaluation {
  readonly ok: boolean;
  readonly status: RepositoryRootEvaluationStatus;
  readonly entries: RepositoryList<RepositoryRootEntryEvaluation>;
  readonly findings: RepositoryList<RepositoryRootFinding>;
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
  | "requirement-id-value-embedded"
  | "requirement-scope"
  | "duplicate-requirement"
  | "constraint-shape"
  | "constraint-kind"
  | "constraint-values-shape"
  | "constraint-value"
  | "duplicate-constraint-value"
  | "root-entries-shape"
  | "root-entry-shape"
  | "root-entry-name"
  | "duplicate-root-entry"
  | "root-entry-classification"
  | "root-entry-disposition";

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

export type RepositoryRootFindingRule =
  | "root-evaluation-shape"
  | "root-evaluation-unknown-field"
  | "observed-entries-shape"
  | "observed-entry-name"
  | "duplicate-observed-entry"
  | "root-entry-missing"
  | "root-entry-prohibited"
  | "root-entry-unknown";

/** A stable structural or evaluation reason an exact-root proof did not pass. */
export interface RepositoryRootFinding {
  readonly rule: RepositoryRootFindingRule | RepositoryProfileFindingRule;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}

/**
 * Reasons `repository-check` could not locate a declaration at the
 * canonical path (issue #315). `declaration-non-canonical-location` is
 * distinct from `declaration-not-found` on purpose: a declaration that
 * exists somewhere else must never be reported the same way as no
 * declaration at all, which would read as "this repository declares
 * nothing" and pass a repository that actually has one.
 */
export type RepositoryDeclarationLocationFindingRule =
  | "declaration-not-found"
  | "declaration-non-canonical-location";

/** A stable reason `repository-check` could not locate or validate a declaration. */
export interface RepositoryDeclarationLocationFinding {
  readonly rule: RepositoryDeclarationLocationFindingRule | RepositoryProfileFindingRule;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}
