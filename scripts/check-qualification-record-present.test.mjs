import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { qualificationRecordPresence } from "./check-qualification-record-present.mjs";
import { currentQualificationJoins } from "./lib/candidate-qualification.mjs";

// The gate reads the real policy to derive a record's path, so a fixture root
// borrows this repository's policy rather than inventing a second one that
// could drift from it.
function fixtureRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "foundry-record-presence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "governance"), { recursive: true });
  cpSync("governance/release-qualification-policy.json", join(root, "governance/release-qualification-policy.json"));
  mkdirSync(join(root, "governance/release-qualifications"), { recursive: true });
  return root;
}

function writeManifest(root, key, manifest) {
  mkdirSync(join(root, "packages", key), { recursive: true });
  writeFileSync(join(root, "packages", key, "package.json"), JSON.stringify(manifest));
}

// Staleness is joined against `currentQualificationJoins()`, and one of its
// fields (`packageTreeSha1`) is a real `git rev-parse <tree>:<packageDir>` —
// so, unlike the plain presence/absence fixtures above, a fixture exercising
// present/stale must be a real git repository. None of the committed content
// needs to resemble a real package beyond what `currentQualificationJoins`
// actually reads: the candidate manifest, a root `package.json` and
// `package-lock.json` (any bytes — they are only ever hashed, never parsed),
// and an adapter file at the real policy's `adapterPath` with an empty
// `fixtures` array (the "writer" policy entry marks every archetype/dimension
// that would otherwise require fixture content as unsupported).
function git(root, args) {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

function gitFixtureRoot(t) {
  const root = fixtureRoot(t);
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Qualification Test"]);
  writeFileSync(join(root, "package.json"), "{}\n");
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  return root;
}

function writeAdapter(root, key) {
  mkdirSync(join(root, "governance/release-qualification-adapters", key), { recursive: true });
  writeFileSync(join(root, "governance/release-qualification-adapters", key, "current-direct.json"), JSON.stringify({ fixtures: [] }));
}

function commitAll(root, message = "fixture") {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", message]);
}

// A retained record fixture: writes both digests `currentQualificationJoins`
// returns, so a "present" fixture is genuinely joining on both axes rather
// than happening to pass because one axis was never populated.
function writeRecord(root, recordPath, joins, overrides = {}) {
  writeFileSync(
    join(root, recordPath),
    JSON.stringify({ candidate: { packageManifestSha256: joins.packageManifestSha256, packageTreeSha1: joins.packageTreeSha1, ...overrides } }),
  );
}

test("reports present when the retained record exists for the manifest's exact version and still joins on both its manifest and tree digests", (t) => {
  const root = gitFixtureRoot(t);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3" });
  writeAdapter(root, "writer");
  commitAll(root);
  const joins = currentQualificationJoins(root, { name: "@clossys/writer", version: "0.3.3" });
  writeRecord(root, "governance/release-qualifications/clossys-writer-0.3.3.json", joins);
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "present");
  assert.equal(result.path, "governance/release-qualifications/clossys-writer-0.3.3.json");
});

// The negative control. A presence check that passes regardless of whether the
// record is there would be worse than no check: it would hand back a green
// preflight and let the run spend an approval anyway, which is the exact
// failure #769 describes. These two cases are what make the green meaningful.
test("reports missing when no record exists for that version", (t) => {
  const root = fixtureRoot(t);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3" });
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "missing");
  assert.equal(result.path, "governance/release-qualifications/clossys-writer-0.3.3.json");
});

test("reports missing when a record exists but for a different version", (t) => {
  const root = fixtureRoot(t);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3" });
  writeFileSync(join(root, "governance/release-qualifications/clossys-writer-0.3.2.json"), "{}");
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "missing", "a record for a neighbouring version must not satisfy this version");
});

test("is indeterminate, never a pass, when the manifest cannot be read", (t) => {
  const root = fixtureRoot(t);
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "indeterminate");
});

test("is indeterminate, never a pass, when the manifest declares no name/version", (t) => {
  const root = fixtureRoot(t);
  writeManifest(root, "writer", { private: true });
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "indeterminate");
});

test("is indeterminate, never a pass, when no package key is given", () => {
  assert.equal(qualificationRecordPresence({}).state, "indeterminate");
});

