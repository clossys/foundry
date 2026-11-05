import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { acceptUnit } from "./accept-unit.mjs";

const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
const write = (root, files) => {
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  }
};
const commit = (root, files, message) => { write(root, files); git(root, "add", "-A"); git(root, "commit", "-q", "-m", message); return git(root, "rev-parse", "HEAD"); };

/** before: no check; broken: the check exists and fails; fixed: the unit makes it pass. */
function history() {
  const root = mkdtempSync(join(tmpdir(), "accept-unit-test-"));
  git(root, "init", "-q");
  const pkg = scripts => ({ name: "@fixture/producer", private: true, scripts });
  const before = commit(root, { "package.json": { name: "fixture", private: true, workspaces: ["packages/*"] }, "packages/producer/package.json": pkg({}) }, "before");
  const check = `import { existsSync } from "node:fs";\nif (!existsSync(new URL("../fixed.txt", import.meta.url))) { console.log("FAIL not fixed"); process.exit(1); }\nconsole.log("ok");\n`;
  const broken = commit(root, { "packages/producer/package.json": pkg({ "check:fixed": "node scripts/check-fixed.mjs" }), "packages/producer/scripts/check-fixed.mjs": check }, "broken");
  const fixed = commit(root, { "packages/producer/fixed.txt": "yes\n" }, "fixed");
  return { root, before, broken, fixed };
}

test("PASS when the check fails on the base and passes on the head; FAIL the other way round", async () => {
  const { root, broken, fixed } = history();
  const pass = await acceptUnit({ base: broken, head: fixed, check: "check:fixed", cwd: root });
  assert.equal(pass.pass, true, pass.line);
  assert.match(pass.line, /^PASS packages\/producer#check:fixed: base \w{9} exit 1 \(want non-zero\), head \w{9} exit 0 \(want 0\); base measured with the head check \(1 file\(s\) overlaid\); trees and logs in /);
  assert.deepEqual(pass.overlaid, ["packages/producer/scripts/check-fixed.mjs"], "the base is always measured with the head's check");
  const fail = await acceptUnit({ base: fixed, head: broken, check: "packages/producer#check:fixed", cwd: root });
  assert.equal(fail.pass, false);
  assert.match(fail.line, /^FAIL .* base \w{9} exit 0 .* head \w{9} exit 1 /);
  const same = await acceptUnit({ base: fixed, head: fixed, check: "check:fixed", cwd: root });
  assert.equal(same.pass, false, "a check that already passes on the base proves nothing");
});

test("a base without the check is measured with the head's check files and script", async () => {
  const { root, before, fixed } = history();
  const result = await acceptUnit({ base: before, head: fixed, check: "check:fixed", cwd: root });
  assert.equal(result.pass, true, result.line);
  assert.deepEqual(result.overlaid, ["packages/producer/scripts/check-fixed.mjs"]);
  assert.match(result.line, /base measured with the head check \(1 file\(s\) overlaid\)/);
});

test("a head that weakens its own check does not PASS: the base is measured with the head's check (gate F5)", async () => {
  const { root, broken } = history();
  const weak = commit(root, { "packages/producer/scripts/check-fixed.mjs": "console.log(\"ok\");\nprocess.exit(0);\n" }, "weaken the check");
  const result = await acceptUnit({ base: broken, head: weak, check: "check:fixed", cwd: root });
  assert.equal(result.pass, false, result.line);
  assert.equal(result.baseExit, 0, "the base ran the head's weakened check");
  assert.match(result.line, /^FAIL .*base measured with the head check \(1 file\(s\) overlaid\)/);
});

test("a base that cannot load the check is not a failing base (gate F4)", async () => {
  const { root, broken } = history();
  // The check reaches gitignored build output (here an unresolvable package) only on the unfixed path.
  const check = `import { existsSync } from "node:fs";\nif (!existsSync(new URL("../fixed.txt", import.meta.url))) { await import("@fixture/missing-dist"); process.exit(1); }\nconsole.log("ok");\n`;
  const head = commit(root, { "packages/producer/scripts/check-fixed.mjs": check, "packages/producer/fixed.txt": "yes\n" }, "check loads build output");
  const result = await acceptUnit({ base: broken, head, check: "check:fixed", cwd: root });
  assert.equal(result.pass, false, result.line);
  assert.notEqual(result.baseExit, 0);
  assert.match(result.load.base, /ERR_MODULE_NOT_FOUND|Cannot find package/);
  assert.match(result.line, /the base could not load the check/);
});

test("unknown revisions and scripts are setup errors, not verdicts", async () => {
  const { root, broken, fixed } = history();
  await assert.rejects(acceptUnit({ base: "no-such-rev", head: fixed, check: "check:fixed", cwd: root }), /unknown revision/);
  await assert.rejects(acceptUnit({ base: broken, head: fixed, check: "check:none", cwd: root }), /no package.json at head defines check:none/);
});
