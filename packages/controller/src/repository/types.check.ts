import type {
  RepositoryCommand,
  RepositoryList,
  RepositoryProfile,
  RepositoryProfileV1,
  RepositoryProfileV2,
  RepositoryProfileV3,
  RepositoryRequirement,
  RepositoryRequirementObservation,
  RepositoryRequirementStatus,
  RepositoryRootEntry,
  RepositoryProfileFindingRule,
  RepositoryRootEntryEvaluation,
} from "./types.js";

type ExpectTrue<Value extends true> = Value;

/** Compile-time proof that the public command collection matches the arrays validation accepts. */
export type RepositoryCommandsAreReadonlyArrays = ExpectTrue<
  RepositoryProfile["commands"] extends readonly RepositoryCommand[] ? true : false
>;

/** Compile-time proof that the reusable list alias is the same read-only array contract. */
export type RepositoryListIsReadonlyArray = ExpectTrue<
  RepositoryList<string> extends readonly string[] ? true : false
>;

/** Compile-time proof that v1 stays assignable to the deliberately supported union. */
export type RepositoryProfileV1RemainsSupported = ExpectTrue<
  RepositoryProfileV1 extends RepositoryProfile ? true : false
>;

/** Compile-time proof that v2 requirements use the public read-only list contract. */
export type RepositoryRequirementsAreReadonlyArrays = ExpectTrue<
  RepositoryProfileV2["requirements"] extends readonly RepositoryRequirement[] ? true : false
>;

/** Compile-time proof that v3 root vocabulary uses the public read-only list contract. */
export type RepositoryRootEntriesAreReadonlyArrays = ExpectTrue<
  RepositoryProfileV3["rootEntries"] extends readonly RepositoryRootEntry[] ? true : false
>;

/** Compile-time proof that aliases and legacy artifacts cannot omit a disposition. */
export type ClassifiedArtifactsRequireDisposition = ExpectTrue<
  RepositoryRootEntry extends { readonly disposition: "required" | "allowed" | "prohibited" } ? true : false
>;

/** Compile-time proof that unknown observed entries remain an explicit evaluation state. */
export type UnknownRootEntriesRemainExplicit = ExpectTrue<
  Extract<RepositoryRootEntryEvaluation, { status: "unknown" }> extends { observed: true } ? true : false
>;

/** Compile-time proof that all four evaluation states remain part of the closed union. */
export type RepositoryRequirementStatesAreComplete = ExpectTrue<
  "satisfied" | "unsatisfied" | "conflicting" | "unknown" extends RepositoryRequirementStatus ? true : false
>;

/** Compile-time proof that observed evidence always carries a concrete value. */
export type ObservedRequirementEvidenceHasValue = ExpectTrue<
  Extract<RepositoryRequirementObservation, { state: "observed" }> extends { value: string } ? true : false
>;

/** Compile-time proof that the release branch is optional, so existing v3 declarations stay valid (issue #929). */
export type ReleaseBranchIsOptional = ExpectTrue<
  { schemaVersion: 3; defaultBranch: string; commands: []; protectedPaths: []; requirements: []; rootEntries: [] } extends RepositoryProfileV3
    ? true
    : false
>;

/** Compile-time proof that the release branch, when declared, is a plain branch name. */
export type ReleaseBranchIsAStringWhenPresent = ExpectTrue<
  RepositoryProfileV3["releaseBranch"] extends string | undefined ? true : false
>;

/** Compile-time proof that both release-branch verdicts are members of the closed finding-rule union. */
export type ReleaseBranchRulesAreDeclared = ExpectTrue<
  "release-branch" | "release-branch-collision" extends RepositoryProfileFindingRule ? true : false
>;

/** Compile-time proof that the legacy shapes stay closed: neither one gained the field. */
export type LegacyProfilesDoNotDeclareAReleaseBranch = ExpectTrue<
  "releaseBranch" extends keyof RepositoryProfileV1 | keyof RepositoryProfileV2 ? false : true
>;
