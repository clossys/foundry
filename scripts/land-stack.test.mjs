import test from "node:test";
import assert from "node:assert/strict";

import {
  permittedMergeMethod,
  shouldReady,
  isCheckBlocking,
  canMerge,
  restackCommitMessage,
} from "./land-stack.mjs";

test("permittedMergeMethod is merge only", () => {
  assert.equal(permittedMergeMethod(), "merge");
});

test("shouldReady is true only for the tip PR", () => {
  assert.equal(shouldReady(5, 5), true);
  assert.equal(shouldReady(4, 5), false);
  assert.equal(shouldReady(5, null), false);
});

test("isCheckBlocking treats incomplete or failed conclusions as blocking", () => {
  assert.equal(isCheckBlocking({ status: "IN_PROGRESS", conclusion: null }), true);
  assert.equal(isCheckBlocking({ status: "COMPLETED", conclusion: "FAILURE" }), true);
  assert.equal(isCheckBlocking({ status: "COMPLETED", conclusion: "SUCCESS" }), false);
  assert.equal(isCheckBlocking({ status: "COMPLETED", conclusion: "SKIPPED" }), false);
  assert.equal(isCheckBlocking({ status: "COMPLETED", conclusion: "NEUTRAL" }), false);
});

test("canMerge fails closed on draft, unknown mergeability, behind, and checks", () => {
  const green = {
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    isDraft: false,
    checks: [{ name: "safety", status: "COMPLETED", conclusion: "SUCCESS" }],
  };
  assert.deepEqual(canMerge(green), { ok: true, reason: "ready to merge with --merge" });

  assert.equal(canMerge({ ...green, isDraft: true }).ok, false);
  assert.equal(canMerge({ ...green, mergeable: "UNKNOWN" }).ok, false);
  assert.equal(canMerge({ ...green, mergeable: "CONFLICTING" }).ok, false);
  assert.equal(canMerge({ ...green, mergeStateStatus: "BEHIND" }).ok, false);
  assert.equal(
    canMerge({
      ...green,
      checks: [{ name: "safety", status: "COMPLETED", conclusion: "FAILURE" }],
    }).ok,
    false,
  );
});

test("restackCommitMessage names branch and PR", () => {
  assert.equal(
    restackCommitMessage({ branch: "feat/stack", afterPr: 42 }),
    "Restack feat/stack onto origin/main after PR #42",
  );
});
