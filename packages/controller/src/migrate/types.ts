/**
 * Schema versions and migrations for every `clossys/` record (issue
 * #1224). Every record a package writes under `clossys/` carries a
 * `schemaVersion`; a package ships forward migrations for its own
 * records; a migration never deletes client content, and a record newer
 * than the installed package's own knowledge is never downgraded --
 * only reported `indeterminate`, with a reason. See `./runner.js` for
 * the pure classify/migrate functions this module's types describe, and
 * `./registry.js` for the open, per-kind table registry.
 */

/** One forward hop in a record kind's migration chain. `migrate` must be pure: same input, same output, no I/O. */
export interface MigrationStep<TRecord = unknown> {
  readonly fromVersion: number;
  readonly toVersion: number;
  /** Human-readable, named in a report's `appliedSteps` -- what this hop actually changed. */
  readonly description: string;
  readonly migrate: (record: TRecord) => TRecord;
}

/** One record kind's full migration table: how many hops it takes to reach `currentVersion`, and from where. */
export interface MigrationTable<TRecord = unknown> {
  /** Stable machine id for this record kind, e.g. `"loop-state"` -- see `./registry.js`. */
  readonly kind: string;
  readonly currentVersion: number;
  readonly steps: readonly MigrationStep<TRecord>[];
}

/** The record's own `schemaVersion` already equals `currentVersion`. Idempotent re-run of an already-migrated record lands here, never re-writing it. */
export interface AlreadyCurrentOutcome {
  readonly outcome: "already-current";
  readonly version: number;
}

/** Every hop from the record's declared version to `currentVersion` existed and ran. `backup` is the record exactly as it was BEFORE any step ran, so a caller can always write both the migrated record and its backup. */
export interface MigratedOutcome<TRecord = unknown> {
  readonly outcome: "migrated";
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly appliedSteps: readonly string[];
  readonly backup: TRecord;
  readonly record: TRecord;
}

/**
 * Could not be classified or migrated -- never downgraded, never
 * partially migrated. `record` is the ORIGINAL input, returned
 * byte-identical: this outcome is the "never strand a client
 * repository, never destructive" case, so nothing about the input is
 * ever mutated on the way to reporting it.
 */
export interface IndeterminateOutcome<TRecord = unknown> {
  readonly outcome: "indeterminate";
  readonly reason: string;
  /** The record's own declared `schemaVersion`, when it had a readable one. `undefined` when the field itself was missing or non-numeric. */
  readonly observedVersion: number | undefined;
  readonly record: TRecord;
}

export type MigrationOutcome<TRecord = unknown> = AlreadyCurrentOutcome | MigratedOutcome<TRecord> | IndeterminateOutcome<TRecord>;
