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

function writeDeferrals(root, deferrals) {
  mkdirSync(join(root, "governance"), { recursive: true });
  writeFileSync(join(root, "governance/release-qualification-deferrals.json"), JSON.stringify({ schemaVersion: 1, deferrals }, null, 2) + "\n");
}

function writeRecord(root, recordPath, joins) {
  mkdirSync(dirname(join(root, recordPath)), { recursive: true });
  writeFileSync(join(root, recordPath), JSON.stringify({ candidate: { packageManifestSha256: joins.packageManifestSha256, packageTreeSha1: joins.packageTreeSha1 } }));
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
  writeRecord(root, "governance/release-qualifications/clossys-writer-0.3.4.json", joins);
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
  writeRecord(root, "governance/release-qualifications/clossys-writer-0.3.4.json", joins);
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
