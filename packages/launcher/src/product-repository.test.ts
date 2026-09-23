import { describe, expect, it } from "vitest";
import { checkCloudSessionBootstrap } from "./product-repository.js";
import type { WorkspaceHost } from "./types.js";

function fakeHost(files: Record<string, string>): WorkspaceHost {
  return {
    cwd: "/repo",
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

describe("checkCloudSessionBootstrap", () => {
  it("is not ready when nothing exists, and names each missing piece", () => {
    const report = checkCloudSessionBootstrap(fakeHost({}), "/repo");
    expect(report.ready).toBe(false);
    expect(report.checks).toHaveLength(3);
    expect(report.checks.every((check) => !check.satisfied)).toBe(true);
    expect(report.checks.every((check) => check.note !== undefined)).toBe(true);
  });

  it("is ready when all three checks pass", () => {
    const host = fakeHost({
      "/repo/package.json": "{}",
      "/repo/package-lock.json": "{}",
      "/repo/AGENTS.md": "Pointers to clossys/ and the loop.",
      "/repo/clossys/.state/workspace.json": "{}",
    });
    const report = checkCloudSessionBootstrap(host, "/repo");
    expect(report.ready).toBe(true);
    expect(report.checks.every((check) => check.satisfied)).toBe(true);
    expect(report.checks.every((check) => check.note === undefined)).toBe(true);
  });

  it("package-manifest requires BOTH package.json and package-lock.json, not just one", () => {
    const host = fakeHost({ "/repo/package.json": "{}" });
    const report = checkCloudSessionBootstrap(host, "/repo");
    const manifestCheck = report.checks.find((check) => check.id === "package-manifest");
    expect(manifestCheck?.satisfied).toBe(false);
    expect(manifestCheck?.note).toMatch(/package-lock/);
  });

  it("agents-pointer requires AGENTS.md to actually mention clossys/, not just exist", () => {
    const host = fakeHost({ "/repo/AGENTS.md": "Some unrelated instructions." });
    const report = checkCloudSessionBootstrap(host, "/repo");
    const agentsCheck = report.checks.find((check) => check.id === "agents-pointer");
    expect(agentsCheck?.satisfied).toBe(false);
    expect(agentsCheck?.note).toMatch(/does not mention/);
  });

  it("one failing check alone makes the whole report not ready", () => {
    const host = fakeHost({
      "/repo/package.json": "{}",
      "/repo/package-lock.json": "{}",
      "/repo/AGENTS.md": "Pointers to clossys/ and the loop.",
    });
    const report = checkCloudSessionBootstrap(host, "/repo");
    expect(report.ready).toBe(false);
  });
});
