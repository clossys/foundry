import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { currentQualificationJoins, parseStrictJson, qualificationIntroductionCommit, qualificationPath, qualificationRecordHistory, validateCandidateQualification, validatePrepublicationPrTail } from "./candidate-qualification.mjs";

const CONTROLLER_RECORD_DIRECTORY = "governance/release-qualifications";
const CONTROLLER_NAME = Buffer.from("QHZlc3BlbmV2ZW50dXJlcy9jb250cm9sbGVy", "base64").toString("utf8");
const POST_PUBLICATION = "post-publication-bootstrap";

function releaseVersion(value) {
  const parts = String(value).split(".");
  if (parts.length !== 3 || parts.some((part) => !/^(?:0|[1-9][0-9]*)$/.test(part))) return null;
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
  for (const entry of entries) {
    if (!releaseVersion(entry.version)) throw new Error("Controller qualification record version must be a canonical exact release version");
  }
  const eligible = entries.filter((entry) => {
    const version = releaseVersion(entry.version);
    return compareReleaseVersions(version, current) <= 0;
  }).sort((left, right) => compareReleaseVersions(releaseVersion(right.version), releaseVersion(left.version)));
  if (eligible.length === 0) throw new Error("Controller qualification record is missing");
  if (eligible[1]?.version === eligible[0].version) throw new Error("Controller qualification record is ambiguous");
  return eligible[0];
}

export function selectControllerPostPublicationRecord(entries, manifestVersion) {
  return selectControllerQualificationRecord(entries.filter((entry) => entry.record?.timing === POST_PUBLICATION), manifestVersion);
}

function controllerQualificationRecords() {
  return readdirSync(CONTROLLER_RECORD_DIRECTORY).filter((file) => file.startsWith("controller-") && file.endsWith(".json")).map((file) => {
    const record = parseStrictJson(readFileSync(`${CONTROLLER_RECORD_DIRECTORY}/${file}`, "utf8"));
    if (record?.candidate?.name !== CONTROLLER_NAME || file !== `controller-${record?.candidate?.version}.json`) throw new Error("Controller qualification record identity does not match its path");
    return { file, version: record.candidate.version, record };
  });
}

function controllerQualificationRecord(selector = selectControllerQualificationRecord) {
  const manifest = parseStrictJson(readFileSync("packages/controller/package.json", "utf8"));
  return selector(controllerQualificationRecords(), manifest.version).record;
}

