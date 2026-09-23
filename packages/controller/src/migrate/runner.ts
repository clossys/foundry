/**
 * The migration engine's pure core (issue #1224): classify a record's
 * schema version against its kind's table, and migrate it forward.
 * Deterministic, idempotent, and never destructive -- no filesystem
 * access here; `./fs.js` is the I/O wrapper that reads/writes real
 * `clossys/` files and calls into this module.
 */
import type { MigrationOutcome, MigrationStep, MigrationTable } from "./types.js";

function readSchemaVersion(record: unknown): number | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  const value = (record as Record<string, unknown>).schemaVersion;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function stepsByFromVersion<TRecord>(table: MigrationTable<TRecord>): Map<number, MigrationStep<TRecord>> {
  const map = new Map<number, MigrationStep<TRecord>>();
  for (const step of table.steps) map.set(step.fromVersion, step);
  return map;
}

/** Whether a chain of steps, each existing exactly once, actually reaches `table.currentVersion` from `fromVersion`. Guards against a cyclical or gapped step table rather than looping forever. */
function canReachCurrentVersion<TRecord>(table: MigrationTable<TRecord>, fromVersion: number): boolean {
  const byFrom = stepsByFromVersion(table);
  let version = fromVersion;
  const seen = new Set<number>();
  while (version !== table.currentVersion) {
    if (seen.has(version)) return false;
    seen.add(version);
    const step = byFrom.get(version);
    if (step === undefined) return false;
    version = step.toVersion;
  }
  return true;
}

export type RecordVersionClassification = "already-current" | "migratable" | "future" | "no-path";

/**
 * Classifies a record's version against a table WITHOUT migrating it --
 * a read-only answer to "what would `migrateRecord` do here", useful to
 * a caller that wants to report before it writes.
 */
export function classifyRecordVersion<TRecord>(table: MigrationTable<TRecord>, record: TRecord): RecordVersionClassification {
  const version = readSchemaVersion(record);
  if (version === undefined) return "no-path";
  if (version === table.currentVersion) return "already-current";
  if (version > table.currentVersion) return "future";
  return canReachCurrentVersion(table, version) ? "migratable" : "no-path";
}

/**
 * Migrates one record to `table.currentVersion`, walking its chain of
 * steps one hop at a time.
 *
 * - Missing/non-integer `schemaVersion` -> `indeterminate`
 *   ("missing or non-numeric schemaVersion").
 * - `schemaVersion` ahead of `table.currentVersion` -> `indeterminate`
 *   ("future version"), NEVER downgraded.
 * - `schemaVersion === table.currentVersion` -> `already-current`, a
 *   no-op: re-running this on an already-migrated record is idempotent.
 * - `schemaVersion < table.currentVersion` with a complete chain of
 *   steps -> `migrated`, carrying every applied step's description and
 *   the pre-migration record as `backup`.
 * - `schemaVersion < table.currentVersion` with a gap in the chain ->
 *   `indeterminate` ("no migration path"), and the record comes back
 *   byte-identical -- never partially migrated.
 */
export function migrateRecord<TRecord>(table: MigrationTable<TRecord>, record: TRecord): MigrationOutcome<TRecord> {
  const version = readSchemaVersion(record);
  if (version === undefined) {
    return { outcome: "indeterminate", reason: "missing or non-numeric schemaVersion", observedVersion: undefined, record };
  }
  if (version > table.currentVersion) {
    return {
      outcome: "indeterminate",
      reason: `record declares a newer schema version than this package knows (future version: ${version}, current is ${table.currentVersion})`,
      observedVersion: version,
      record,
    };
  }
  if (version === table.currentVersion) {
    return { outcome: "already-current", version };
  }
  if (!canReachCurrentVersion(table, version)) {
    return { outcome: "indeterminate", reason: `no migration path from version ${version} to ${table.currentVersion}`, observedVersion: version, record };
  }

  const byFrom = stepsByFromVersion(table);
  const backup = record;
  let current = record;
  let cursor = version;
  const appliedSteps: string[] = [];
  while (cursor !== table.currentVersion) {
    // canReachCurrentVersion already proved every hop exists; this guard is
    // type-narrowing only, never a real "no path" case reached at runtime.
    const step = byFrom.get(cursor);
    if (step === undefined) {
      return { outcome: "indeterminate", reason: `no migration path from version ${version} to ${table.currentVersion}`, observedVersion: version, record: backup };
    }
    current = step.migrate(current);
    appliedSteps.push(step.description);
    cursor = step.toVersion;
  }
  return { outcome: "migrated", fromVersion: version, toVersion: table.currentVersion, appliedSteps: Object.freeze(appliedSteps), backup, record: current };
}
