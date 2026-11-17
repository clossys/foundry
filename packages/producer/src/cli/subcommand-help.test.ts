// G8: `--help` after a subcommand prints its usage and exits 0 (formerly "Unknown argument", exit 2), running nothing.
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./main.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("subcommand --help", () => {
  // An empty directory: no workspace, so a command that ran instead of printing help would fail on its root.
  const empty = () => { const dir = realpathSync(mkdtempSync(join(tmpdir(), "help-"))); dirs.push(dir); return dir; };

  for (const argv of [["migrate", "copy-keys", "--help"], ["migrate", "recut", "--help"], ["migrate", "--help"]]) {
    it(`clossys ${argv.join(" ")}`, async () => {
      const dir = empty();
      const result = await runCli(argv, dir);
      expect(result.exitCode, result.message).toBe(0);
      expect(result.message).toContain("Usage: clossys migrate");
      expect(readdirSync(dir)).toEqual([]);
    });
  }

  for (const argv of [["publisher", "check", "--help"], ["publisher", "release", "--help"], ["publisher", "--help"]]) {
    it(`clossys ${argv.join(" ")}`, async () => {
      const dir = empty();
      const result = await runCli(argv, dir);
      expect(result.exitCode, result.message).toBe(0);
      expect(result.message).toContain("Usage: clossys publisher check");
      expect(readdirSync(dir)).toEqual([]);
    });
  }
});
