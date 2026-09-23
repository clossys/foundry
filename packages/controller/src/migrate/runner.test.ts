import { describe, expect, it } from "vitest";
import { classifyRecordVersion, migrateRecord } from "./runner.js";
import type { MigrationTable } from "./types.js";

interface Widget {
  readonly schemaVersion: number;
  readonly name: string;
  readonly legacyField?: string;
}

function tableWithChain(): MigrationTable<Widget> {
  return {
    kind: "widget",
    currentVersion: 3,
    steps: [
      { fromVersion: 1, toVersion: 2, description: "rename legacyField to name", migrate: (record) => ({ schemaVersion: 2, name: record.legacyField ?? record.name }) },
      { fromVersion: 2, toVersion: 3, description: "uppercase name", migrate: (record) => ({ schemaVersion: 3, name: record.name.toUpperCase() }) },
    ],
  };
}

describe("classifyRecordVersion", () => {
  it("classifies already-current, migratable, future, and no-path", () => {
    const table = tableWithChain();
    expect(classifyRecordVersion(table, { schemaVersion: 3, name: "x" })).toBe("already-current");
    expect(classifyRecordVersion(table, { schemaVersion: 1, name: "x" })).toBe("migratable");
    expect(classifyRecordVersion(table, { schemaVersion: 9, name: "x" })).toBe("future");
    expect(classifyRecordVersion({ ...table, steps: [] }, { schemaVersion: 1, name: "x" })).toBe("no-path");
  });

  it("classifies a missing/non-numeric schemaVersion as no-path", () => {
    const table = tableWithChain();
    expect(classifyRecordVersion(table, {} as Widget)).toBe("no-path");
    expect(classifyRecordVersion(table, { schemaVersion: "3" } as unknown as Widget)).toBe("no-path");
  });
});

describe("migrateRecord", () => {
  it("walks a full chain to the current version, recording every applied step", () => {
    const table = tableWithChain();
    const outcome = migrateRecord(table, { schemaVersion: 1, legacyField: "widget-a" });
    expect(outcome.outcome).toBe("migrated");
    if (outcome.outcome !== "migrated") throw new Error("expected migrated");
    expect(outcome.fromVersion).toBe(1);
    expect(outcome.toVersion).toBe(3);
    expect(outcome.appliedSteps).toEqual(["rename legacyField to name", "uppercase name"]);
    expect(outcome.record).toEqual({ schemaVersion: 3, name: "WIDGET-A" });
    expect(outcome.backup).toEqual({ schemaVersion: 1, legacyField: "widget-a" });
  });

  it("is idempotent: re-running on an already-current record is a no-op", () => {
    const table = tableWithChain();
    const outcome = migrateRecord(table, { schemaVersion: 3, name: "WIDGET-A" });
    expect(outcome).toEqual({ outcome: "already-current", version: 3 });
  });

  it("reports a gap in the chain as indeterminate, never mutating the record", () => {
    const table: MigrationTable<Widget> = { kind: "widget", currentVersion: 3, steps: [{ fromVersion: 2, toVersion: 3, description: "uppercase name", migrate: (r) => ({ ...r, schemaVersion: 3 }) }] };
    const input = { schemaVersion: 1, name: "x" };
    const outcome = migrateRecord(table, input);
    expect(outcome.outcome).toBe("indeterminate");
    if (outcome.outcome !== "indeterminate") throw new Error("expected indeterminate");
    expect(outcome.reason).toContain("no migration path from version 1");
    expect(outcome.observedVersion).toBe(1);
    expect(outcome.record).toBe(input);
  });

  it("never downgrades a future version -- reports indeterminate and returns the record unchanged", () => {
    const table = tableWithChain();
    const input = { schemaVersion: 99, name: "from-the-future" };
    const outcome = migrateRecord(table, input);
    expect(outcome.outcome).toBe("indeterminate");
    if (outcome.outcome !== "indeterminate") throw new Error("expected indeterminate");
    expect(outcome.reason).toContain("future version");
    expect(outcome.observedVersion).toBe(99);
    expect(outcome.record).toBe(input);
  });

  it("reports missing/non-numeric schemaVersion as indeterminate", () => {
    const table = tableWithChain();
    expect(migrateRecord(table, {} as Widget).outcome).toBe("indeterminate");
    expect(migrateRecord(table, { schemaVersion: "1" } as unknown as Widget).outcome).toBe("indeterminate");
  });

  it("a migrated outcome's backup always equals the pre-migration bytes exactly", () => {
    const table = tableWithChain();
    const input = { schemaVersion: 1, legacyField: "keep-me" };
    const outcome = migrateRecord(table, input);
    if (outcome.outcome !== "migrated") throw new Error("expected migrated");
    expect(outcome.backup).toStrictEqual(input);
  });

  it("guards against a cyclical step table instead of looping forever", () => {
    const table: MigrationTable<Widget> = {
      kind: "widget",
      currentVersion: 5,
      steps: [
        { fromVersion: 1, toVersion: 2, description: "a", migrate: (r) => r },
        { fromVersion: 2, toVersion: 1, description: "b", migrate: (r) => r },
      ],
    };
    const outcome = migrateRecord(table, { schemaVersion: 1, name: "x" });
    expect(outcome.outcome).toBe("indeterminate");
  });
});