// --- staleness: a record binds a candidate on TWO axes —
// `candidate.packageManifestSha256` (package.json bytes alone) and
// `candidate.packageTreeSha1` (a git tree hash over the whole package
// directory, covering LICENSE/README/dist/everything else `npm pack` would
// include). A retained record that exists but no longer describes the
// *current* candidate on either axis must be its own state, distinct from
// both "present" (matches on both) and "missing" (no file at all) — a record
// that always reads "present" once the file exists is exactly what let
// designer 0.3.1 reach the publish job with a record qualified against a
// manifest a routine dependabot bump had already changed 29 minutes later.
//
// `currentQualificationJoins(root, candidate, "WORKTREE")` (the default)
// resolves `packageManifestSha256` from *disk* bytes but `packageTreeSha1`
// from the committed `HEAD` tree — so an uncommitted edit to package.json
// moves only the manifest digest, while a committed edit to some other file
// in the package directory moves only the tree digest. That asymmetry is
// exactly what lets the fixtures below isolate one axis of drift at a time.

test("reports stale (manifest only) when an uncommitted later change moves the manifest digest the record was qualified against", (t) => {
  const root = gitFixtureRoot(t);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3" });
  writeAdapter(root, "writer");
  commitAll(root);
  const joins = currentQualificationJoins(root, { name: "@clossys/writer", version: "0.3.3" });
  writeRecord(root, "governance/release-qualifications/clossys-writer-0.3.3.json", joins);
  // Stand in for PR #684: a merge to the package after qualification, same
  // version, different manifest bytes. The record is never touched, and
  // nothing else in the package directory changes (uncommitted, so
  // packageTreeSha1 — resolved against HEAD — does not move either).
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3", dependencies: { "@types/react-dom": "19.2.3" } });
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "stale");
  assert.equal(result.path, "governance/release-qualifications/clossys-writer-0.3.3.json");
  assert.deepEqual(result.staleFields, ["packageManifestSha256"]);
  assert.equal(result.recordedManifestDigest, joins.packageManifestSha256);
  assert.notEqual(result.currentManifestDigest, joins.packageManifestSha256);
  assert.equal(result.recordedTreeDigest, result.currentTreeDigest, "package.json is the only thing that changed — the tree digest must not have moved");
});

// The case measured on this repository's own live tree: `@clossys/starter`
// held a record whose packageManifestSha256 still matched — package.json was
// untouched — while its packageTreeSha1 had drifted because another file
// inside packages/starter/ had changed and been committed. A manifest-only
// comparison reports that as "present" and lets it reach the publish job on a
// spent approval; this is the case this issue's corrected finding is about.
test("reports stale (tree only) when a later committed change to a non-manifest file in the package directory moves the tree digest, package.json untouched", (t) => {
  const root = gitFixtureRoot(t);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3" });
  writeAdapter(root, "writer");
  commitAll(root);
  const joins = currentQualificationJoins(root, { name: "@clossys/writer", version: "0.3.3" });
  writeRecord(root, "governance/release-qualifications/clossys-writer-0.3.3.json", joins);
  // Stand in for the @clossys/starter case: package.json is never touched,
  // but another file inside the package directory changes and is committed —
  // this alone moves packageTreeSha1, which is resolved against HEAD.
  writeFileSync(join(root, "packages/writer/LICENSE"), "MIT\n");
  commitAll(root, "add LICENSE");
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "stale");
  assert.equal(result.path, "governance/release-qualifications/clossys-writer-0.3.3.json");
  assert.deepEqual(result.staleFields, ["packageTreeSha1"]);
  assert.equal(result.recordedManifestDigest, result.currentManifestDigest, "package.json is untouched — the manifest digest must not have moved");
  assert.equal(result.recordedTreeDigest, joins.packageTreeSha1);
  assert.notEqual(result.currentTreeDigest, joins.packageTreeSha1);
});

test("reports stale (both) and names both fields when the manifest and another packed file both drift", (t) => {
  const root = gitFixtureRoot(t);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3" });
  writeAdapter(root, "writer");
  commitAll(root);
  const joins = currentQualificationJoins(root, { name: "@clossys/writer", version: "0.3.3" });
  writeRecord(root, "governance/release-qualifications/clossys-writer-0.3.3.json", joins);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3", dependencies: { "@types/react-dom": "19.2.3" } });
  writeFileSync(join(root, "packages/writer/LICENSE"), "MIT\n");
  commitAll(root, "bump dependency and add LICENSE");
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "stale");
  assert.deepEqual(result.staleFields.slice().sort(), ["packageManifestSha256", "packageTreeSha1"]);
});

