import assert from "node:assert/strict";
import { test } from "node:test";

import { checkRepeatability, reorderings } from "./repeatability.mjs";

test("reorderings: length < 2 returns the input unchanged, once", () => {
  assert.deepEqual(reorderings([]), [[]]);
  assert.deepEqual(reorderings([{ id: "a", primary: true }]), [[{ id: "a", primary: true }]]);
});

test("reorderings: length >= 2 returns original, reversed, rotated, and id-sorted", () => {
  const input = [{ id: "b" }, { id: "a" }, { id: "c" }];
  const result = reorderings(input);
  assert.equal(result.length, 4);
  assert.deepEqual(result[0].map((x) => x.id), ["b", "a", "c"]);
  assert.deepEqual(result[1].map((x) => x.id), ["c", "a", "b"]);
  assert.deepEqual(result[2].map((x) => x.id), ["a", "c", "b"]);
  assert.deepEqual(result[3].map((x) => x.id), ["a", "b", "c"]);
});

test("checkRepeatability: a deterministic, order-independent compose function passes", () => {
  const scenario = { id: "fixture-a" };
  const confirmedProblems = [{ id: "b" }, { id: "a" }];
  const compose = (list) => ({ state: "composed", roles: [...list].sort((x, y) => x.id.localeCompare(y.id)).map((x) => x.id) });
  const { passed, findings } = checkRepeatability({ scenario, confirmedProblems, compose });
  assert.equal(passed, true);
  assert.deepEqual(findings, []);
});

test("checkRepeatability: a compose function that varies run-to-run fails with composition-not-repeatable", () => {
  const scenario = { id: "fixture-b" };
  const confirmedProblems = [{ id: "a" }, { id: "b" }];
  let call = 0;
  const compose = () => {
    call += 1;
    return { state: "composed", roles: call % 2 === 0 ? ["a"] : ["a", "b"] };
  };
  const { passed, findings } = checkRepeatability({ scenario, confirmedProblems, compose, runs: 3 });
  assert.equal(passed, false);
  assert.ok(findings.some((f) => f.rule === "composition-not-repeatable"));
});

test("checkRepeatability: a compose function sensitive to input order fails with composition-order-dependent", () => {
  const scenario = { id: "fixture-c" };
  const confirmedProblems = [{ id: "a" }, { id: "b" }];
  const compose = (list) => ({ state: "composed", roles: list.map((x) => x.id) }); // order-preserving: NOT invariant to reordering
  const { passed, findings } = checkRepeatability({ scenario, confirmedProblems, compose, runs: 1 });
  assert.equal(passed, false);
  assert.ok(findings.some((f) => f.rule === "composition-order-dependent"));
});
