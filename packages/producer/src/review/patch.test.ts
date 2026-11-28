import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scratch } from "./exec.js";
import { fingerprint, formatMutation, runMutation } from "./patch.js";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const env = { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();

const FILES: Record<string, string> = {
  "package.json": `${JSON.stringify({ name: "fixture-checkout", version: "1.0.0", private: true })}\n`,
  "src/math.mjs": "export function isAdult(age) {\n  return age >= 18;\n}\n",
  "src/math.test.mjs": "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { isAdult } from \"./math.mjs\";\ntest(\"adult at eighteen\", () => { assert.equal(isAdult(18), true); });\n",
  "src/other.mjs": "export const other = 1;\n",
};
const PATCH = "--- a/src/math.mjs\n+++ b/src/math.mjs\n@@ -1,3 +1,3 @@\n export function isAdult(age) {\n-  return age >= 18;\n+  return age > 18;\n }\n";

/** A committed checkout plus an untracked note (the fingerprint covers untracked files too), and the patch file. */
function checkout(): { repo: string; patch: string } {
  const repo = scratch("review-mutation-");
  roots.push(repo);
  sh(repo, "init", "--quiet", "--initial-branch=main");
  for (const [path, text] of Object.entries(FILES)) { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), text); }
  sh(repo, "add", "-A");
  sh(repo, "commit", "--quiet", "-m", "base");
  writeFileSync(join(repo, "notes.txt"), "untracked\n");
  const dir = scratch("review-mutation-patch-");
  roots.push(dir);
  writeFileSync(join(dir, "m.patch"), PATCH);
  return { repo, patch: join(dir, "m.patch") };
}

describe("clossys review --mutation", () => {
  it("patch mutation restores the tree byte for byte", () => {
    const { repo, patch } = checkout();
    const before = fingerprint(repo);
    const record = runMutation({ repo, patch, expectFail: "adult at eighteen" });
    expect(record.commands.map(command => [command.exit, command.matched])).toEqual([[1, true]]);
    expect(record.killed).toBe(true);
    expect(record.restored).toBe(true);
    expect(record.changed).toEqual([]);
    expect(record.findings).toEqual([]);
    expect(record.verdict).toBe("PASS");
    expect(formatMutation(record).split("\n").at(-1)).toBe(record.line);
    expect(fingerprint(repo)).toEqual(before);
    expect(readFileSync(join(repo, "src/math.mjs"), "utf8")).toBe(FILES["src/math.mjs"]);

    // A run that leaves the tree changed (here it edits another tracked file and an untracked one) is never a PASS,
    // even though the patch itself reversed cleanly and the mutant was killed.
    const dirty = runMutation({ repo, patch, expectFail: "fails", run: ["node -e \"require('fs').appendFileSync('src/other.mjs', '// x\\n'); require('fs').writeFileSync('notes.txt', 'changed\\n'); process.exit(1)\" || (echo fails; exit 1)"] });
    expect(dirty.killed).toBe(true);
    expect(dirty.restored).toBe(false);
    expect(dirty.changed).toEqual(["notes.txt", "src/other.mjs"]);
    expect(dirty.findings.map(finding => finding.id)).toEqual(["mutation.restore"]);
    expect(dirty.verdict).toBe("FAIL");
  }, 60_000);

  it("fails a mutant that survives or fails for another reason, a patch that does not apply, and a missing tool", () => {
    const { repo, patch } = checkout();
    const other = runMutation({ repo, patch, expectFail: "no such test name" });
    expect(other.findings.map(finding => finding.id)).toEqual(["mutation.not-killed"]);
    expect(other.restored).toBe(true);
    const survived = runMutation({ repo, patch, expectFail: ".", run: ["node -e 0"] });
    expect(survived.findings.map(finding => finding.id)).toEqual(["mutation.not-killed"]);
    writeFileSync(patch, PATCH.replace("age >= 18", "age >= 21"));
    const stale = runMutation({ repo, patch, expectFail: "." });
    // Nothing ran on a patch that did not apply, so it is also review.no-commands.
    expect(stale.findings.map(finding => finding.id)).toEqual(["mutation.apply", "review.no-commands"]);
    expect(stale.verdict).toBe("FAIL");
    writeFileSync(patch, PATCH);
    const missing = runMutation({ repo, patch, expectFail: ".", run: ["clossys-no-such-tool --run"] });
    expect(missing.ran.missing).toEqual(["clossys-no-such-tool --run"]);
    expect(missing.findings.map(finding => finding.id)).toContain("run.missing");
    expect(missing.verdict).toBe("FAIL");
    expect(readFileSync(join(repo, "src/math.mjs"), "utf8")).toBe(FILES["src/math.mjs"]);
  }, 60_000);
});
