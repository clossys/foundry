import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, recordFindings, RULE_TEXT, skillFindings } from "./check-fast-before-review.mjs";

const SCRIPT = fileURLToPath(new URL("./check-fast-before-review.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./rules/fixtures/R-FAST-BEFORE-REVIEW/", import.meta.url));
const HEAD = "a".repeat(40);
const pass = (head = HEAD) => ({ schema: "clossys.fast-check/1", verdict: "FAST PASS", head, line: `FAST PASS ${head}`, commands: [{ step: "related" }] });

test("the repository's Reviewer skill states the rule verbatim", () => {
  assert.deepEqual(skillFindings(ROOT), []);
  assert.match(RULE_TEXT, /clossys check --fast/);
});

test("a skill without the rule is missing-rule", () => {
  const run = spawnSync(process.execPath, [SCRIPT, "--root", `${FIXTURE}skill`], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /^missing-rule\tpackages\/reviewer\/skill\/SKILL\.md/m);
});

test("only a FAST PASS that ran something, at exactly the head, opens review", () => {
  assert.deepEqual(recordFindings(pass(), HEAD), []);
  assert.equal(recordFindings({ ...pass(), verdict: "FAST FAIL", line: `FAST FAIL ${HEAD}` }, HEAD)[0].rule, "not-fast-pass");
  assert.equal(recordFindings({ ...pass(), verdict: "FAST INCOMPLETE", line: `FAST INCOMPLETE ${HEAD}` }, HEAD)[0].rule, "not-fast-pass");
  assert.equal(recordFindings({ ...pass(), commands: [] }, HEAD)[0].rule, "not-fast-pass");
  assert.equal(recordFindings({ verdict: "FAST PASS" }, HEAD)[0].rule, "not-fast-pass");
  assert.equal(recordFindings(pass("b".repeat(40)), HEAD)[0].rule, "wrong-head");
});

test("the fixture records fail as their rule says", () => {
  const fail = spawnSync(process.execPath, [SCRIPT, "--root", `${FIXTURE}record`, "--record", `${FIXTURE}record/fast-fail.json`, "--head", "1".repeat(40)], { encoding: "utf8" });
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /^not-fast-pass\t/m);
  const stale = spawnSync(process.execPath, [SCRIPT, "--root", `${FIXTURE}record`, "--record", `${FIXTURE}record/fast-pass-earlier.json`, "--head", "1".repeat(40)], { encoding: "utf8" });
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /^wrong-head\t/m);
});

test("usage errors exit 2", () => {
  assert.throws(() => parseArgs(["--record", "x.json"]), /go together/);
  assert.throws(() => parseArgs(["--record", "x.json", "--head", "abc"]), /40-character/);
  const run = spawnSync(process.execPath, [SCRIPT, "--bogus"], { encoding: "utf8" });
  assert.equal(run.status, 2);
});
