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
    readBytes: (p) => (files[p] === undefined ? null : new TextEncoder().encode(files[p])),
    writeBytes: () => {
      throw new Error("read-only in this test");
    },
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

  it("splits into external-only, launcher-only, and agreeing -- named by position, count plus positions, never the ids", () => {
    // external: app(0), site(1), admin(2). stored (launcher): site(0), legacy(1).
    const host = fakeHost({
      "/hub/external.json": FOUNDRY_INVENTORY(["app", "site", "admin"]),
      "/hub/clossys/.state/inventory.json": FOUNDRY_INVENTORY(["site", "legacy"]),
    });
    const report = reportInventoryDrift(host, "/hub", { path: "/hub/external.json", shape: "foundry" }, "clossys/.state/inventory.json");
    expect(report.status).toBe("reconciled");
    expect(report.externalOnly).toEqual({ count: 2, positions: ["externalInventory[0]", "externalInventory[2]"] });
    expect(report.launcherOnly).toEqual({ count: 1, positions: ["repositories[1]"] });
    expect(report.agreeing).toEqual({ count: 1, positions: ["externalInventory[1]"] });
    expect(JSON.stringify(report)).not.toMatch(/app|site|admin|legacy/);
  });

  it("perfect agreement reports zero-count external-only and launcher-only, not their absence", () => {
    const host = fakeHost({
      "/hub/external.json": FOUNDRY_INVENTORY(["app"]),
      "/hub/clossys/.state/inventory.json": FOUNDRY_INVENTORY(["app"]),
    });
    const report = reportInventoryDrift(host, "/hub", { path: "/hub/external.json", shape: "foundry" }, "clossys/.state/inventory.json");
    expect(report.externalOnly).toEqual({ count: 0, positions: [] });
    expect(report.launcherOnly).toEqual({ count: 0, positions: [] });
    expect(report.agreeing).toEqual({ count: 1, positions: ["externalInventory[0]"] });
  });
});