test("a stale finding still exits non-zero like missing, but is distinguishable from it", (t) => {
  const root = gitFixtureRoot(t);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3" });
  writeAdapter(root, "writer");
  commitAll(root);
  const joins = currentQualificationJoins(root, { name: "@clossys/writer", version: "0.3.3" });
  writeRecord(root, "governance/release-qualifications/clossys-writer-0.3.3.json", joins, { packageManifestSha256: "0".repeat(64) });
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "stale");
  assert.notEqual(result.state, "missing");
  assert.notEqual(result.state, "present");
});

test("is indeterminate, never a pass, when the retained record carries no packageManifestSha256 to join against", (t) => {
  const root = gitFixtureRoot(t);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3" });
  writeAdapter(root, "writer");
  commitAll(root);
  writeFileSync(join(root, "governance/release-qualifications/clossys-writer-0.3.3.json"), "{}");
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "indeterminate");
});

test("is indeterminate, never a pass, when the retained record carries no packageTreeSha1 to join against", (t) => {
  const root = gitFixtureRoot(t);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3" });
  writeAdapter(root, "writer");
  commitAll(root);
  const joins = currentQualificationJoins(root, { name: "@clossys/writer", version: "0.3.3" });
  writeFileSync(
    join(root, "governance/release-qualifications/clossys-writer-0.3.3.json"),
    JSON.stringify({ candidate: { packageManifestSha256: joins.packageManifestSha256 } }),
  );
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "indeterminate");
});

test("is indeterminate, never a pass, when the retained record is not valid JSON", (t) => {
  const root = gitFixtureRoot(t);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3" });
  writeAdapter(root, "writer");
  commitAll(root);
  writeFileSync(join(root, "governance/release-qualifications/clossys-writer-0.3.3.json"), "not json");
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "indeterminate");
});

test("is indeterminate, never a pass, when the current manifest digest cannot be recomputed (policy/adapter unreadable)", (t) => {
  const root = gitFixtureRoot(t);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3" });
  // No adapter written at the real policy's adapterPath for "writer" —
  // `currentQualificationJoins` cannot read it, so the join cannot be
  // recomputed. This must never be mistaken for a pass.
  commitAll(root);
  writeFileSync(
    join(root, "governance/release-qualifications/clossys-writer-0.3.3.json"),
    JSON.stringify({ candidate: { packageManifestSha256: "irrelevant-because-unreachable", packageTreeSha1: "irrelevant-because-unreachable" } }),
  );
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "indeterminate");
});

// Live-data check (not a synthetic fixture): does this gate's mechanism find
// anything on this repository's own retained records right now? Documented
// as a plain readback, not asserted either way, since the live tree moves —
// see the agent report/PR body for the recorded comparison at the time this
// suite was written.
test("live check: reads back designer's 0.2.7 record against today's packages/designer manifest and tree", () => {
  const path = "governance/release-qualifications/clossys-designer-0.2.7.json";
  const record = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(record.candidate.name, "@clossys/designer");
  assert.equal(record.candidate.version, "0.2.7");
  assert.equal(typeof record.candidate.packageManifestSha256, "string");
  assert.equal(typeof record.candidate.packageTreeSha1, "string");
  const current = currentQualificationJoins(process.cwd(), { name: record.candidate.name, version: record.candidate.version });
  console.log(
    `designer 0.2.7 record packageManifestSha256=${record.candidate.packageManifestSha256} ` +
      `vs today's packages/designer packageManifestSha256=${current.packageManifestSha256} ` +
      `(manifest fresh=${record.candidate.packageManifestSha256 === current.packageManifestSha256}); ` +
      `record packageTreeSha1=${record.candidate.packageTreeSha1} ` +
      `vs today's packages/designer packageTreeSha1=${current.packageTreeSha1} ` +
      `(tree fresh=${record.candidate.packageTreeSha1 === current.packageTreeSha1})`,
  );
});
