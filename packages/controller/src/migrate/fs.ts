/**
 * The I/O half of the migration engine (issue #1224): walks a repository's
 * `clossys/` tree for files matching a registered record kind's known
 * basename, reads and classifies/migrates each one against `./runner.js`,
 * and -- only when told to `apply` -- writes the migrated record back to
 * its own path plus a backup of the record exactly as it was BEFORE
 * migration, at `clossys/.state/schema-backups/<relative-path>.v<oldVersion>.json`.
 * Default is report-only (dry run): nothing on disk changes. Mirrors
 * `../loop/bin.js`'s split of pure logic vs. this thin filesystem layer.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { migrateRecord } from "./runner.js";
import type { MigrationOutcome } from "./types.js";
import type { RecordKindRegistry } from "./registry.js";

/** Maps a record kind to the filename its records are found under, anywhere in `clossys/`. */
export interface RecordLocation {
  readonly kind: string;
  readonly basename: string;
}

/** The two real record locations shipped on `main` today -- see `./registry.js`'s header for why this is an extension point, not a closed list. A caller with its own kinds supplies its own locations. */
export const DEFAULT_RECORD_LOCATIONS: readonly RecordLocation[] = Object.freeze([
  { kind: "loop-state", basename: "loop.json" },
  { kind: "coverage-declaration", basename: "coverage.json" },
]);

export interface DiscoveredRecord {
  readonly kind: string;
  /** Repository-relative path, e.g. `clossys/advisor/loop.json`. */
  readonly path: string;
}

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // clossys/.state/ holds ONLY generated files (this engine's own
      // backups included) -- never a source record to classify or migrate.
      if (entry.name === ".state") continue;
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

/** Every file under `<repoRoot>/clossys/` whose basename matches a known record location. */
export function discoverRecords(repoRoot: string, locations: readonly RecordLocation[] = DEFAULT_RECORD_LOCATIONS): readonly DiscoveredRecord[] {
  const clossysDir = join(repoRoot, "clossys");
  const files: string[] = [];
  walk(clossysDir, files);
  const kindByBasename = new Map(locations.map((location) => [location.basename, location.kind]));
  const discovered: DiscoveredRecord[] = [];
  for (const file of files.sort()) {
    const kind = kindByBasename.get(basename(file));
    if (kind !== undefined) discovered.push({ kind, path: relative(repoRoot, file) });
  }
  return Object.freeze(discovered);
}

export interface RecordMigrationReport {
  readonly path: string;
  readonly kind: string;
  readonly outcome: MigrationOutcome;
}

export interface RunMigrationsOptions {
  /** Actually write migrated records and their backups. Default (omitted/false) is report-only. */
  readonly apply?: boolean;
  readonly locations?: readonly RecordLocation[];
}

function backupPath(repoRoot: string, relativePath: string, fromVersion: number): string {
  const underClossys = relativePath.startsWith("clossys/") ? relativePath.slice("clossys/".length) : relativePath;
  return join(repoRoot, "clossys", ".state", "schema-backups", `${underClossys}.v${fromVersion}.json`);
}

/**
 * Discovers every `clossys/` record the registry knows a location for,
 * classifies/migrates each one, and -- only with `options.apply` -- writes
 * the results. A discovered record whose kind has no registered table is
 * reported `indeterminate` ("no migration table registered"), never
 * silently skipped: a caller that widened `DEFAULT_RECORD_LOCATIONS`
 * without also registering the matching table gets a visible finding, not
 * a quiet gap in coverage.
 */
export function runMigrations(repoRoot: string, registry: RecordKindRegistry, options: RunMigrationsOptions = {}): readonly RecordMigrationReport[] {
  const discovered = discoverRecords(repoRoot, options.locations);
  const reports: RecordMigrationReport[] = [];
  for (const item of discovered) {
    const table = registry.get(item.kind);
    if (table === undefined) {
      reports.push({
        path: item.path,
        kind: item.kind,
        outcome: { outcome: "indeterminate", reason: `no migration table registered for kind "${item.kind}"`, observedVersion: undefined, record: undefined },
      });
      continue;
    }
    const fullPath = join(repoRoot, item.path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(fullPath, "utf8"));
    } catch (error) {
      reports.push({
        path: item.path,
        kind: item.kind,
        outcome: { outcome: "indeterminate", reason: `could not read or parse: ${error instanceof Error ? error.message : String(error)}`, observedVersion: undefined, record: undefined },
      });
      continue;
    }
    const outcome = migrateRecord(table, parsed);
    reports.push({ path: item.path, kind: item.kind, outcome });
    if (options.apply === true && outcome.outcome === "migrated") {
      const backup = backupPath(repoRoot, item.path, outcome.fromVersion);
      mkdirSync(dirname(backup), { recursive: true });
      writeFileSync(backup, `${JSON.stringify(outcome.backup, null, 2)}\n`);
      writeFileSync(fullPath, `${JSON.stringify(outcome.record, null, 2)}\n`);
    }
  }
  return Object.freeze(reports);
}
