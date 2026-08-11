import type { RepositoryProfile } from "./types.js";

type ExpectFalse<Value extends false> = Value;

/** Compile-time proof that validated collections do not promise array methods. */
export type RepositoryCommandsDoNotExposeMap = ExpectFalse<
  "map" extends keyof RepositoryProfile["commands"] ? true : false
>;

/** Compile-time proof that validated collections do not promise iteration. */
export type RepositoryPathsDoNotExposeIterator = ExpectFalse<
  typeof Symbol.iterator extends keyof RepositoryProfile["protectedPaths"] ? true : false
>;
