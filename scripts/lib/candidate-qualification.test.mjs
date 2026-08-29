import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { currentQualificationJoins, parseStrictJson, qualificationIntroductionCommit, qualificationPath, validateCandidateQualification, validatePrepublicationPrTail } from "./candidate-qualification.mjs";

const CONTROLLER_RECORD_DIRECTORY = "governance/release-qualifications";
const CONTROLLER_NAME = "@vespeneventures/controller";

function releaseVersion(value) {
  const parts = String(value).split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0 || [...part].some((character) => character < "0" || character > "9"))) return null;
  const numbers = parts.map(Number);
  return numbers.every(Number.isSafeInteger) ? numbers : null;
}

function compareReleaseVersions(left, right) {
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] - right[index];
  return 0;
}

export function selectControllerQualificationRecord(entries, manifestVersion) {
  const current = releaseVersion(manifestVersion);
  if (!current) throw new Error("Controller manifest version must be an exact release version");
  const eligible = entries.filter((entry) => {
    const version = releaseVersion(entry.version);
    return version && compareReleaseVersions(version, current) <= 0;
  }).sort((left, right) => compareReleaseVersions(releaseVersion(right.version), releaseVersion(left.version)));
  if (eligible.length === 0) throw new Error("Controller qualification record is missing");
  if (eligible[1]?.version === eligible[0].version) throw new Error("Controller qualification record is ambiguous");
  return eligible[0];
}

function controllerQualificationRecord() {
  const manifest = parseStrictJson(readFileSync("packages/controller/package.json", "utf8"));
  const entries = readdirSync(CONTROLLER_RECORD_DIRECTORY).filter((file) => file.startsWith("controller-") && file.endsWith(".json")).map((file) => {
    const record = parseStrictJson(readFileSync(`${CONTROLLER_RECORD_DIRECTORY}/${file}`, "utf8"));
    if (record?.candidate?.name !== CONTROLLER_NAME || file !== `controller-${record?.candidate?.version}.json`) throw new Error("Controller qualification record identity does not match its path");
    return { file, version: record.candidate.version, record };
  });
  return selectControllerQualificationRecord(entries, manifest.version).record;
}

const source = () => structuredClone(controllerQualificationRecord());
const recordCommit = (record) => qualificationIntroductionCommit(process.cwd(), record.candidate);
const rules = (value, options) => validateCandidateQualification(value, options).map((item) => item.rule);
const execFile = promisify(execFileCallback);
async function git(root, args) { return execFile("git", args, { cwd: root }); }
async function commit(root, message) { await git(root, ["add", "."]); await git(root, ["commit", "-m", message]); return (await execFile("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(); }
async function syntheticPrepublication() {
  const root = await mkdtemp(join(tmpdir(), "qualification-tail-"));
  await git(root, ["init"]); await git(root, ["config", "user.email", "test@example.invalid"]); await git(root, ["config", "user.name", "Qualification Test"]);
  const record = source(); const sourceCommit = recordCommit(record);
  for (const path of ["packages/controller", "governance/release-qualification-adapters/controller", "governance/release-qualification-fixtures/controller/current-direct"]) await mkdir(join(root, path), { recursive: true });
  const copyFromRecordCommit = async (path) => writeFile(join(root, path), (await execFile("git", ["show", `${sourceCommit}:${path}`])).stdout);
  await copyFromRecordCommit("packages/controller/package.json");
  await copyFromRecordCommit("package.json"); await copyFromRecordCommit("package-lock.json");
  await copyFromRecordCommit("governance/release-qualification-policy.json");
  await copyFromRecordCommit("governance/release-qualification-adapters/controller/current-direct.json");
  for (const name of ["authority-valid-package-lock.json", "authority-duplicate-package-lock.json", "authority-indeterminate-package-lock.json", "authority-declarations.json"]) await copyFromRecordCommit(`governance/release-qualification-fixtures/controller/current-direct/${name}`);
  const reviewedCommit = await commit(root, "candidate");
  const joins = currentQualificationJoins(root, record.candidate, reviewedCommit);
  record.timing = "pre-publication"; record.reviewedCommit = reviewedCommit; record.rootPackageJsonSha256 = joins.rootPackageJsonSha256; record.rootPackageLockSha256 = joins.rootPackageLockSha256; record.candidate = { ...record.candidate, packageTreeSha1: joins.packageTreeSha1, packageManifestSha256: joins.packageManifestSha256, policySha256: joins.policySha256, adapterSha256: joins.adapterSha256, fixtureSetSha256: joins.fixtureSetSha256 }; record.candidateReview = { headSha: reviewedCommit, reference: "test-review" }; delete record.publishedCommit; delete record.registry;
  const path = qualificationPath(root, record.candidate, reviewedCommit); await mkdir(join(root, "governance/release-qualifications"), { recursive: true }); await writeFile(join(root, path), JSON.stringify(record, null, 2)); await commit(root, "record tail");
  return { root, record, path };
}
test("accepts the non-authorizing v2 bootstrap record offline and rejects it for prepublish", () => {
  const record = source();
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
test("Controller qualification fixture selection advances by version and rejects missing or ambiguous records", () => {
  const records = ["0.8.19", "0.8.20", "0.8.22"].map((version) => ({ version }));
  assert.equal(selectControllerQualificationRecord(records, "0.8.21").version, "0.8.20");
  assert.equal(selectControllerQualificationRecord(records, "0.8.22").version, "0.8.22");
  assert.throws(() => selectControllerQualificationRecord([], "0.8.21"), /missing/);
  assert.throws(() => selectControllerQualificationRecord([{ version: "0.8.20" }, { version: "0.8.20" }], "0.8.21"), /ambiguous/);
});
test("historical qualification joins use one immutable introduction and reject missing, ambiguous, or tampered history", async (t) => {
  const fixture = await syntheticPrepublication(); t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const introduction = qualificationIntroductionCommit(fixture.root, fixture.record.candidate);
  assert.equal(introduction, (await execFile("git", ["rev-parse", "HEAD"], { cwd: fixture.root })).stdout.trim());
  const expected = { name: fixture.record.candidate.name, version: fixture.record.candidate.version, ...currentQualificationJoins(fixture.root, fixture.record.candidate, introduction) };
  const tampered = structuredClone(fixture.record); tampered.candidate.packageManifestSha256 = "0".repeat(64);
  assert.ok(rules(tampered, { expected }).includes("content-join"));
  const missing = structuredClone(fixture.record.candidate); missing.version = "9.9.9";
  assert.throws(() => qualificationIntroductionCommit(fixture.root, missing), /one introduction commit/);
  await rm(join(fixture.root, fixture.path)); await commit(fixture.root, "remove record");
  await writeFile(join(fixture.root, fixture.path), JSON.stringify(fixture.record, null, 2)); await commit(fixture.root, "reintroduce record");
  assert.throws(() => qualificationIntroductionCommit(fixture.root, fixture.record.candidate), /one introduction commit/);
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
  const record = source();
  const expected = { name: record.candidate.name, version: record.candidate.version, ...currentQualificationJoins(process.cwd(), record.candidate, recordCommit(record)) };
  const syntheticSquashCommit = "f".repeat(40);
  assert.notEqual(syntheticSquashCommit, record.publishedCommit);
  assert.deepEqual(rules(record, { mode: "prepublish", expected, freshTranscript: record.transcript }).filter((rule) => rule !== "bootstrap-timing"), []);
});
