import type {
  RepositoryCommand,
  RepositoryList,
  RepositoryProfile,
  RepositoryProfileV1,
  RepositoryProfileV2,
  RepositoryRequirement,
  RepositoryRequirementObservation,
  RepositoryRequirementStatus,
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

/** Compile-time proof that all four evaluation states remain part of the closed union. */
export type RepositoryRequirementStatesAreComplete = ExpectTrue<
  "satisfied" | "unsatisfied" | "conflicting" | "unknown" extends RepositoryRequirementStatus ? true : false
>;

/** Compile-time proof that observed evidence always carries a concrete value. */
export type ObservedRequirementEvidenceHasValue = ExpectTrue<
  Extract<RepositoryRequirementObservation, { state: "observed" }> extends { value: string } ? true : false
>;
