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
