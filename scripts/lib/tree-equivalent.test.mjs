import test from "node:test";
import assert from "node:assert/strict";
import { treesEquivalent } from "./tree-equivalent.mjs";

const oid = "a".repeat(40);

test("treesEquivalent accepts matching lowercase 40-char trees", () => {
  assert.equal(treesEquivalent(oid, oid), true);
});

test("treesEquivalent rejects unequal trees", () => {
  assert.equal(treesEquivalent(oid, "b".repeat(40)), false);
});

test("treesEquivalent rejects uppercase or short ids", () => {
  assert.equal(treesEquivalent(oid.toUpperCase(), oid), false);
  assert.equal(treesEquivalent("abc", oid), false);
});
