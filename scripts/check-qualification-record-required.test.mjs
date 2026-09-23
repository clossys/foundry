import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { currentQualificationJoins } from "./lib/candidate-qualification.mjs";

// Hermetic end-to-end coverage, in the same spirit as
// check-release-readiness.test.mjs and check-qualification-record-present.test.mjs:
// every fixture is a real, throwaway git repo under mkdtemp, and the real
// script is spawned exactly the way CI spawns it. The fixture borrows this
// repository's OWN governance/release-qualification-policy.json (as
// check-qualification-record-present.test.mjs already does) rather than
// inventing a second policy that could drift from the real one, so the
// fixture package is always named "writer" against the real "@clossys/writer"
// policy entry.
const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-qualification-record-required.mjs");

function git(args, cwd) {
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitCommit(root, message) {
  git(["add", "-A"], root);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message], root);
  return git0(root, ["rev-parse", "HEAD"]).trim();
}

function git0(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function run(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
}

function writeManifest(root, key, extra = {}) {
  mkdirSync(join(root, "packages", key, "src"), { recursive: true });
  writeFileSync(
    join(root, "packages", key, "package.json"),
    JSON.stringify({ name: "@clossys/writer", version: "0.3.3", private: false, license: "MIT", files: ["src", "README.md", "LICENSE"], ...extra }, null, 2) + "\n",
  );
  writeFileSync(join(root, "packages", key, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(root, "packages", key, "README.md"), "# writer\n");
  writeFileSync(join(root, "packages", key, "LICENSE"), "MIT\n");
}

function writeAdapter(root, key) {
  mkdirSync(join(root, "governance/release-qualification-adapters", key), { recursive: true });
  writeFileSync(join(root, "governance/release-qualification-adapters", key, "current-direct.json"), JSON.stringify({ fixtures: [] }));
}

// One file per deferral (issue #1254), matching the real
// governance/release-qualification-deferrals/<package>@<version>.json
// layout — each entry becomes its own file, named from its own
// package/version fields, under an otherwise-empty directory.
function writeDeferrals(root, deferrals) {
  const dir = join(root, "governance/release-qualification-deferrals");
  mkdirSync(dir, { recursive: true });
  for (const entry of deferrals) {
    writeFileSync(join(dir, `${entry.package}@${entry.version}.json`), JSON.stringify(entry, null, 2) + "\n");
  }
}

// `candidate` carries {name, version} — a real retained record always names
// its own candidate this way (see e.g. any file under
// governance/release-qualifications/), and qualificationRecordRetainedForVersion()
// (used by checkStaleDeferrals() to re-check a deferral for an OLD version
// against exactly this field, deliberately without recomputing anything from
// the live worktree — see that function's own doc comment) depends on it
// being present to confirm the record actually describes the candidate it
// sits at the path for, not some other file that happens to occupy it.
function writeRecord(root, recordPath, candidate, joins) {
  mkdirSync(dirname(join(root, recordPath)), { recursive: true });
  writeFileSync(join(root, recordPath), JSON.stringify({ candidate: { name: candidate.name, version: candidate.version, packageManifestSha256: joins.packageManifestSha256, packageTreeSha1: joins.packageTreeSha1 } }));
}

// Builds a real git repo with: root package.json/package-lock.json, the real
// release-qualification-policy.json + an empty adapter for "writer", and a
// packages/writer manifest at 0.3.3. Does not commit — the caller decides.
function fixtureRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "qualification-required-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(["init", "-q"], root);
  mkdirSync(join(root, "governance"), { recursive: true });
  cpSync("governance/release-qualification-policy.json", join(root, "governance/release-qualification-policy.json"));
  mkdirSync(join(root, "governance/release-qualifications"), { recursive: true });
  writeFileSync(join(root, "package.json"), "{}\n");
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  writeManifest(root, "writer");
  writeAdapter(root, "writer");
  writeDeferrals(root, []);
  return root;
}

test("passes (exit 0) when no package version changed relative to --base", (t) => {
  const root = fixtureRoot(t);
  const base = gitCommit(root, "initial");
  const r = run(["--json", "--base", base], root);
  const report = JSON.parse(r.out);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  assert.equal(report.results.find((x) => x.package === "@clossys/writer").status, "pass");
});

test("MUTATION: fails (exit 1) when a package version bumps with no retained qualification record", (t) => {
  const root = fixtureRoot(t);
  const base = gitCommit(root, "initial at 0.3.3");
  writeManifest(root, "writer", { version: "0.3.4" });

  const r = run(["--json", "--base", base], root);
  const report = JSON.parse(r.out);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
  const writer = report.results.find((x) => x.package === "@clossys/writer");
  assert.equal(writer.status, "needs-record");
  assert.match(writer.detail, /no retained record exists/);
});

test("MUTATION: goes green (exit 0) once the version-bumped candidate has a matching retained record", (t) => {
  const root = fixtureRoot(t);
  const base = gitCommit(root, "initial at 0.3.3");
  writeManifest(root, "writer", { version: "0.3.4" });
  gitCommit(root, "bump to 0.3.4");
  const joins = currentQualificationJoins(root, { name: "@clossys/writer", version: "0.3.4" });
  writeRecord(root, "governance/release-qualifications/clossys-writer-0.3.4.json", { name: "@clossys/writer", version: "0.3.4" }, joins);
  gitCommit(root, "retain qualification record for 0.3.4");

  const r = run(["--json", "--base", base], root);
  const report = JSON.parse(r.out);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  const writer = report.results.find((x) => x.package === "@clossys/writer");
  assert.equal(writer.status, "pass");
  assert.match(writer.detail, /retained, matching qualification record exists/);
});

test("an acknowledged, issue-referenced deferral makes a missing record pass (deferred), not fail", (t) => {
  const root = fixtureRoot(t);
  const base = gitCommit(root, "initial at 0.3.3");
  writeManifest(root, "writer", { version: "0.3.4" });
  writeDeferrals(root, [{ package: "writer", version: "0.3.4", reason: "mid publish-wave; see PR #848 precedent for controller", issue: 900 }]);

  const r = run(["--json", "--base", base], root);
  const report = JSON.parse(r.out);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  const writer = report.results.find((x) => x.package === "@clossys/writer");
  assert.equal(writer.status, "deferred");
});

test("a devDependencies-only change is exempt — never requires a record, because the version never changed", (t) => {
  const root = fixtureRoot(t);
  const base = gitCommit(root, "initial at 0.3.3");
  writeManifest(root, "writer", { devDependencies: { typescript: "5.4.0" } });

  const r = run(["--json", "--base", base], root);
  const report = JSON.parse(r.out);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  const writer = report.results.find((x) => x.package === "@clossys/writer");
  assert.equal(writer.status, "pass");
  assert.match(writer.detail, /no version change relative to the merge base/);
});

test("STALE DEFERRAL: an acknowledged deferral for a version that now HAS a retained record fails until removed", (t) => {
  const root = fixtureRoot(t);
  const base = gitCommit(root, "initial at 0.3.3");
  writeManifest(root, "writer", { version: "0.3.4" });
  gitCommit(root, "bump to 0.3.4");
  const joins = currentQualificationJoins(root, { name: "@clossys/writer", version: "0.3.4" });
  writeRecord(root, "governance/release-qualifications/clossys-writer-0.3.4.json", { name: "@clossys/writer", version: "0.3.4" }, joins);
  // The deferral was never removed after the record landed.
  writeDeferrals(root, [{ package: "writer", version: "0.3.4", reason: "mid publish-wave; see PR #848 precedent for controller", issue: 900 }]);
  gitCommit(root, "retain record but forget to remove the now-satisfied deferral");

  const r = run(["--json", "--base", base], root);
  const report = JSON.parse(r.out);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
  const stale = report.deferralFindings.find((f) => f.rule === "stale-deferral");
  assert.ok(stale, `expected a stale-deferral finding, got ${JSON.stringify(report.deferralFindings)}`);
  assert.equal(stale.subject, "writer");
});

// REGRESSION (issue #1187, item 4): the test above only proves the gate
// catches a satisfied deferral for the CURRENT version — the exact case
// that already worked, because qualificationRecordPresenceForCandidate()
// recomputes digests from the live worktree, which happens to describe the
// current version. Everything below proves the fix for the real gap: a
// deferral for a version the package has already moved PAST.
test("REGRESSION: a deferral for an OLD, already-superseded version that already has a retained record fails — not only the current version", (t) => {
  const root = fixtureRoot(t);
  const base = gitCommit(root, "initial at 0.3.3");
  // The package has already moved on to 0.4.0. The deferral below names an
  // older version, 0.3.4, that this package bumped straight through — its
  // package.json no longer says 0.3.4 anywhere.
  writeManifest(root, "writer", { version: "0.4.0" });
  // A qualification record for that OLD 0.3.4 version WAS, in fact, later
  // retained — the deferral that acknowledged its absence was simply never
  // removed. Its digests are arbitrary and deliberately do not describe the
  // CURRENT 0.4.0 tree at all: qualificationRecordRetainedForVersion() must
  // not recompute anything from the live worktree to see this (see its own
  // doc comment) — doing so is exactly the bug being regression-tested here,
  // since a 0.3.4 record can never match a 0.4.0 worktree by construction.
  writeRecord(
    root,
    "governance/release-qualifications/clossys-writer-0.3.4.json",
    { name: "@clossys/writer", version: "0.3.4" },
    { packageManifestSha256: "old-manifest-digest-0.3.4", packageTreeSha1: "old-tree-digest-0.3.4" },
  );
  writeDeferrals(root, [{ package: "writer", version: "0.3.4", reason: "mid publish-wave; see PR #848 precedent for controller", issue: 900 }]);

  const r = run(["--json", "--base", base], root);
  const report = JSON.parse(r.out);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
  const stale = report.deferralFindings.find((f) => f.rule === "stale-deferral");
  assert.ok(stale, `expected a stale-deferral finding for the superseded 0.3.4 deferral, got ${JSON.stringify(report.deferralFindings)}`);
  assert.equal(stale.subject, "writer");
  assert.match(stale.message, /"0\.3\.4"/, `message should name the exact deferred version, got: ${stale.message}`);
  assert.match(stale.message, /issue #900/);
});

test("REGRESSION: two deferral files that both claim the same package@version fail, even when only one is named for itself", (t) => {
  const root = fixtureRoot(t);
  const base = gitCommit(root, "initial at 0.3.3");
  writeManifest(root, "writer", { version: "0.3.4" });
  const dir = join(root, "governance/release-qualification-deferrals");
  mkdirSync(dir, { recursive: true });
  const entry = { package: "writer", version: "0.3.4", reason: "mid publish-wave; see PR #848 precedent for controller", issue: 900 };
  // The correctly-named original...
  writeFileSync(join(dir, "writer@0.3.4.json"), JSON.stringify(entry, null, 2) + "\n");
  // ...plus a stray second copy left behind by a bad manual merge-conflict
  // resolution: a different filename, but claiming the identical
  // package@version underneath.
  writeFileSync(join(dir, "writer@0.3.4-conflict-copy.json"), JSON.stringify(entry, null, 2) + "\n");

  const r = run(["--json", "--base", base], root);
  const report = JSON.parse(r.out);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
  const dup = report.deferralFindings.find((f) => f.rule === "duplicate-deferral");
  assert.ok(dup, `expected a duplicate-deferral finding, got ${JSON.stringify(report.deferralFindings)}`);
  assert.equal(dup.subject, "writer");
  assert.match(dup.message, /writer@0\.3\.4\.json/);
  assert.match(dup.message, /writer@0\.3\.4-conflict-copy\.json/);
});

test("CONTROL: a legitimate, still-unsatisfied deferral for an already-superseded version keeps passing (no false stale/duplicate finding)", (t) => {
  const root = fixtureRoot(t);
  const base = gitCommit(root, "initial at 0.3.3");
  // The package has moved on to 0.4.0; the deferral names an OLDER version,
  // 0.3.4, that was bumped through without a record — and still has none.
  // This is exactly the ongoing, genuine debt a deferral is meant to carry,
  // and the hardening above must not start failing it: it has neither a
  // retained record (no false stale-deferral) nor a colliding sibling file
  // (no false duplicate-deferral).
  writeManifest(root, "writer", { version: "0.4.0" });
  writeDeferrals(root, [{ package: "writer", version: "0.3.4", reason: "mid publish-wave; see PR #848 precedent for controller", issue: 900 }]);

  const r = run(["--json", "--base", base], root);
  const report = JSON.parse(r.out);
  assert.equal(report.deferralFindings.length, 0, `expected no deferral findings for the still-open 0.3.4 deferral, got ${JSON.stringify(report.deferralFindings)}`);
});

test("a malformed deferral (no reason) is a real finding, not a silent free pass", (t) => {
  const root = fixtureRoot(t);
  const base = gitCommit(root, "initial at 0.3.3");
  writeManifest(root, "writer", { version: "0.3.4" });
  writeDeferrals(root, [{ package: "writer", version: "0.3.4", issue: 900 }]);

  const r = run(["--json", "--base", base], root);
  const report = JSON.parse(r.out);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
  const writer = report.results.find((x) => x.package === "@clossys/writer");
  assert.equal(writer.status, "needs-record", "an unreadable deferral entry must not be treated as an acknowledgement");
  assert.ok(report.deferralFindings.some((f) => f.rule === "deferral-without-reason"));
});

test("skips a private:true package even if its version changed", (t) => {
  const root = fixtureRoot(t);
  const base = gitCommit(root, "initial at 0.3.3");
  writeManifest(root, "writer", { version: "0.3.4", private: true });

  const r = run(["--json", "--base", base], root);
  const report = JSON.parse(r.out);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  assert.equal(report.results.find((x) => x.package === "writer" || x.package === "@clossys/writer").status, "skip");
});

test("refuses to report a clean pass on an empty scan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "qualification-required-empty-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(["init", "-q"], root);
  const r = run(["--json"], root);
  assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
});


// MIGRATION (issue #1254): governance/release-qualification-deferrals.json
// no longer exists as a store — deferrals live one-file-per-package@version
// under governance/release-qualification-deferrals/ instead. These four
// cases are specific to that migration; every case above already proves the
// entry-level rules (issue required, stale-once-recorded, malformed
// entries) still hold against the new layout.

test("MIGRATION: the retired single-file path fails loudly, naming the new layout and #1254, rather than being silently ignored", (t) => {
  const root = fixtureRoot(t);
  const base = gitCommit(root, "initial at 0.3.3");
  writeFileSync(join(root, "governance/release-qualification-deferrals.json"), JSON.stringify({ schemaVersion: 1, deferrals: [] }, null, 2) + "\n");

  const r = run(["--json", "--base", base], root);
  const report = JSON.parse(r.out);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
  const legacy = report.deferralFindings.find((f) => f.rule === "legacy-deferrals-file");
  assert.ok(legacy, `expected a legacy-deferrals-file finding, got ${JSON.stringify(report.deferralFindings)}`);
  assert.match(legacy.message, /governance\/release-qualification-deferrals\/<package>@<version>\.json/);
  assert.match(legacy.message, /#1254/);
});

test("MIGRATION: a file whose name disagrees with its own package/version contents is a real finding", (t) => {
  const root = fixtureRoot(t);
  const base = gitCommit(root, "initial at 0.3.3");
  writeManifest(root, "writer", { version: "0.3.4" });
  const dir = join(root, "governance/release-qualification-deferrals");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "writer@0.3.9.json"), JSON.stringify({ package: "writer", version: "0.3.4", reason: "x".repeat(25), issue: 900 }, null, 2) + "\n");

  const r = run(["--json", "--base", base], root);
  const report = JSON.parse(r.out);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
  assert.ok(report.deferralFindings.some((f) => f.rule === "deferral-file-name-mismatch"), `expected deferral-file-name-mismatch, got ${JSON.stringify(report.deferralFindings)}`);
  // The mismatched file must not be silently accepted as if it had named writer@0.3.9 — the manifest never bumped to 0.3.9, so no result exists for that version; the real 0.3.4 bump above still shows as missing a record, not as deferred.
  const writer = report.results.find((x) => x.package === "@clossys/writer");
  assert.equal(writer.status, "needs-record");
});

test("MIGRATION: one malformed deferral file does not hide the state of the other, well-formed ones", (t) => {
  const root = fixtureRoot(t);
  const base = gitCommit(root, "initial at 0.3.3");
  writeManifest(root, "writer", { version: "0.3.4" });
  const dir = join(root, "governance/release-qualification-deferrals");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "writer@0.3.4.json"), JSON.stringify({ package: "writer", version: "0.3.4", reason: "x".repeat(25), issue: 900 }, null, 2) + "\n");
  writeFileSync(join(dir, "broken.json"), "{ not json");

  const r = run(["--json", "--base", base], root);
  const report = JSON.parse(r.out);
  const writer = report.results.find((x) => x.package === "@clossys/writer");
  assert.equal(writer.status, "deferred", "the broken sibling file must not stop the well-formed writer@0.3.4 deferral from being honored");
  assert.ok(report.deferralFindings.some((f) => f.rule === "unreadable-deferral-file" && f.subject.endsWith("broken.json")));
});