const source = () => structuredClone(controllerQualificationRecord());
const bootstrapSource = () => structuredClone(controllerQualificationRecord(selectControllerPostPublicationRecord));
const historicalControllerRecordPath = (record) => `${CONTROLLER_RECORD_DIRECTORY}/controller-${record.candidate.version}.json`;
function asPrepublication(record) {
  if (record.timing === "pre-publication") return record;
  record.timing = "pre-publication"; record.reviewedCommit = record.publishedCommit; record.rootPackageJsonSha256 = "a".repeat(64); record.rootPackageLockSha256 = "b".repeat(64); record.candidateReview = { headSha: record.reviewedCommit, reference: "test" };
  delete record.publishedCommit; delete record.registry;
  return record;
}
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
  if (Object.hasOwn(record, "rootPackageJsonSha256")) record.rootPackageJsonSha256 = joins.rootPackageJsonSha256;
  if (Object.hasOwn(record, "rootPackageLockSha256")) record.rootPackageLockSha256 = joins.rootPackageLockSha256;
  const transcript = { ...record.transcript };
  delete transcript.canonicalSha256;
  record.transcript.canonicalSha256 = createHash("sha256").update(JSON.stringify(transcript)).digest("hex");
};
const rules = (value, options) => validateCandidateQualification(value, options).map((item) => item.rule);
const execFile = promisify(execFileCallback);
async function git(root, args) { return execFile("git", args, { cwd: root }); }
async function commit(root, message) { await git(root, ["add", "."]); await git(root, ["commit", "-m", message]); return (await execFile("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(); }
function refreshTranscriptDigest(record) {
  const transcript = structuredClone(record.transcript); delete transcript.canonicalSha256;
  record.transcript.canonicalSha256 = createHash("sha256").update(JSON.stringify(transcript)).digest("hex");
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function rawStarterV2Record() {
  const record = source();
  const instant = "2026-08-29T12:00:00.000Z";
  record.candidate.name = "@clossys/starter";
  record.transcript.schema = "foundry-candidate-qualification-transcript-v2";
  record.transcript.version = 2;
  record.transcript.candidate.name = "@clossys/starter";
  record.transcript.fixtureMaterializedAt = instant;
  let index = 0;
  for (const observation of record.transcript.observations) {
    if (observation.kind !== "case") continue;
    const bytes = `${JSON.stringify({ fixtureMaterializedAt: instant, case: index })}\n`;
    const stdout = `${JSON.stringify({ state: observation.observedExitCode, fixtureMaterializedAt: instant })}\n`;
    observation.stdoutSha256 = sha256(stdout);
    observation.stderrSha256 = sha256("");
    observation.rawCaseEvidence = {
      argv: ["$NODE", "$TEMP/node_modules/@clossys/starter/dist/cli.js", "decide", `$TEMP/fixtures/case-${index}.json`],
      materializedInputs: [{ path: `$TEMP/fixtures/case-${index}.json`, sha256: sha256(bytes), bytes }],
      exitCode: observation.observedExitCode,
      stdout,
      stderr: "",
    };
    index += 1;
  }
  refreshTranscriptDigest(record);
  return record;
}
function retimeRawTranscript(transcript, next) {
  const prior = transcript.fixtureMaterializedAt;
  const changed = JSON.parse(JSON.stringify(transcript).split(prior).join(next));
  for (const observation of changed.observations.filter((item) => item.kind === "case")) {
    for (const input of observation.rawCaseEvidence.materializedInputs) input.sha256 = sha256(input.bytes);
    observation.stdoutSha256 = sha256(observation.rawCaseEvidence.stdout);
    observation.stderrSha256 = sha256(observation.rawCaseEvidence.stderr);
  }
  delete changed.canonicalSha256;
  changed.canonicalSha256 = sha256(JSON.stringify(changed));
  return changed;
}
async function syntheticRetainedRecord() {
  const root = await mkdtemp(join(tmpdir(), "qualification-history-"));
  await git(root, ["init"]); await git(root, ["config", "user.email", "test@example.invalid"]); await git(root, ["config", "user.name", "Qualification Test"]);
  await mkdir(join(root, CONTROLLER_RECORD_DIRECTORY), { recursive: true });
  await writeFile(join(root, "governance/release-qualification-policy.json"), readFileSync("governance/release-qualification-policy.json"));
  const record = bootstrapSource(); const path = historicalControllerRecordPath(record);
  await writeFile(join(root, path), JSON.stringify(record, null, 2)); await commit(root, "introduce retained record");
  return { root, record, path };
}
async function syntheticIndependentRecordIntroductions() {
  const root = await mkdtemp(join(tmpdir(), "qualification-merge-history-"));
  await git(root, ["init"]); await git(root, ["config", "user.email", "test@example.invalid"]); await git(root, ["config", "user.name", "Qualification Test"]);
  await mkdir(join(root, CONTROLLER_RECORD_DIRECTORY), { recursive: true });
  await writeFile(join(root, "governance/release-qualification-policy.json"), readFileSync("governance/release-qualification-policy.json"));
  const record = bootstrapSource(); const path = historicalControllerRecordPath(record);
  const base = await commit(root, "base policy");
  await git(root, ["checkout", "-b", "left", base]);
  await mkdir(join(root, CONTROLLER_RECORD_DIRECTORY), { recursive: true });
  await writeFile(join(root, path), JSON.stringify(record, null, 2)); const left = await commit(root, "left introduction");
  await git(root, ["checkout", "-b", "right", base]);
  await mkdir(join(root, CONTROLLER_RECORD_DIRECTORY), { recursive: true });
  await writeFile(join(root, path), JSON.stringify(record, null, 2)); const right = await commit(root, "right introduction");
  const tree = (await git(root, ["rev-parse", `${left}^{tree}`])).stdout.trim();
  assert.equal(tree, (await git(root, ["rev-parse", `${right}^{tree}`])).stdout.trim());
  const merge = async (first, second) => (await git(root, ["commit-tree", tree, "-m", "merge independent introductions", "-p", first, "-p", second])).stdout.trim();
  return { root, record, heads: [await merge(left, right), await merge(right, left)] };
}
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
  const record = bootstrapSource();
  assert.deepEqual(rules(record), []);
  assert.ok(rules(record, { mode: "prepublish" }).includes("bootstrap-timing"));
});
test("accepts immutable v1 history and closed v2 Starter raw 0/1/2 evidence", () => {
  assert.deepEqual(rules(source()), []);
  const record = rawStarterV2Record();
  assert.deepEqual(rules(record), []);
  assert.deepEqual([...new Set(record.transcript.observations.filter((item) => item.kind === "case").map((item) => item.rawCaseEvidence.exitCode))].sort(), [0, 1, 2]);
});
test("v2 raw evidence fails closed on missing, extra, leaking, malformed, or hash-mismatched evidence", () => {
  const mutations = [
    (record) => { delete record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence; },
    (record) => { record.transcript.observations.find((item) => item.kind === "help").rawCaseEvidence = {}; },
    (record) => { const item = record.transcript.observations.find((value) => value.kind === "case"); item.rawCaseEvidence.stdout = "/tmp/foundry-candidate-secret/output\n"; item.stdoutSha256 = sha256(item.rawCaseEvidence.stdout); },
    (record) => { record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.materializedInputs[0].sha256 = "0".repeat(64); },
    (record) => { record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.argv.push("--extra", "argument"); },
    (record) => { const item = record.transcript.observations.find((value) => value.kind === "case"); item.rawCaseEvidence.stdout = "x".repeat(65_537); item.stdoutSha256 = sha256(item.rawCaseEvidence.stdout); },
    (record) => { record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.materializedInputs[0].path = "$TEMP/fixtures/unreferenced.json"; },
    (record) => { record.transcript.observations = record.transcript.observations.filter((item) => !(item.kind === "case" && item.observedExitCode === 2)); },
    (record) => { record.transcript.fixtureMaterializedAt = "2026-08-29T12:00:00Z"; },
  ];
  for (const mutate of mutations) {
    const record = rawStarterV2Record(); mutate(record); refreshTranscriptDigest(record);
    assert.ok(rules(record).some((rule) => rule.startsWith("raw-case") || rule === "observations" || rule === "unknown-field"));
  }
  const unrelated = rawStarterV2Record();
  unrelated.candidate.name = "@clossys/controller"; unrelated.transcript.candidate.name = "@clossys/controller"; delete unrelated.transcript.fixtureMaterializedAt; refreshTranscriptDigest(unrelated);
  assert.ok(rules(unrelated).includes("raw-case-scope"));
});
test("fresh v2 replay validates both transcripts and normalizes only the exact fixture instant", () => {
  const record = rawStarterV2Record();
  const fresh = retimeRawTranscript(record.transcript, "2026-08-29T12:01:00.000Z");
  assert.equal(rules(record, { freshTranscript: fresh }).some((rule) => rule.startsWith("fresh-transcript")), false);

  const changed = structuredClone(fresh);
  const input = changed.observations.find((item) => item.kind === "case").rawCaseEvidence.materializedInputs[0];
  input.bytes = input.bytes.replace('"case":0', '"case":9'); input.sha256 = sha256(input.bytes);
  delete changed.canonicalSha256; changed.canonicalSha256 = sha256(JSON.stringify(changed));
  assert.ok(rules(record, { freshTranscript: changed }).includes("fresh-transcript"));

  const invalid = structuredClone(fresh);
  invalid.observations.find((item) => item.kind === "case").rawCaseEvidence.materializedInputs[0].sha256 = "0".repeat(64);
  delete invalid.canonicalSha256; invalid.canonicalSha256 = sha256(JSON.stringify(invalid));
  assert.ok(rules(record, { freshTranscript: invalid }).includes("fresh-transcript-raw-case-input"));
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
  const record = asPrepublication(source());
  record.candidateReview.headSha = "c".repeat(40);
  assert.ok(rules(record, { mode: "prepublish" }).includes("candidate-review"));
});
test("prepublication validation fails closed without complete current joins and a fresh transcript", () => {
  const record = asPrepublication(source());
  assert.ok(rules(record, { mode: "prepublish" }).includes("prepublish-evidence"));
});
test("strict JSON parsing rejects duplicate object keys", () => {
  assert.throws(() => parseStrictJson('{"schemaVersion":2,"schemaVersion":2}'), /duplicate JSON key/);
  assert.throws(() => parseStrictJson('{"candidate":{"name":"a","name":"b"}}'), /duplicate JSON key/);
});
test("Controller record selection separates the current candidate from retained post-publication bootstrap evidence", () => {
  const post = (version) => ({ version, record: { timing: POST_PUBLICATION } });
  const pre = (version) => ({ version, record: { timing: "pre-publication" } });
  const records = [post("0.8.19"), post("0.8.20"), pre("0.8.21"), pre("0.8.22")];
  for (const orderedRecords of [records, records.toReversed()]) {
    assert.equal(selectControllerQualificationRecord(orderedRecords, "0.8.21").version, "0.8.21");
    assert.equal(selectControllerQualificationRecord(orderedRecords, "0.8.22").version, "0.8.22");
    assert.equal(selectControllerPostPublicationRecord(orderedRecords, "0.8.21").version, "0.8.20");
  }
  assert.throws(() => selectControllerQualificationRecord([], "0.8.21"), /missing/);
  assert.throws(() => selectControllerQualificationRecord([pre("0.8.20"), pre("0.8.20")], "0.8.21"), /ambiguous/);
  assert.throws(() => selectControllerPostPublicationRecord([pre("0.8.21")], "0.8.21"), /missing/);
  assert.throws(() => selectControllerPostPublicationRecord([post("0.8.20"), post("0.8.20")], "0.8.21"), /ambiguous/);
  for (const aliasedRecords of [[pre("0.8.020"), pre("0.8.20")], [pre("0.8.20"), pre("0.8.020")]]) {
    assert.throws(() => selectControllerQualificationRecord(aliasedRecords, "0.8.21"), /canonical exact release version/);
  }
  assert.throws(() => selectControllerPostPublicationRecord([post("0.08.20"), post("0.8.20")], "0.8.21"), /canonical exact release version/);
});
test("historical qualification joins use one immutable introduction and reject missing, ambiguous, or tampered history", async (t) => {
  const fixture = await syntheticPrepublication(); t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const introduction = qualificationIntroductionCommit(fixture.root, fixture.record.candidate, "HEAD", fixture.path);
  assert.equal(introduction, (await execFile("git", ["rev-parse", "HEAD"], { cwd: fixture.root })).stdout.trim());
  const expected = { name: fixture.record.candidate.name, version: fixture.record.candidate.version, ...currentQualificationJoins(fixture.root, fixture.record.candidate, introduction) };
  const tampered = structuredClone(fixture.record); tampered.candidate.packageManifestSha256 = "0".repeat(64);
  assert.ok(rules(tampered, { expected }).includes("content-join"));
  const missing = structuredClone(fixture.record.candidate); missing.version = "9.9.9";
  assert.throws(() => qualificationIntroductionCommit(fixture.root, missing, "HEAD", historicalControllerRecordPath({ candidate: missing })), /one introduction commit/);
  await rm(join(fixture.root, fixture.path)); await commit(fixture.root, "remove record");
  await writeFile(join(fixture.root, fixture.path), JSON.stringify(fixture.record, null, 2)); await commit(fixture.root, "reintroduce record");
  assert.throws(() => qualificationIntroductionCommit(fixture.root, fixture.record.candidate, "HEAD", fixture.path), /one introduction commit/);
});
test("full-history traversal rejects independent merge-parent introductions in either parent order", async (t) => {
  const fixture = await syntheticIndependentRecordIntroductions(); t.after(() => rm(fixture.root, { recursive: true, force: true }));
  for (const head of fixture.heads) {
    assert.throws(() => qualificationIntroductionCommit(fixture.root, fixture.record.candidate, head, historicalControllerRecordPath(fixture.record)), /one introduction commit/);
  }
});
test("the history seal rejects coherent tarball, transcript, and registry rewrites", async (t) => {
  const fixture = await syntheticRetainedRecord(); t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const initial = qualificationRecordHistory(fixture.root, fixture.path, fixture.record.candidate, "HEAD", fixture.path);
  assert.equal(initial.retainedRecordSha256, initial.introducedRecordSha256);
  const mutations = [
    (record) => {
      const value = "0".repeat(64);
      record.candidate.tarball.sha256 = value; record.transcript.tarball.sha256 = value; record.registry.sha256 = value;
      refreshTranscriptDigest(record);
    },
    (record) => {
      record.transcript.observations[0].stdoutSha256 = "1".repeat(64);
      refreshTranscriptDigest(record);
    },
    (record) => { record.registry.reference = "tampered-registry-reference"; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(fixture.record); mutate(changed);
    assert.deepEqual(rules(changed), [], "the tampering control must remain internally coherent");
    await writeFile(join(fixture.root, fixture.path), JSON.stringify(changed, null, 2));
    const history = qualificationRecordHistory(fixture.root, fixture.path, changed.candidate, "HEAD", fixture.path);
    assert.notEqual(history.retainedRecordSha256, history.introducedRecordSha256);
  }
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
