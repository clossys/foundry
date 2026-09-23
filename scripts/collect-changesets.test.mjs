import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { changesetsForPackage, highestBumpLevel, loadChangesets, OUT_OF_BAND_VALUE, parseChangesetText, RELEASE_FLAG_KEY } from "./collect-changesets.mjs";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "collect-changesets.mjs");

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "collect-changesets-test-"));
  mkdirSync(join(root, "packages", "alpha"), { recursive: true });
  writeFileSync(join(root, "packages", "alpha", "package.json"), JSON.stringify({ name: "@x/alpha", version: "1.0.0" }));
  mkdirSync(join(root, "packages", "beta"), { recursive: true });
  writeFileSync(join(root, "packages", "beta", "package.json"), JSON.stringify({ name: "@x/beta", version: "1.0.0" }));
  return root;
}

function writeChangeset(root, file, text) {
  mkdirSync(join(root, ".changesets"), { recursive: true });
  writeFileSync(join(root, ".changesets", file), text);
}

function run(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
}

test("parseChangesetText: parses a single-package changeset", () => {
  const result = parseChangesetText("---\nalpha: minor\n---\n\nAdd a new export.\n", { knownPackageDirs: new Set(["alpha"]) });
  assert.deepEqual(result, { packages: { alpha: "minor" }, summary: "Add a new export.", outOfBand: false });
});

test("parseChangesetText: parses several packages in one file", () => {
  const text = "---\nalpha: patch\nbeta: major\n---\n\nBody.\n";
  const result = parseChangesetText(text, { knownPackageDirs: new Set(["alpha", "beta"]) });
  assert.deepEqual(result, { packages: { alpha: "patch", beta: "major" }, summary: "Body.", outOfBand: false });
});

test("parseChangesetText: a `release: out-of-band` line flags the changeset without being treated as a package", () => {
  assert.equal(RELEASE_FLAG_KEY, "release");
  assert.equal(OUT_OF_BAND_VALUE, "out-of-band");
  const text = "---\nalpha: patch\nrelease: out-of-band\n---\n\nFix the broken 26.39.0 release.\n";
  const result = parseChangesetText(text, { knownPackageDirs: new Set(["alpha"]) });
  assert.deepEqual(result, { packages: { alpha: "patch" }, summary: "Fix the broken 26.39.0 release.", outOfBand: true });
});

test("parseChangesetText: rejects a `release` value other than out-of-band", () => {
  const result = parseChangesetText("---\nalpha: patch\nrelease: emergency\n---\n\nBody.\n", { knownPackageDirs: new Set(["alpha"]) });
  assert.match(result.error, /only legal value is "out-of-band"/);
});

test("parseChangesetText: rejects a duplicate release flag", () => {
  const result = parseChangesetText("---\nalpha: patch\nrelease: out-of-band\nrelease: out-of-band\n---\n\nBody.\n", { knownPackageDirs: new Set(["alpha"]) });
  assert.match(result.error, /"release" more than once/);
});

test("parseChangesetText: rejects a release-flag-only changeset (no package named)", () => {
  const result = parseChangesetText("---\nrelease: out-of-band\n---\n\nBody.\n", { knownPackageDirs: new Set(["alpha"]) });
  assert.match(result.error, /must name at least one package/);
});

test("parseChangesetText: an out-of-band changeset must bump every named package at patch", () => {
  const result = parseChangesetText("---\nalpha: minor\nrelease: out-of-band\n---\n\nFix a security issue.\n", { knownPackageDirs: new Set(["alpha"]) });
  assert.match(result.error, /must bump every package it names at "patch"/);
  assert.match(result.error, /alpha: minor/);
});

test("parseChangesetText: an out-of-band changeset with several packages, all patch, is fine", () => {
  const result = parseChangesetText("---\nalpha: patch\nbeta: patch\nrelease: out-of-band\n---\n\nFix a security issue.\n", { knownPackageDirs: new Set(["alpha", "beta"]) });
  assert.deepEqual(result, { packages: { alpha: "patch", beta: "patch" }, summary: "Fix a security issue.", outOfBand: true });
});

