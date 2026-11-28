import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CLOUD_PROOF_TEXT, parseArgs, recordFindings, skillFindings } from "./check-cloud-proof.mjs";

const SCRIPT = fileURLToPath(new URL("./check-cloud-proof.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./rules/fixtures/R-REVIEW-CLOUD-PROOF/", import.meta.url));
const HEAD = "a".repeat(40), TREE = "b".repeat(40);
const imported = (verdict, gateVerdict, extra = {}) => ({
  schema: "clossys.review/1", head: HEAD, tree: TREE, verdict, line: `MECHANICAL: ${verdict} ${HEAD} ${TREE}`, ran: { commands: 3, missing: [] },
  imported: { ref: "origin/unit-gate", commit: "c".repeat(40), unit: "unit", gateVerdict, head: HEAD, tree: TREE, base: "d".repeat(40), mergeBase: "d".repeat(40) },
  ...extra,
});
const cli = (...argv) => spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: "utf8" });

test("the repository's Reviewer skill states the cloud-proof rule verbatim", () => {
  assert.deepEqual(skillFindings(ROOT), []);
  assert.match(CLOUD_PROOF_TEXT, /never overridden/);
});

test("an imported record holds only at its own head and with a cloud FAIL kept FAIL", () => {
  assert.deepEqual(recordFindings(imported("PASS", "PASS")), []);
  assert.deepEqual(recordFindings(imported("FAIL", "FAIL")), []);
  assert.deepEqual(recordFindings({ schema: "clossys.review/1", head: HEAD, verdict: "PASS", line: `MECHANICAL: PASS ${HEAD} ${TREE}` }), []);
  assert.equal(recordFindings(imported("PASS", "FAIL"))[0].rule, "cloud-fail-overridden");
  assert.equal(recordFindings(imported("FAIL", "FAIL", { line: `MECHANICAL: PASS ${HEAD} ${TREE}` }))[0].rule, "cloud-fail-overridden");
  assert.equal(recordFindings(imported("PASS", "PASS", { head: "e".repeat(40), line: `MECHANICAL: PASS ${"e".repeat(40)} ${TREE}` }))[0].rule, "cloud-head-mismatch");
  assert.equal(recordFindings(imported("PASS", "PASS", { tree: "f".repeat(40) }))[0].rule, "cloud-head-mismatch");
});

test("the fixtures fail as the rule says", () => {
  const skill = cli("--root", `${FIXTURES}skill`);
  assert.equal(skill.status, 1);
  assert.match(skill.stdout, /^missing-rule\tpackages\/reviewer\/skill\/SKILL\.md/m);
  const record = `${FIXTURES}record`;
  for (const [file, rule] of [["import-fail-overridden.json", "cloud-fail-overridden"], ["import-head-mismatch.json", "cloud-head-mismatch"]]) {
    const run = cli("--root", record, "--record", `${record}/${file}`);
    assert.equal(run.status, 1, file);
    assert.match(run.stdout, new RegExp(`^${rule}\\t`, "m"));
  }
  assert.equal(cli("--root", record).status, 0);
});

test("usage errors exit 2", () => {
  assert.throws(() => parseArgs(["--record"]), /needs a value/);
  assert.equal(cli("--bogus").status, 2);
});
