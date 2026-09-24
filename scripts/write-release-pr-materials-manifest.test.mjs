import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildMaterialsManifest } from "./write-release-pr-materials-manifest.mjs";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "write-release-pr-materials-manifest.mjs");

function run(args) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], { encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
}

test("buildMaterialsManifest: splits a comma-separated labels string and carries the rest through verbatim", () => {
  assert.deepEqual(buildMaterialsManifest({ branch: "claude/release-2026-09-27-42", base: "main", labels: "release:weekly" }), {
    branch: "claude/release-2026-09-27-42",
    base: "main",
    title: "Release: apply pending changesets",
    labels: ["release:weekly"],
    bodyFile: "body.txt",
  });
});

test("buildMaterialsManifest: an out-of-band run's two labels both survive the split", () => {
  const manifest = buildMaterialsManifest({ branch: "claude/release-2026-09-27-42", base: "main", labels: "release:weekly,release:out-of-band" });
  assert.deepEqual(manifest.labels, ["release:weekly", "release:out-of-band"]);
});

// ---------------------------------------------------------------- end-to-end (the real regression)
//
// The bug this script replaces (issue #1439, defect 1) only reproduces
// through the ACTUAL argv a real process receives -- a direct call to
// buildMaterialsManifest() above cannot exercise it at all, since that
// function never touches process.argv. This is the test the removed
// inline `node -e` step could never have: it runs the real script as a
// real child process, the same way release-pr.yml's own step does, and
// fails exactly the way the workflow failed on run 36024191110 if the argv
// handling regresses back to a `[, , materialsDir, ...]`-shaped destructure.

test("end-to-end: writes manifest.json with all four arguments landing correctly", () => {
  const materialsDir = mkdtempSync(join(tmpdir(), "release-pr-materials-test-"));
  try {
    const r = run([materialsDir, "claude/release-2026-09-27-42", "main", "release:weekly"]);
    assert.equal(r.code, 0, r.out);
    const manifestPath = join(materialsDir, "manifest.json");
    assert.ok(existsSync(manifestPath), "manifest.json was not written");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.deepEqual(manifest, {
      branch: "claude/release-2026-09-27-42",
      base: "main",
      title: "Release: apply pending changesets",
      labels: ["release:weekly"],
      bodyFile: "body.txt",
    });
  } finally {
    rmSync(materialsDir, { recursive: true, force: true });
  }
});

test("end-to-end: an out-of-band run's two comma-separated labels both land in manifest.json", () => {
  const materialsDir = mkdtempSync(join(tmpdir(), "release-pr-materials-test-"));
  try {
    const r = run([materialsDir, "claude/release-2026-09-27-42", "main", "release:weekly,release:out-of-band"]);
    assert.equal(r.code, 0, r.out);
    const manifest = JSON.parse(readFileSync(join(materialsDir, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.labels, ["release:weekly", "release:out-of-band"]);
  } finally {
    rmSync(materialsDir, { recursive: true, force: true });
  }
});

test("end-to-end: refuses (exit 2) rather than crash when an argument is missing", () => {
  const r = run(["/tmp/does-not-matter", "claude/release-x", "main"]); // missing labels
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /usage/);
});
