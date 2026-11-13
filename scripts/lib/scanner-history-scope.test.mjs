import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gitleaksHistoryArgs, scannerHistoryScope } from "./scanner-history-scope.mjs";

test("scope includes the head's full ancestry and excludes unrelated branch history", () => {
  const root = mkdtempSync(join(tmpdir(), "scanner-history-scope-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const commit = value => { writeFileSync(join(root, "fixture.txt"), value); git("add", "fixture.txt"); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "Fixture"); return git("rev-parse", "HEAD"); };
  try {
    git("init", "-b", "main");
    const base = commit("base");
    git("switch", "-c", "unrelated");
    const other = commit("unrelated");
    git("switch", "main");
    const head = commit("head");
    const scope = scannerHistoryScope(root, base, "HEAD");
    assert.equal(scope.head, head);
    assert.deepEqual(git("rev-list", scope.logOptions).split("\n"), [head, base]);
    assert.equal(git("rev-list", scope.logOptions).includes(other), false);
    assert.throws(() => scannerHistoryScope(root, other, head), /descend/);
    const args = gitleaksHistoryArgs(root, scope, "template", "report");
    assert.equal(args.includes(`--log-opts=${head}`), true);
    assert.equal(args.some(arg => arg.includes("--all") || arg.includes("--enable-rule") || arg.includes("--baseline-path")), false);
    assert.throws(() => gitleaksHistoryArgs(root, { ...scope, logOptions: "--all" }, "template", "report"), /Invalid/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
