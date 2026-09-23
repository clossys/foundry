import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverRecords, runMigrations } from "./fs.js";
import { createRecordKindRegistry, defaultRecordKindRegistry } from "./registry.js";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "migrate-fs-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relativePath: string, content: unknown): void {
  const full = join(root, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content));
}

describe("discoverRecords", () => {
  it("finds records by basename anywhere under clossys/, sorted, and skips clossys/.state", () => {
    write("clossys/coverage.json", { schemaVersion: 1 });
    write("clossys/advisor/loop.json", { schemaVersion: 1 });
    write("clossys/strategist/loop.json", { schemaVersion: 1 });
    write("clossys/.state/schema-backups/advisor/loop.json.v1.json", { schemaVersion: 1 });
    write("clossys/advisor/brief.json", { schemaVersion: 1 }); // not a known basename

    const discovered = discoverRecords(root);
    expect(discovered).toEqual([
      { kind: "loop-state", path: "clossys/advisor/loop.json" },
      { kind: "coverage-declaration", path: "clossys/coverage.json" },
      { kind: "loop-state", path: "clossys/strategist/loop.json" },
    ]);
  });

  it("returns nothing when clossys/ does not exist", () => {
    expect(discoverRecords(root)).toEqual([]);
  });
});

describe("runMigrations", () => {
  it("is report-only by default: findings are produced but nothing is written", () => {
    write("clossys/coverage.json", { schemaVersion: 1, x: 1 });
    const reports = runMigrations(root, defaultRecordKindRegistry());
    expect(reports).toEqual([{ path: "clossys/coverage.json", kind: "coverage-declaration", outcome: { outcome: "already-current", version: 1 } }]);
  });

  it("reports an unregistered kind as indeterminate rather than silently skipping it", () => {
    write("clossys/widget.json", { schemaVersion: 1 });
    const registry = createRecordKindRegistry();
    const reports = runMigrations(root, registry, { locations: [{ kind: "widget", basename: "widget.json" }] });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.outcome.outcome).toBe("indeterminate");
    if (reports[0]!.outcome.outcome === "indeterminate") {
      expect(reports[0]!.outcome.reason).toContain('no migration table registered for kind "widget"');
    }
  });

  it("reports unparseable JSON as indeterminate without throwing", () => {
    write("clossys/coverage.json", "{ not json");
    const reports = runMigrations(root, defaultRecordKindRegistry());
    expect(reports[0]!.outcome.outcome).toBe("indeterminate");
  });

  it("with --apply, writes a migrated record and a backup of the pre-migration bytes", () => {
    write("clossys/advisor/loop.json", { schemaVersion: 1, role: "advisor", capabilities: {} });
    const registry = createRecordKindRegistry();
    registry.register({
      kind: "loop-state",
      currentVersion: 2,
      steps: [{ fromVersion: 1, toVersion: 2, description: "add a migratedNote field", migrate: (record: any) => ({ ...record, schemaVersion: 2, migratedNote: "hi" }) }],
    });
    const reports = runMigrations(root, registry, { apply: true });
    expect(reports[0]!.outcome.outcome).toBe("migrated");

    const written = JSON.parse(readFileSync(join(root, "clossys/advisor/loop.json"), "utf8"));
    expect(written).toEqual({ schemaVersion: 2, role: "advisor", capabilities: {}, migratedNote: "hi" });

    const backupPath = join(root, "clossys/.state/schema-backups/advisor/loop.json.v1.json");
    expect(existsSync(backupPath)).toBe(true);
    const backup = JSON.parse(readFileSync(backupPath, "utf8"));
    expect(backup).toEqual({ schemaVersion: 1, role: "advisor", capabilities: {} });
  });

  it("without --apply, a migratable record is reported but the file is left untouched", () => {
    const original = { schemaVersion: 1, role: "advisor", capabilities: {} };
    write("clossys/advisor/loop.json", original);
    const registry = createRecordKindRegistry();
    registry.register({
      kind: "loop-state",
      currentVersion: 2,
      steps: [{ fromVersion: 1, toVersion: 2, description: "bump", migrate: (record: any) => ({ ...record, schemaVersion: 2 }) }],
    });
    runMigrations(root, registry, { apply: false });
    const stillOnDisk = JSON.parse(readFileSync(join(root, "clossys/advisor/loop.json"), "utf8"));
    expect(stillOnDisk).toEqual(original);
    expect(existsSync(join(root, "clossys/.state"))).toBe(false);
  });
});