test("parseChangesetText: an out-of-band changeset with one non-patch package among several is rejected", () => {
  const result = parseChangesetText("---\nalpha: patch\nbeta: major\nrelease: out-of-band\n---\n\nFix a security issue.\n", { knownPackageDirs: new Set(["alpha", "beta"]) });
  assert.match(result.error, /beta: major/);
});

test("parseChangesetText: rejects missing frontmatter", () => {
  const result = parseChangesetText("no frontmatter here\n", {});
  assert.ok(result.error);
});

test("parseChangesetText: rejects empty summary", () => {
  const result = parseChangesetText("---\nalpha: patch\n---\n\n\n", { knownPackageDirs: new Set(["alpha"]) });
  assert.ok(result.error);
});

test("parseChangesetText: rejects unknown package directory", () => {
  const result = parseChangesetText("---\nnotreal: patch\n---\n\nBody.\n", { knownPackageDirs: new Set(["alpha"]) });
  assert.match(result.error, /not a packages\/ directory/);
});

test("parseChangesetText: rejects invalid bump level", () => {
  const result = parseChangesetText("---\nalpha: huge\n---\n\nBody.\n", { knownPackageDirs: new Set(["alpha"]) });
  assert.match(result.error, /bump must be one of/);
});

test("parseChangesetText: rejects duplicate package name", () => {
  const result = parseChangesetText("---\nalpha: patch\nalpha: minor\n---\n\nBody.\n", { knownPackageDirs: new Set(["alpha"]) });
  assert.match(result.error, /more than once/);
});

test("loadChangesets: no .changesets directory is not an error", () => {
  const root = mkdtempSync(join(tmpdir(), "collect-changesets-test-"));
  try {
    assert.deepEqual(loadChangesets(root), { entries: [], findings: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadChangesets: skips README.md and validates the rest", () => {
  const root = makeRoot();
  try {
    writeChangeset(root, "README.md", "# Changesets\n");
    writeChangeset(root, "alpha-fix.md", "---\nalpha: patch\n---\n\nFix a bug.\n");
    const { entries, findings } = loadChangesets(root);
    assert.equal(findings.length, 0);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].file, "alpha-fix.md");
    assert.deepEqual(entries[0].packages, { alpha: "patch" });
    assert.equal(entries[0].outOfBand, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadChangesets: rejects a bad filename", () => {
  const root = makeRoot();
  try {
    writeChangeset(root, "Not_Valid.md", "---\nalpha: patch\n---\n\nFix.\n");
    const { entries, findings } = loadChangesets(root);
    assert.equal(entries.length, 0);
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /filename must match/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("changesetsForPackage and highestBumpLevel combine correctly", () => {
  const entries = [
    { file: "a.md", packages: { alpha: "patch" }, summary: "s1", outOfBand: false },
    { file: "b.md", packages: { alpha: "major", beta: "minor" }, summary: "s2", outOfBand: true },
  ];
  const forAlpha = changesetsForPackage(entries, "alpha");
  assert.equal(forAlpha.length, 2);
  assert.equal(highestBumpLevel(forAlpha.map((e) => e.bump)), "major");
  assert.deepEqual(forAlpha.map((e) => e.outOfBand), [false, true]);
  assert.throws(() => highestBumpLevel([]));
});

test("CLI: exits 0 with no pending changesets", () => {
  const root = makeRoot();
  try {
    const r = run(["--json"], root);
    assert.equal(r.code, 0, r.out);
    const report = JSON.parse(r.out);
    assert.deepEqual(report, { entries: [], findings: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: exits 1 on a malformed changeset", () => {
  const root = makeRoot();
  try {
    writeChangeset(root, "bad.md", "not a changeset\n");
    const r = run(["--json"], root);
    assert.equal(r.code, 1, r.out);
    const report = JSON.parse(r.out);
    assert.equal(report.findings.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: exits 0 on a well-formed changeset", () => {
  const root = makeRoot();
  try {
    writeChangeset(root, "alpha-fix.md", "---\nalpha: patch\n---\n\nFix a bug.\n");
    const r = run(["--json"], root);
    assert.equal(r.code, 0, r.out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
