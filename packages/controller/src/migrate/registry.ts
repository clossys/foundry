/**
 * An open, mutable-at-call-site registry of record kinds this package
 * knows how to classify and migrate (issue #1224). `createRecordKindRegistry`
 * returns an empty registry any caller can populate with its own tables;
 * `defaultRecordKindRegistry` is the one this package's own CLI
 * (`./cli.js`) uses, seeded with the two record kinds actually found
 * under `clossys/` on `main` today -- `loop-state`
 * (`clossys/<role>/loop.json`, shipped by `../loop/*`) and
 * `coverage-declaration` (`clossys/coverage.json`, shipped by
 * `@clossys/observer`).
 *
 * This is an EXTENSION POINT, not a closed list: a package like
 * Strategist registers its own table (for example a
 * `strategist-strategy-bundle` kind covering `clossys/strategist/*.json`)
 * into its own registry instance when IT adopts this engine. Neither
 * that table nor any other future kind is declared here -- doing so
 * would make this package's own release the only place a new record
 * shape could ever be taught to the migration engine.
 */
import type { MigrationTable } from "./types.js";

export interface RecordKindRegistry {
  register<TRecord>(table: MigrationTable<TRecord>): void;
  get(kind: string): MigrationTable<unknown> | undefined;
  /** Every registered kind, sorted, for a caller building a report or `--help` text. */
  kinds(): readonly string[];
}

function validateTable<TRecord>(table: MigrationTable<TRecord>): void {
  if (typeof table.kind !== "string" || table.kind.trim() === "") {
    throw new Error("createRecordKindRegistry: a migration table's kind must be a nonempty string");
  }
  if (!Number.isInteger(table.currentVersion) || table.currentVersion < 1) {
    throw new Error(`createRecordKindRegistry: "${table.kind}"'s currentVersion must be a positive integer`);
  }
  const seenFrom = new Set<number>();
  for (const step of table.steps) {
    if (seenFrom.has(step.fromVersion)) {
      throw new Error(`createRecordKindRegistry: "${table.kind}" declares two migration steps from version ${step.fromVersion} -- every hop must exist exactly once`);
    }
    seenFrom.add(step.fromVersion);
    if (!(step.toVersion > step.fromVersion)) {
      throw new Error(`createRecordKindRegistry: "${table.kind}"'s step from ${step.fromVersion} must move strictly forward (toVersion ${step.toVersion} is not greater)`);
    }
  }
}

/** Constructs an empty registry. A caller `register`s its own tables into it -- see this module's header for why nothing is preloaded here. */
export function createRecordKindRegistry(): RecordKindRegistry {
  const tables = new Map<string, MigrationTable<unknown>>();
  return {
    register<TRecord>(table: MigrationTable<TRecord>): void {
      validateTable(table);
      tables.set(table.kind, table as MigrationTable<unknown>);
    },
    get(kind: string): MigrationTable<unknown> | undefined {
      return tables.get(kind);
    },
    kinds(): readonly string[] {
      return Object.freeze([...tables.keys()].sort());
    },
  };
}

/** Stable machine id for `clossys/<role>/loop.json` (`../loop/state.js`'s own `LoopState.schemaVersion`, currently fixed at exactly 1). */
export const LOOP_STATE_KIND = "loop-state";
/** Stable machine id for `clossys/coverage.json` (`@clossys/observer`'s `COVERAGE_DECLARATION_SCHEMA_VERSION`, currently 1). */
export const COVERAGE_DECLARATION_KIND = "coverage-declaration";

/**
 * The registry this package's own CLI (`./cli.js`) uses by default:
 * seeded with the two record kinds actually found on `main` today.
 * Neither kind has a migration step yet -- both are at their own first
 * schema version -- so this registry currently only classifies
 * `already-current` / `indeterminate`, never `migrated`, until a real
 * schema change ships a step for one of them.
 */
export function defaultRecordKindRegistry(): RecordKindRegistry {
  const registry = createRecordKindRegistry();
  registry.register({ kind: LOOP_STATE_KIND, currentVersion: 1, steps: [] });
  registry.register({ kind: COVERAGE_DECLARATION_KIND, currentVersion: 1, steps: [] });
  return registry;
}
