import { describe, expect, it } from "vitest";
import { reportInventoryDrift } from "./inventory-adoption.js";
import type { WorkspaceHost } from "./types.js";

function fakeHost(files: Record<string, string>): WorkspaceHost {
  return {
    cwd: "/hub",
    env: {},
    isTTY: false,
    now: () => "2026-09-22T00:00:00.000Z",
    exists: (p) => p in files,
    isDirectory: () => false,
    isSymlink: () => false,
    readText: (p) => files[p] ?? null,
    writeText: () => {
      throw new Error("read-only in this test");
    },
    mkdirp: () => {},
    symlink: () => {},
    remove: () => {},
    readDir: () => [],
    run: () => ({ status: 0, stdout: "", stderr: "" }),
    prompt: () => null,
  };
}

const FOUNDRY_INVENTORY = (ids: string[]) => JSON.stringify({ schemaVersion: 1, repositories: ids.map((id) => ({ id })) });

describe("reportInventoryDrift", () => {
  it("reports no-external-source when the hub marker declares none", () => {
    const host = fakeHost({});
    const report = reportInventoryDrift(host, "/hub", undefined, "clossys/.state/inventory.json");
    expect(report.status).toBe("no-external-source");
  });

  it("reports indeterminate, never a guessed mapping, for a declared custom shape", () => {
    const host = fakeHost({});
    const report = reportInventoryDrift(host, "/hub", { path: "/hub/external.json", shape: "custom" }, "clossys/.state/inventory.json");
    expect(report.status).toBe("indeterminate");
    expect(report.note).toMatch(/no mapping/);
  });

  it("reports indeterminate when the declared foundry-shaped source cannot be read", () => {
    const host = fakeHost({});
    const report = reportInventoryDrift(host, "/hub", { path: "/hub/external.json", shape: "foundry" }, "clossys/.state/inventory.json");
    expect(report.status).toBe("indeterminate");
  });

  it("splits into external-only, launcher-only, and agreeing -- all three, even when one is empty", () => {
    const host = fakeHost({
      "/hub/external.json": FOUNDRY_INVENTORY(["app", "site", "admin"]),
      "/hub/clossys/.state/inventory.json": FOUNDRY_INVENTORY(["site", "legacy"]),
    });
    const report = reportInventoryDrift(host, "/hub", { path: "/hub/external.json", shape: "foundry" }, "clossys/.state/inventory.json");
    expect(report.status).toBe("reconciled");
    expect(report.externalOnly).toEqual(["app", "admin"]);
    expect(report.launcherOnly).toEqual(["legacy"]);
    expect(report.agreeing).toEqual(["site"]);
  });

  it("perfect agreement reports empty external-only and launcher-only arrays, not their absence", () => {
    const host = fakeHost({
      "/hub/external.json": FOUNDRY_INVENTORY(["app"]),
      "/hub/clossys/.state/inventory.json": FOUNDRY_INVENTORY(["app"]),
    });
    const report = reportInventoryDrift(host, "/hub", { path: "/hub/external.json", shape: "foundry" }, "clossys/.state/inventory.json");
    expect(report.externalOnly).toEqual([]);
    expect(report.launcherOnly).toEqual([]);
    expect(report.agreeing).toEqual(["app"]);
  });
});
