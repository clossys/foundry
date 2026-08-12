import type { RepositoryCommand, RepositoryList, RepositoryProfile } from "./types.js";

type ExpectTrue<Value extends true> = Value;

/** Compile-time proof that the public command collection matches the arrays validation accepts. */
export type RepositoryCommandsAreReadonlyArrays = ExpectTrue<
  RepositoryProfile["commands"] extends readonly RepositoryCommand[] ? true : false
>;

/** Compile-time proof that the reusable list alias is the same read-only array contract. */
export type RepositoryListIsReadonlyArray = ExpectTrue<
  RepositoryList<string> extends readonly string[] ? true : false
>;
