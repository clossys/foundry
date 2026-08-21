import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanStrategyDirectory } from "./scan.js";

// Hermetic: every test operates on its own `mkdtemp` directory, removed
// afterward. Nothing here reads any path outside that directory.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "strategy-scan-test-"));
});

afterEach(() => {
  try {
    chmodSync(join(dir, "locked"), 0o755); // restore, so rmSync below can clean up even after the permissions test
  } catch {
    // "locked" may not exist in every test — fine.
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("scanStrategyDirectory", () => {
  it("reads every matching file and returns repo-relative, /-joined paths", () => {
    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFileSync(join(dir, "nested", "notes.ts"), "hello");
    writeFileSync(join(dir, "README.txt"), "not scanned — wrong extension");
    const files = scanStrategyDirectory(dir);
    expect(files).toEqual([{ path: "nested/notes.ts", content: "hello" }]);
  });

  it("skips node_modules, dist, build, coverage, and .git by default", () => {
    for (const skipped of ["node_modules", "dist", "build", "coverage", ".git"]) {
      mkdirSync(join(dir, skipped), { recursive: true });
      writeFileSync(join(dir, skipped, "should-not-be-read.md"), "nope");
    }
    writeFileSync(join(dir, "real.md"), "yes");
    const files = scanStrategyDirectory(dir);
    expect(files).toEqual([{ path: "real.md", content: "yes" }]);
  });

  it("returns an empty array for a directory with no matching files", () => {
    writeFileSync(join(dir, "data.json"), "{}");
    expect(scanStrategyDirectory(dir)).toEqual([]);
  });

  it("respects a custom extensions list", () => {
    writeFileSync(join(dir, "notes.txt"), "hello");
    writeFileSync(join(dir, "notes.md"), "hello");
    const files = scanStrategyDirectory(dir, { extensions: [".txt"] });
    expect(files).toEqual([{ path: "notes.txt", content: "hello" }]);
  });

  // Fails CLOSED: an unreadable directory must throw, never be silently
  // treated as empty — see scan.ts's doc comment. Skipped when running as
  // root (common in a sandboxed/CI shell), because root bypasses directory
  // permission bits entirely, which would make this assertion meaningless
  // rather than wrong.
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  it.skipIf(isRoot)("throws rather than silently skipping an unreadable directory", () => {
    const locked = join(dir, "locked");
    mkdirSync(locked);
    writeFileSync(join(locked, "secret.md"), "should never be silently skipped");
    chmodSync(locked, 0o000);
    expect(() => scanStrategyDirectory(dir)).toThrow(/cannot read directory/);
  });
});
