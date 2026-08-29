import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { currentQualificationJoins, parseStrictJson, qualificationPath, validateCandidateQualification, validatePrepublicationPrTail } from "./candidate-qualification.mjs";

const source = () => structuredClone(parseStrictJson(readFileSync("governance/release-qualifications/controller-0.8.20.json", "utf8")));
const currentSource = () => {
  const record = source();
  record.candidate.name = "@clossys/controller";
  record.transcript.candidate.name = "@clossys/controller";
  const transcript = { ...record.transcript };
  delete transcript.canonicalSha256;
  record.transcript.canonicalSha256 = createHash("sha256").update(JSON.stringify(transcript)).digest("hex");
  return record;
};
const bindCurrentJoins = (record, joins) => {
  record.candidate = {
    ...record.candidate,
    packageTreeSha1: joins.packageTreeSha1,
    packageManifestSha256: joins.packageManifestSha256,
    policySha256: joins.policySha256,
    adapterSha256: joins.adapterSha256,
    fixtureSetSha256: joins.fixtureSetSha256,
  };
  record.transcript.coverage.installedManifestSha256 = joins.packageManifestSha256;
  const transcript = { ...record.transcript };
  delete transcript.canonicalSha256;
  record.transcript.canonicalSha256 = createHash("sha256").update(JSON.stringify(transcript)).digest("hex");
};
const rules = (value, options) => validateCandidateQualification(value, options).map((item) => item.rule);
const execFile = promisify(execFileCallback);
async function git(root, args) { return execFile("git", args, { cwd: root }); }
async function commit(root, message) { await git(root, ["add", "."]); await git(root, ["commit", "-m", message]); return (await execFile("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(); }
async function syntheticPrepublication() {
  const root = await mkdtemp(join(tmpdir(), "qualification-tail-"));
  await git(root, ["init"]); await git(root, ["config", "user.email", "test@example.invalid"]); await git(root, ["config", "user.name", "Qualification Test"]);
  for (const path of ["packages/controller", "governance/release-qualification-adapters/controller", "governance/release-qualification-fixtures/controller/current-direct"]) await mkdir(join(root, path), { recursive: true });
  await cp("packages/controller/package.json", join(root, "packages/controller/package.json"));
  await cp("package.json", join(root, "package.json")); await cp("package-lock.json", join(root, "package-lock.json"));
  await cp("governance/release-qualification-policy.json", join(root, "governance/release-qualification-policy.json"));
  await cp("governance/release-qualification-adapters/controller/current-direct.json", join(root, "governance/release-qualification-adapters/controller/current-direct.json"));
  for (const name of ["authority-valid-package-lock.json", "authority-duplicate-package-lock.json", "authority-indeterminate-package-lock.json", "authority-declarations.json"]) await cp(join("governance/release-qualification-fixtures/controller/current-direct", name), join(root, "governance/release-qualification-fixtures/controller/current-direct", name));
  const reviewedCommit = await commit(root, "candidate");
  const record = currentSource(); const joins = currentQualificationJoins(root, record.candidate, reviewedCommit);
  bindCurrentJoins(record, joins);
  record.timing = "pre-publication"; record.reviewedCommit = reviewedCommit; record.rootPackageJsonSha256 = joins.rootPackageJsonSha256; record.rootPackageLockSha256 = joins.rootPackageLockSha256; record.candidateReview = { headSha: reviewedCommit, reference: "test-review" }; delete record.publishedCommit; delete record.registry;
  const path = qualificationPath(root, record.candidate, reviewedCommit); await mkdir(join(root, "governance/release-qualifications"), { recursive: true }); await writeFile(join(root, path), JSON.stringify(record, null, 2)); await commit(root, "record tail");
  return { root, record, path };
}
test("accepts the non-authorizing v2 bootstrap record offline and rejects it for prepublish", () => {
  const record = currentSource();
  assert.deepEqual(rules(record), []);
  assert.ok(rules(record, { mode: "prepublish" }).includes("bootstrap-timing"));
});
test("rejects transcript, candidate join, unknown-field, and findings drift", () => {
  const transcript = source(); transcript.transcript.canonicalSha256 = "0".repeat(64);
  assert.ok(rules(transcript).includes("transcript-digest"));
  const join = source(); join.candidate.policySha256 = "0".repeat(64);
  assert.ok(rules(join, { expected: { policySha256: "1".repeat(64) } }).includes("content-join"));
  const unknown = source(); unknown.waiver = true;
  assert.ok(rules(unknown).includes("unknown-field"));
  const finding = source(); finding.findings.push({ classification: "producer-package", status: "open", reference: "test" });
  assert.ok(rules(finding).includes("unresolved-producer-defect"));
});
test("prepublication review must bind the reviewed head", () => {
  const record = source();
  record.timing = "pre-publication"; record.reviewedCommit = record.publishedCommit; record.rootPackageJsonSha256 = "a".repeat(64); record.rootPackageLockSha256 = "b".repeat(64); record.candidateReview = { headSha: "c".repeat(40), reference: "test" };
  delete record.publishedCommit; delete record.registry;
  assert.ok(rules(record, { mode: "prepublish" }).includes("candidate-review"));
});
test("prepublication validation fails closed without complete current joins and a fresh transcript", () => {
  const record = source(); record.timing = "pre-publication"; record.reviewedCommit = record.publishedCommit; record.rootPackageJsonSha256 = "a".repeat(64); record.rootPackageLockSha256 = "b".repeat(64); record.candidateReview = { headSha: record.reviewedCommit, reference: "test" }; delete record.publishedCommit; delete record.registry;
  assert.ok(rules(record, { mode: "prepublish" }).includes("prepublish-evidence"));
});
test("strict JSON parsing rejects duplicate object keys", () => {
  assert.throws(() => parseStrictJson('{"schemaVersion":2,"schemaVersion":2}'), /duplicate JSON key/);
  assert.throws(() => parseStrictJson('{"candidate":{"name":"a","name":"b"}}'), /duplicate JSON key/);
});
test("prepublication PR tail accepts only an exact record-only tail", async (t) => {
  const fixture = await syntheticPrepublication(); t.after(() => rm(fixture.root, { recursive: true, force: true }));
  assert.deepEqual(validatePrepublicationPrTail(fixture.record, { root: fixture.root }), []);
  const expected = { name: fixture.record.candidate.name, version: fixture.record.candidate.version, ...currentQualificationJoins(fixture.root, fixture.record.candidate) };
  assert.deepEqual(rules(fixture.record, { mode: "prepublish", expected, freshTranscript: fixture.record.transcript }), []);
  fixture.record.reviewedCommit = "a".repeat(40);
  assert.ok(validatePrepublicationPrTail(fixture.record, { root: fixture.root }).some((item) => item.rule === "reviewed-ancestor"));
});
test("prepublication git tail rejects substantive package, root, policy, adapter, fixture, and extra-tail changes", async (t) => {
  const paths = ["packages/controller/package.json", "package.json", "package-lock.json", "governance/release-qualification-policy.json", "governance/release-qualification-adapters/controller/current-direct.json", "governance/release-qualification-fixtures/controller/current-direct/authority-valid-package-lock.json", "README.md"];
  for (const path of paths) {
    const fixture = await syntheticPrepublication(); t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await writeFile(join(fixture.root, path), "changed\n"); await commit(fixture.root, "substantive tail");
    const findings = validatePrepublicationPrTail(fixture.record, { root: fixture.root }).map((item) => item.rule);
    assert.ok(findings.includes(path === "README.md" ? "pr-tail" : "git-content-join"));
  }
});
test("publish content joins do not use candidate commit ancestry", () => {
  const record = currentSource();
  const joins = currentQualificationJoins(process.cwd(), record.candidate);
  bindCurrentJoins(record, joins);
  const expected = { name: record.candidate.name, version: record.candidate.version, ...joins };
  const syntheticSquashCommit = "f".repeat(40);
  assert.notEqual(syntheticSquashCommit, record.publishedCommit);
  assert.deepEqual(rules(record, { mode: "prepublish", expected, freshTranscript: record.transcript }).filter((rule) => rule !== "bootstrap-timing"), []);
});
