import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BUDGET_TEXT, CARRY_TEXT, carryFindings, parseArgs, skillFindings, verdictFindings } from "./check-review-plan.mjs";

const SCRIPT = fileURLToPath(new URL("./check-review-plan.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./rules/fixtures/", import.meta.url));
const A = "a".repeat(40), B = "b".repeat(40);
const cli = (...argv) => spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: "utf8" });
const verdict = (role, head, clear, extra = {}) => JSON.stringify({
  schema: "clossys.review-verdict/1", unit: "U", role, head, verdict: clear ? "CLEAR" : "NOT CLEAR",
  ...(clear ? {} : { reason: "r", severity: "P2" }), blind: role !== "closure-delta", line: clear ? `CLEAR ${head}` : `NOT CLEAR ${head}: r`, ...extra,
});
const carry = (verdictText, ownChanged) => ({ schema: "clossys.review-carry/1", head: B, verdict: verdictText, ownChanged, line: `${verdictText} ${B}: why` });

test("the repository's Reviewer skill states both rules verbatim", () => {
  assert.deepEqual(skillFindings(ROOT), []);
  assert.match(BUDGET_TEXT, /no final after a CLEAR blind/);
  assert.match(CARRY_TEXT, /own paths voids it/);
});

test("a verdict log keeps the budget: attested blinds, no final, one of each blind, at most 2 fix rounds", () => {
  assert.deepEqual(verdictFindings([verdict("blind", A, false), verdict("closure-delta", B, true), verdict("second-blind", B, true)].join("\n")), []);
  assert.equal(verdictFindings(verdict("final", A, true))[0].rule, "final-pass");
  assert.equal(verdictFindings(verdict("blind", A, true, { blind: false }))[0].rule, "unattested-blind");
  assert.equal(verdictFindings([verdict("blind", A, true), verdict("blind", B, true)].join("\n"))[0].rule, "extra-blind");
  const three = [verdict("blind", A, false), verdict("closure-delta", B, false), verdict("closure-delta", A, false)];
  assert.deepEqual(verdictFindings(three.join("\n")), []);
  assert.equal(verdictFindings([...three, verdict("closure-delta", B, true)].join("\n"))[0].rule, "third-fix-round");
  for (const broken of ["{", verdict("blind", A, true, { line: `CLEAR ${B}` }), verdict("blind", A, false, { severity: undefined }), verdict("review", A, true)]) {
    assert.equal(verdictFindings(broken)[0].rule, "malformed-verdict", broken);
  }
});

test("a carry record never says CARRY over an own-path blob change", () => {
  assert.deepEqual(carryFindings(carry("CARRY", [])), []);
  assert.deepEqual(carryFindings(carry("VOID", ["a.txt"])), []);
  assert.equal(carryFindings(carry("CARRY", ["a.txt"]))[0].rule, "carry-on-own-path");
  assert.equal(carryFindings({ ...carry("CARRY", []), line: `VOID ${B}: x` })[0].rule, "carry-on-own-path");
  assert.equal(carryFindings(null)[0].rule, "carry-on-own-path");
});

test("the fixtures fail as their rules say", () => {
  for (const rule of ["R-REVIEW-BUDGET", "R-REVIEW-CARRY"]) {
    const skill = cli("--root", `${FIXTURES}${rule}/skill`);
    assert.equal(skill.status, 1, rule);
    assert.match(skill.stdout, /^missing-rule\tpackages\/reviewer\/skill\/SKILL\.md/m);
  }
  const verdicts = `${FIXTURES}R-REVIEW-BUDGET/verdicts`;
  for (const [file, rule] of [["final-after-clear.jsonl", "final-pass"], ["third-fix-round.jsonl", "third-fix-round"], ["unattested-blind.jsonl", "unattested-blind"]]) {
    const run = cli("--root", verdicts, "--verdicts", `${verdicts}/${file}`);
    assert.equal(run.status, 1, file);
    assert.match(run.stdout, new RegExp(`^${rule}\\t`, "m"));
  }
  assert.equal(cli("--root", verdicts, "--verdicts", `${verdicts}/within-budget.jsonl`).status, 0);
  const carries = `${FIXTURES}R-REVIEW-CARRY/carry`;
  const own = cli("--root", carries, "--carry", `${carries}/carry-own-path.json`);
  assert.equal(own.status, 1);
  assert.match(own.stdout, /^carry-on-own-path\t/m);
  assert.equal(cli("--root", carries, "--carry", `${carries}/void-own-path.json`).status, 0);
});

test("usage errors exit 2", () => {
  assert.throws(() => parseArgs(["--verdicts"]), /needs a value/);
  assert.equal(cli("--bogus").status, 2);
  assert.equal(cli("--carry", `${FIXTURES}no-such-carry.json`).status, 2);
});
