import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DEFAULT_ABSOLUTE_QUALIFIERS,
  DEFAULT_LENGTH_THRESHOLD,
  evaluateChangesetStyle,
  evaluateChangesetStyleAll,
  stripCodeSpans,
} from "./check-changeset-style.mjs";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-changeset-style.mjs");

function run(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
}

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "check-changeset-style-test-"));
  mkdirSync(join(root, "packages", "alpha"), { recursive: true });
  writeFileSync(join(root, "packages", "alpha", "package.json"), JSON.stringify({ name: "@x/alpha", version: "1.0.0" }));
  return root;
}

function writeChangeset(root, file, text) {
  mkdirSync(join(root, ".changesets"), { recursive: true });
  writeFileSync(join(root, ".changesets", file), text);
}

// -- stripCodeSpans --------------------------------------------------------

test("stripCodeSpans: removes backtick-delimited spans without touching surrounding prose", () => {
  assert.equal(stripCodeSpans("uses `record-append-only-clean` as its proofCase"), "uses   as its proofCase");
});

test("stripCodeSpans: leaves prose with no code spans unchanged", () => {
  assert.equal(stripCodeSpans("nothing to strip here"), "nothing to strip here");
});

// -- absolute-qualifier rule ------------------------------------------------

test("absolute-qualifier: flags every default qualifier by itself", () => {
  for (const term of DEFAULT_ABSOLUTE_QUALIFIERS) {
    const findings = evaluateChangesetStyle({ file: "f.md", summary: `This change is ${term} correct now.` });
    const rule = findings.find((f) => f.rule === "absolute-qualifier");
    assert.ok(rule, `expected an absolute-qualifier finding for "${term}"`);
    assert.match(rule.message, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("absolute-qualifier: a real corrected false claim (generalized) is flagged", () => {
  // Generalized from a real correction: a changeset once called a record
  // "an append-only, independently observed, first-person record" -- both
  // "append-only" and "independently" were unproven and later dropped.
  const findings = evaluateChangesetStyle({
    file: "f.md",
    summary: "Each output is now an append-only, independently observed record.",
  });
  const rules = findings.map((f) => f.rule);
  assert.ok(rules.includes("absolute-qualifier"));
  assert.equal(findings.filter((f) => f.rule === "absolute-qualifier").length, 2);
});

test("absolute-qualifier: does not flag a qualifier that only appears inside a code span", () => {
  const findings = evaluateChangesetStyle({
    file: "f.md",
    summary: "Names its proofCase as `record-append-only-clean`, a real qualification case.",
  });
  assert.deepEqual(findings.filter((f) => f.rule === "absolute-qualifier"), []);
});

test("absolute-qualifier: a plain factual sentence with no qualifiers is clean", () => {
  const findings = evaluateChangesetStyle({ file: "f.md", summary: "A caller can now pass a second, optional argument." });
  assert.deepEqual(findings, []);
});

// -- over-length rule --------------------------------------------------------

test("over-length: flags a summary past the default threshold", () => {
  const summary = "x".repeat(DEFAULT_LENGTH_THRESHOLD + 1);
  const findings = evaluateChangesetStyle({ file: "f.md", summary });
  const rule = findings.find((f) => f.rule === "over-length");
  assert.ok(rule);
  assert.match(rule.message, new RegExp(`${DEFAULT_LENGTH_THRESHOLD}-character threshold`));
});

test("over-length: does not flag a summary at or under the default threshold", () => {
  const atThreshold = evaluateChangesetStyle({ file: "f.md", summary: "x".repeat(DEFAULT_LENGTH_THRESHOLD) });
  assert.deepEqual(atThreshold.filter((f) => f.rule === "over-length"), []);
});

test("over-length: threshold is configurable", () => {
  const findings = evaluateChangesetStyle({ file: "f.md", summary: "x".repeat(50) }, { lengthThreshold: 10 });
  assert.ok(findings.some((f) => f.rule === "over-length"));
});

// -- negative-change-phrasing rule -------------------------------------------

test('negative-change-phrasing: flags "no longer ... never" double-negative phrasing', () => {
  const findings = evaluateChangesetStyle({
    file: "f.md",
    summary: "A stale record is no longer accepted, closing a gap the validator never checked before.",
  });
  assert.ok(findings.some((f) => f.rule === "negative-change-phrasing"));
});

test('negative-change-phrasing: flags "only ... not ..." scope phrasing', () => {
  const findings = evaluateChangesetStyle({
    file: "f.md",
    summary: "The new check covers only the added field, not the ones that already existed.",
  });
  assert.ok(findings.some((f) => f.rule === "negative-change-phrasing"));
});

test("negative-change-phrasing: a real corrected false claim (generalized) is flagged", () => {
  // Generalized from a real correction: a changeset once said "No schema or
  // field change -- prose only", which turned out to be false (the shipped
  // contract text changed, and a caller-supplied copy is now refused unless
  // it matches exactly).
  const findings = evaluateChangesetStyle({
    file: "f.md",
    summary: "No schema or field change -- prose only.",
  });
  assert.ok(findings.some((f) => f.rule === "negative-change-phrasing"));
});

test("negative-change-phrasing: a positive, factual sentence is clean", () => {
  const findings = evaluateChangesetStyle({
    file: "f.md",
    summary: "A caller-supplied contract must now match the shipped text exactly, or validation refuses it.",
  });
  // Note: this sentence intentionally also trips the absolute-qualifier
  // rule ("exactly") -- it is only clean of NEGATIVE phrasing.
  assert.deepEqual(findings.filter((f) => f.rule === "negative-change-phrasing"), []);
});

// -- evaluateChangesetStyleAll ------------------------------------------------

test("evaluateChangesetStyleAll: aggregates findings across several entries", () => {
  const findings = evaluateChangesetStyleAll([
    { file: "a.md", summary: "This is fine and factual." },
    { file: "b.md", summary: "This never changes and is exactly the same." },
  ]);
  assert.deepEqual(findings.map((f) => f.file).sort(), ["b.md", "b.md"]);
});

// -- CLI ----------------------------------------------------------------------

test("CLI: exits 0 even when findings are present", () => {
  const root = makeRoot();
  try {
    writeChangeset(root, "one.md", "---\nalpha: patch\n---\n\nThis never changes and is exactly the same as before.\n");
    const result = run(["--json"], root);
    assert.equal(result.code, 0, result.out);
    const parsed = JSON.parse(result.out);
    assert.ok(parsed.findings.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: exits 0 with zero findings and zero pending changesets", () => {
  const root = makeRoot();
  try {
    const result = run(["--json"], root);
    assert.equal(result.code, 0, result.out);
    const parsed = JSON.parse(result.out);
    assert.deepEqual(parsed.findings, []);
    assert.equal(parsed.pending, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: text output never claims failure", () => {
  const root = makeRoot();
  try {
    writeChangeset(root, "one.md", "---\nalpha: patch\n---\n\nThis never changes and is exactly the same as before.\n");
    const result = run([], root);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /Report-only: this never fails the check\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: exits 2 when .changesets/ cannot be read as a directory (unreadable input)", () => {
  const root = makeRoot();
  try {
    // A plain file where .changesets/ should be a directory: existsSync is
    // true, but readdirSync throws ENOTDIR -- the "unreadable input" case
    // this lint's exit contract carves out as the one nonzero exit.
    writeFileSync(join(root, ".changesets"), "not a directory");
    const result = run(["--json"], root);
    assert.equal(result.code, 2, result.out);
    const parsed = JSON.parse(result.out);
    assert.match(parsed.error, /could not read \.changesets\//);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
