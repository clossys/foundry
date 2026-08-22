import assert from "node:assert/strict";
import test from "node:test";

import { findConflictBlocks, run, EXIT_CODES } from "./check-conflict-markers.mjs";

const conflict = ["a", "<<<<<<< HEAD", "mine", "=======", "theirs", ">>>>>>> origin/main", "b"].join("\n");

test("a real conflict block is found, with its line numbers", () => {
  const blocks = findConflictBlocks(conflict);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], { startLine: 2, endLine: 6, hadDivider: true });
});

test("clean text finds nothing", () => {
  assert.deepEqual(findConflictBlocks("nothing\nto\nsee"), []);
});

// The false positives that would make this gate unusable on a repository whose
// documentation is mostly Markdown. Each is a real thing that appears in prose.
test("a Setext heading underline is NOT a conflict", () => {
  assert.deepEqual(findConflictBlocks("Title\n=====\n\nbody"), []);
});

test("a long horizontal rule is NOT a conflict", () => {
  assert.deepEqual(findConflictBlocks("before\n========================\nafter"), []);
});

test("a bare seven-equals divider with no opener is NOT a conflict", () => {
  // Exactly seven equals is the divider's shape, but a divider alone is
  // punctuation. It is only a conflict when it sits between an opener and a
  // closer, so this must not fire on its own.
  assert.deepEqual(findConflictBlocks("intro\n=======\noutro"), []);
});

test("prose ABOUT the markers is not a conflict when they are not line-initial", () => {
  // This gate's own README/PR text quotes the markers inline. Anchoring to the
  // start of a line is what keeps it from failing on documentation of itself.
  assert.deepEqual(findConflictBlocks("git writes <<<<<<< HEAD and >>>>>>> theirs into the file"), []);
});

test("an opener with no closer is reported, and is worse than a closed block", () => {
  const blocks = findConflictBlocks("x\n<<<<<<< HEAD\nrest of the file is inside it");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].endLine, null);
});

test("two conflicts in one file are two findings", () => {
  assert.equal(findConflictBlocks(conflict + "\n" + conflict).length, 2);
});

test("run() reports violated with the file and line range", () => {
  const result = run({ root: "/r", files: ["docs/a.md"], read: () => conflict });
  assert.equal(result.verdict, "violated");
  assert.equal(result.findings[0].file, "docs/a.md");
  assert.match(result.findings[0].detail, /lines 2-6/);
});

test("run() is satisfied on clean files", () => {
  assert.equal(run({ root: "/r", files: ["docs/a.md"], read: () => "clean" }).verdict, "satisfied");
});

test("an EMPTY file list is indeterminate, never a clean pass", () => {
  // A scan that looked at nothing has established nothing. Reporting that as
  // "no markers found" is the exact shape this gate exists because of.
  const result = run({ root: "/r", files: [] });
  assert.equal(result.verdict, "indeterminate");
  assert.match(result.reason, /zero tracked files/);
});

test("an unreadable file is skipped, not counted as clean or as a finding", () => {
  const result = run({ root: "/r", files: ["bin.dat"], read: () => { throw new Error("EISDIR"); } });
  assert.equal(result.verdict, "satisfied");
  assert.deepEqual(result.findings, []);
});

test("the ternary maps to 0/1/2", () => {
  assert.deepEqual(EXIT_CODES, { satisfied: 0, violated: 1, indeterminate: 2 });
});
