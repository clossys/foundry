/**
 * Shared primitive types, declared locally: a content package never imports `@clossys/producer`,
 * at runtime or as a type (system.md 14.2). `packages/producer/src/records/types.ts` holds the
 * canonical full set; these are structurally identical aliases.
 */

/** Hex sha256 of a record's exact bytes. */
export type Sha256 = string;
/** A candidate file name inside a slot's `candidates/` folder, e.g. `primary-v2.json`. */
export type CandidateName = string;
