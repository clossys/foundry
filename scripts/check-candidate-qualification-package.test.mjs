// check-candidate-qualification.mjs --package: the publish-time scope.
//
// publish.yml's `qualify` job runs the script with `--package "$PKG"`, which
// re-derives the dispatched package's current-version record and no other
// (every retained record is re-derived by the required CI shards on the
// merge-group commit; see the step's own comment). These tests run the real
// script against a local clone of this repository and prove, on that record,
// that the scoped run refuses what the unscoped walk refused: rewritten
// retained bytes, a join that no longer matches its reviewed commit, and --
// new here -- a missing record, unless the dry-run allowance is given.
//
// governance/release-publications/later is set aside in the clone for every
// run. The script validates it identically with or without --package (it is
// a cross-record check, and every CI shard runs it), it is covered by
// release-later-publication's own tests, and each of its entries re-derives
// its own joins the expensive way -- keeping it would add most of a minute
// per subprocess without changing anything these tests assert. The script
// treats an absent directory as nothing to check. The same set-aside is
// used by scripts/lib/candidate-qualification.test.mjs for the same reason.
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { qualificationPath } from "./lib/candidate-qualification.mjs";

const execFile = promisify(execFileCallback);
const SCRIPT = join(process.cwd(), "scripts/check-candidate-qualification.mjs");
const RECORDS = "governance/release-qualifications";

async function run(root, args) {
  try {
    const { stdout, stderr } = await execFile(process.execPath, [SCRIPT, ...args], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

/**
 * Record paths some other retained file under `dir` names. Under
 * governance/release-qualification-cohorts, that binds the record's exact
 * bytes in a cross-record check, which runs in full under --package.
 */
function referencedRecordPaths(root, dir = "governance") {
  const referenced = new Set();
  const all = readdirSync(join(root, RECORDS)).map((file) => `${RECORDS}/${file}`);
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (path !== RECORDS) walk(path); continue; }
      if (!entry.name.endsWith(".json")) continue;
      const text = readFileSync(join(root, path), "utf8");
      for (const record of all) if (text.includes(record)) referenced.add(record);
    }
  };
  walk(dir);
  return referenced;
}

/**
 * The first package (sorted by key) whose current version has a retained
 * record AND at least one older retained record no other governance file
 * references -- derived from the tree rather than hard-coded, so a version
 * bump never silently retargets or breaks these tests.
 */
function choosePackage(root) {
  const referenced = referencedRecordPaths(root);
  for (const key of readdirSync(join(root, "packages")).sort()) {
    const manifestPath = join(root, "packages", key, "package.json");
    if (!existsSync(manifestPath)) continue;
    const { name, version } = JSON.parse(readFileSync(manifestPath, "utf8"));
    let current;
    try { current = qualificationPath(root, { name, version }); } catch { continue; }
    if (!existsSync(join(root, current))) continue;
    const stem = current.slice(RECORDS.length + 1, -`-${version}.json`.length);
    const older = readdirSync(join(root, RECORDS)).map((file) => `${RECORDS}/${file}`)
      .filter((path) => path !== current && !referenced.has(path) && path.startsWith(`${RECORDS}/${stem}-`) && JSON.parse(readFileSync(join(root, path), "utf8"))?.candidate?.name === name);
    if (older.length > 0) return { key, name, version, current, older: older.sort()[0], cohortBound: [...referencedRecordPaths(root, "governance/release-qualification-cohorts")].sort()[0], manifestPath };
  }
  throw new Error("no package with a current-version record and an unreferenced older record");
}

async function withClone(t) {
  const parent = await mkdtemp(join(tmpdir(), "candidate-qualification-package-"));
  t.after(() => rm(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const root = join(parent, "repo");
  await execFile("git", ["clone", "--quiet", "--local", "--no-hardlinks", process.cwd(), root]);
  await execFile("git", ["config", "gc.auto", "0"], { cwd: root });
  const later = join(root, "governance/release-publications/later");
  if (existsSync(later)) await rename(later, join(parent, "later.set-aside"));
  return { root, chosen: choosePackage(root) };
}

// Same parsed object, different bytes: the retained blob no longer equals its
// introduction blob, and nothing else about the record changes.
const rewriteBytesOnly = async (file) => writeFile(file, `${JSON.stringify(JSON.parse(readFileSync(file, "utf8")))}\n`);

test("--package re-derives the dispatched package's current record and passes on an untouched tree", async (t) => {
  const { root, chosen } = await withClone(t);
  const result = await run(root, ["--package", chosen.key]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`re-deriving only ${chosen.current.replace(/[.]/g, "\\.")} \\(`));
  assert.match(result.stdout, /CANDIDATE QUALIFICATION RECORD OK/);
});

test("--package refuses the package's record when its retained bytes were rewritten", async (t) => {
  const { root, chosen } = await withClone(t);
  await rewriteBytesOnly(join(root, chosen.current));
  const result = await run(root, ["--package", chosen.key]);
  assert.equal(result.code, 1);
  assert.ok(result.stderr.includes(`[record-history-join] ${chosen.current}:`), result.stderr);
});

test("--package refuses the package's record when a join no longer matches its reviewed commit", async (t) => {
  const { root, chosen } = await withClone(t);
  const file = join(root, chosen.current);
  const record = JSON.parse(readFileSync(file, "utf8"));
  record.candidate.packageTreeSha1 = record.candidate.packageTreeSha1 === "0".repeat(40) ? "1".repeat(40) : "0".repeat(40);
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  const result = await run(root, ["--package", chosen.key]);
  assert.equal(result.code, 1);
  assert.ok(result.stderr.includes(`[content-join] ${chosen.current}: packageTreeSha1`), result.stderr);
});

test("--package refuses a missing record for the current version unless --allow-missing-record is given", async (t) => {
  const { root, chosen } = await withClone(t);
  const manifest = JSON.parse(readFileSync(chosen.manifestPath, "utf8"));
  manifest.version = "99.99.99";
  await writeFile(chosen.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const missingPath = qualificationPath(root, { name: chosen.name, version: "99.99.99" });
  assert.equal(existsSync(join(root, missingPath)), false);

  const refused = await run(root, ["--package", chosen.key]);
  assert.equal(refused.code, 1);
  assert.ok(refused.stderr.includes(`[package-record-missing] ${missingPath}:`), refused.stderr);

  const allowed = await run(root, ["--package", chosen.key, "--allow-missing-record"]);
  assert.equal(allowed.code, 0, allowed.stderr);
  assert.ok(allowed.stdout.includes(`[package-record-missing] ${missingPath}: absent, allowed`), allowed.stdout);
});

test("--package leaves every other record's re-derivation to required CI: a rewritten older record of the same package is not re-derived", async (t) => {
  const { root, chosen } = await withClone(t);
  await rewriteBytesOnly(join(root, chosen.older));
  const result = await run(root, ["--package", chosen.key]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!result.stderr.includes(chosen.older), result.stderr);
});

test("--package still runs the cross-record checks in full: a rewritten record a retained cohort binds is refused", async (t) => {
  const { root, chosen } = await withClone(t);
  assert.ok(chosen.cohortBound, "a retained cohort binds a qualification record's bytes");
  await rewriteBytesOnly(join(root, chosen.cohortBound));
  const result = await run(root, ["--package", chosen.key]);
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stderr, /\[record-digest\] governance\/release-qualification-cohorts\//);
});

test("--package on an unknown package directory is indeterminate, not a pass", async (t) => {
  const { root } = await withClone(t);
  const result = await run(root, ["--package", "no-such-package"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /CANDIDATE QUALIFICATION INDETERMINATE/);
});
