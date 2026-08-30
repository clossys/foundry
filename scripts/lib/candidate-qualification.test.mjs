import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { currentQualificationJoins, parseStrictJson, qualificationIntroductionCommit, qualificationPath, qualificationRecordHistory, validateCandidateQualification, validatePrepublicationPrTail, validateTrioControlTailAuthorization, validateTrioPublicationClosure } from "./candidate-qualification.mjs";
import { TRIO_PUBLICATION_PATH, TRIO_PUBLICATION_TRANSITION_BASE, TRIO_PUBLICATION_TRANSITION_PATHS } from "./release-publication-cohort.mjs";
import { TRIO, TRIO_COHORT_PATH, TRIO_CONTROL_TAIL_AUTHORIZATION_PATH, TRIO_CONTROL_TAIL_BASE_COMMIT, TRIO_CONTROL_TAIL_PATHS, TRIO_QUARANTINE_PATH, TRIO_RELEASE } from "./release-qualification-trio.mjs";

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
const hostilePosixPath = (...segments) => ["", ...segments].join("/");
const hostileWindowsPath = (...segments) => segments.join("\\");
const rawStarterOverlay = () => [
  ["$TEMP/fixtures/overlay/advisor-cli.js", "$TEMP/node_modules/@clossys/advisor/dist/execution-readiness-cli.js", "#!$ENV node\nprocess.exit(2);\n"],
  ["$TEMP/fixtures/overlay/advisor-package.json", "$TEMP/node_modules/@clossys/advisor/package.json", '{"name":"@clossys/advisor","version":"1.0.0"}\n'],
  ["$TEMP/fixtures/overlay/package-lock.json", "$TEMP/package-lock.json", '{"lockfileVersion":3,"packages":{}}\n'],
  ["$TEMP/fixtures/overlay/package.json", "$TEMP/package.json", '{"private":true}\n'],
  ["$TEMP/fixtures/overlay/target-cli.js", "$TEMP/node_modules/@fixture/qualification-target/dist/check.js", "#!$ENV node\nprocess.exit(0);\n"],
  ["$TEMP/fixtures/overlay/target-package.json", "$TEMP/node_modules/@fixture/qualification-target/package.json", '{"name":"@fixture/qualification-target","version":"1.0.0"}\n'],
].map(([sourcePath, targetPath, bytes]) => ({ sourcePath, targetPath, sha256: sha256(bytes), bytes }));
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
      consumerOverlay: rawStarterOverlay(),
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
    for (const input of observation.rawCaseEvidence.consumerOverlay) input.sha256 = sha256(input.bytes);
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
async function syntheticTrioPrepublication() {
  const root = await mkdtemp(join(tmpdir(), "qualification-trio-tail-"));
  await git(root, ["init"]); await git(root, ["config", "user.email", "test@example.invalid"]); await git(root, ["config", "user.name", "Qualification Test"]);
  await cp("package.json", join(root, "package.json")); await cp("package-lock.json", join(root, "package-lock.json"));
  await mkdir(join(root, "governance"), { recursive: true });
  await cp("governance/release-qualification-policy.json", join(root, "governance/release-qualification-policy.json"));
  for (const key of TRIO) {
    await mkdir(join(root, "packages"), { recursive: true });
    await cp(`packages/${key}`, join(root, `packages/${key}`), { recursive: true });
    await mkdir(join(root, "governance/release-qualification-adapters"), { recursive: true });
    await cp(`governance/release-qualification-adapters/${key}`, join(root, `governance/release-qualification-adapters/${key}`), { recursive: true });
    await mkdir(join(root, "governance/release-qualification-fixtures"), { recursive: true });
    await cp(`governance/release-qualification-fixtures/${key}`, join(root, `governance/release-qualification-fixtures/${key}`), { recursive: true });
  }
  const reviewedCommit = await commit(root, "Trio candidates");
  const records = [];
  await mkdir(join(root, "governance/release-qualifications"), { recursive: true });
  for (const key of TRIO) {
    const manifest = parseStrictJson(readFileSync(join(root, `packages/${key}/package.json`), "utf8"));
    const candidate = { name: `@clossys/${key}`, version: manifest.version };
    const joins = currentQualificationJoins(root, candidate, reviewedCommit);
    const record = {
      timing: "pre-publication",
      reviewedCommit,
      rootPackageJsonSha256: joins.rootPackageJsonSha256,
      rootPackageLockSha256: joins.rootPackageLockSha256,
      candidate: {
        ...candidate,
        packageTreeSha1: joins.packageTreeSha1,
        packageManifestSha256: joins.packageManifestSha256,
        policySha256: joins.policySha256,
        adapterSha256: joins.adapterSha256,
        fixtureSetSha256: joins.fixtureSetSha256,
      },
      archetypes: joins.archetypes,
      transcript: { dimensions: joins.dimensions },
      candidateReview: { headSha: reviewedCommit, reference: "fixture review" },
    };
    records.push(record);
    await writeFile(join(root, qualificationPath(root, candidate, reviewedCommit)), JSON.stringify(record, null, 2));
  }
  const cohort = { id: "clossys-npmjs-trio" };
  const cohortBytes = `${JSON.stringify(cohort, null, 2)}\n`;
  await mkdir(join(root, "governance/release-qualification-cohorts"), { recursive: true });
  await writeFile(join(root, TRIO_COHORT_PATH), cohortBytes);
  await commit(root, "retain Trio qualification tail");
  return { root, records, cohort, cohortBytes };
}
function partialFailureQuarantine(cohortBytes, completedPackages) {
  return {
    schemaVersion: 1,
    kind: "clossys-npmjs-trio-partial-failure-v1",
    cohortPath: TRIO_COHORT_PATH,
    cohortSha256: sha256(cohortBytes),
    release: structuredClone(TRIO_RELEASE),
    completedPackages,
    failedPackage: TRIO[completedPackages.length],
    disposition: "quarantined",
    reference: "fixture incident record",
  };
}
async function appendPartialFailureQuarantine(fixture, completedPackages) {
  const quarantine = partialFailureQuarantine(fixture.cohortBytes, completedPackages);
  await mkdir(join(fixture.root, "governance/release-qualification-quarantines"), { recursive: true });
  await writeFile(join(fixture.root, TRIO_QUARANTINE_PATH), `${JSON.stringify(quarantine, null, 2)}\n`);
  await commit(fixture.root, "retain partial failure quarantine");
  return quarantine;
}
function retainedTrioControlTail(root = process.cwd()) {
  const cohortBytes = readFileSync(join(root, TRIO_COHORT_PATH), "utf8");
  const authorization = parseStrictJson(readFileSync(join(root, TRIO_CONTROL_TAIL_AUTHORIZATION_PATH), "utf8"));
  const records = TRIO.map((key, index) => {
    const path = authorization?.records?.[index]?.path;
    assert.equal(typeof path, "string", `sealed ${key} qualification path is required`);
    const record = parseStrictJson(readFileSync(join(root, path), "utf8"));
    assert.equal(path, `governance/release-qualifications/clossys-${key}-${record?.candidate?.version}.json`, `sealed ${key} qualification path is required`);
    return record;
  });
  return {
    root,
    records,
    cohort: parseStrictJson(cohortBytes),
    cohortBytes,
    authorization,
  };
}
async function cloneRetainedTrioControlTail() {
  const parent = await mkdtemp(join(tmpdir(), "qualification-control-tail-"));
  const root = join(parent, "repo");
  await execFile("git", ["clone", "--local", "--no-hardlinks", process.cwd(), root]);
  await git(root, ["checkout", "--detach", TRIO_PUBLICATION_TRANSITION_BASE]);
  await git(root, ["config", "user.email", "test@example.invalid"]);
  await git(root, ["config", "user.name", "Qualification Test"]);
  return { parent, ...retainedTrioControlTail(root) };
}
async function clonePendingPublicationTransition({ commitTransition = true } = {}) {
  const parent = await mkdtemp(join(tmpdir(), "qualification-publication-transition-"));
  const root = join(parent, "repo");
  await execFile("git", ["clone", "--local", "--no-hardlinks", process.cwd(), root]);
  await git(root, ["checkout", "--detach", TRIO_PUBLICATION_TRANSITION_BASE]);
  await git(root, ["config", "user.email", "test@example.invalid"]);
  await git(root, ["config", "user.name", "Qualification Test"]);
  assert.equal((await git(root, ["rev-parse", "HEAD"])).stdout.trim(), TRIO_PUBLICATION_TRANSITION_BASE);
  const transitionCommits = (await git(process.cwd(), ["log", "--full-history", "--diff-filter=A", "--format=%H", "HEAD", "--", TRIO_PUBLICATION_PATH])).stdout.trim().split("\n").filter(Boolean);
  assert.equal(transitionCommits.length, 1, "one retained publication transition is required");
  for (const path of TRIO_PUBLICATION_TRANSITION_PATHS) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    const bytes = (await git(process.cwd(), ["show", `${transitionCommits[0]}:${path}`])).stdout;
    await writeFile(join(root, path), bytes);
  }
  if (commitTransition) await commit(root, "retain exact publication transition");
  const retained = retainedTrioControlTail(root);
  return { parent, ...retained, publication: parseStrictJson(readFileSync(join(root, TRIO_PUBLICATION_PATH), "utf8")) };
}
async function writeRetainedPartialFailureQuarantine(fixture, completedPackages = ["advisor"]) {
  const quarantine = partialFailureQuarantine(fixture.cohortBytes, completedPackages);
  await mkdir(dirname(join(fixture.root, TRIO_QUARANTINE_PATH)), { recursive: true });
  await writeFile(join(fixture.root, TRIO_QUARANTINE_PATH), `${JSON.stringify(quarantine, null, 2)}\n`);
  await commit(fixture.root, "retain future partial failure quarantine");
  return quarantine;
}
async function appendForwardTrioQualifications(fixture, { interveningPath = null, introductionExtraPath = null, corruptJoin = false } = {}) {
  const versions = ["9.1.1", "9.1.2", "9.1.3"];
  for (const [index, key] of TRIO.entries()) {
    const manifestPath = join(fixture.root, `packages/${key}/package.json`);
    const manifest = parseStrictJson(readFileSync(manifestPath, "utf8"));
    manifest.version = versions[index];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const reviewedCommit = await commit(fixture.root, "review future Trio candidates");
  if (interveningPath) {
    await writeFile(join(fixture.root, interveningPath), "intervening\n");
    await commit(fixture.root, "intervene before qualification introduction");
  }

  const records = [];
  for (const [index, key] of TRIO.entries()) {
    const record = structuredClone(fixture.records[index]);
    record.candidate.version = versions[index];
    record.transcript.candidate.version = versions[index];
    record.reviewedCommit = reviewedCommit;
    record.candidateReview = { headSha: reviewedCommit, reference: "future candidate review" };
    bindCurrentJoins(record, currentQualificationJoins(fixture.root, record.candidate, reviewedCommit));
    if (corruptJoin && index === 0) record.candidate.packageManifestSha256 = "0".repeat(64);
    const path = qualificationPath(fixture.root, record.candidate, reviewedCommit);
    await writeFile(join(fixture.root, path), `${JSON.stringify(record, null, 2)}\n`);
    records.push(record);
  }
  if (introductionExtraPath) await writeFile(join(fixture.root, introductionExtraPath), "unrelated\n");
  const introductionCommit = await commit(fixture.root, "retain future Trio qualification records");
  return { records, reviewedCommit, introductionCommit };
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
    (record) => { const item = record.transcript.observations.find((value) => value.kind === "case"); item.rawCaseEvidence.stdout = `${hostilePosixPath("Users", "example", "private", "workspace", "result.json")}\n`; item.stdoutSha256 = sha256(item.rawCaseEvidence.stdout); },
    (record) => { record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.argv[1] = "$TEMP/node_modules/@clossys/starter/../../private/evil.js"; },
    (record) => { record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.argv[3] = "$TEMP/fixtures/../event.json"; },
    (record) => { const raw = record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence; raw.argv[3] = "$TEMP/fixtures/../event.json"; raw.materializedInputs[0].path = "$TEMP/fixtures/../event.json"; },
    (record) => { record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.materializedInputs[0].sha256 = "0".repeat(64); },
    (record) => { const input = record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.materializedInputs[0]; input.bytes = `${JSON.stringify({ path: hostileWindowsPath("C:", "Users", "example", "private.json") })}\n`; input.sha256 = sha256(input.bytes); },
    (record) => { record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.argv.push("--extra", "argument"); },
    (record) => { const item = record.transcript.observations.find((value) => value.kind === "case"); item.rawCaseEvidence.stdout = "x".repeat(65_537); item.stdoutSha256 = sha256(item.rawCaseEvidence.stdout); },
    (record) => { record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.materializedInputs[0].path = "$TEMP/fixtures/unreferenced.json"; },
    (record) => { record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.consumerOverlay.pop(); },
    (record) => { record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.consumerOverlay.reverse(); },
    (record) => { record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.consumerOverlay[0].targetPath = "$TEMP/node_modules/@clossys/advisor/../private.js"; },
    (record) => { record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.consumerOverlay[0].sha256 = "0".repeat(64); },
    (record) => { const input = record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.consumerOverlay[0]; input.bytes = `load ${hostilePosixPath("Users", "example", "private", "advisor.js")}\n`; input.sha256 = sha256(input.bytes); },
    (record) => { record.transcript.observations.find((item) => item.kind === "case").rawCaseEvidence.consumerOverlay[0].extra = true; },
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
test("Trio prepublication tail admits only a closed exact partial-failure quarantine", async (t) => {
  for (let completed = 0; completed < TRIO.length; completed += 1) {
    const fixture = await syntheticTrioPrepublication(); t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const quarantine = await appendPartialFailureQuarantine(fixture, TRIO.slice(0, completed));
    for (const record of fixture.records) {
      assert.deepEqual(validatePrepublicationPrTail(record, { root: fixture.root, trioRecords: fixture.records, cohort: fixture.cohort, cohortBytes: fixture.cohortBytes, quarantine }), []);
    }
  }
});
test("Trio quarantine tail rejects malformed, reordered, next-member, cohort-drift, missing-path, and unrelated changes", async (t) => {
  const fixture = await syntheticTrioPrepublication(); t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const quarantine = await appendPartialFailureQuarantine(fixture, ["advisor"]);
  const findings = (candidate = quarantine, cohortBytes = fixture.cohortBytes) => validatePrepublicationPrTail(fixture.records[0], { root: fixture.root, trioRecords: fixture.records, cohort: fixture.cohort, cohortBytes, quarantine: candidate }).map((item) => item.rule);
  for (const mutate of [
    (copy) => { copy.schemaVersion = 2; },
    (copy) => { copy.completedPackages = ["starter"]; },
    (copy) => { copy.failedPackage = "controller"; },
  ]) {
    const copy = structuredClone(quarantine); mutate(copy);
    assert.ok(findings(copy).includes("trio-quarantine"));
  }
  assert.ok(findings(quarantine, `${fixture.cohortBytes} `).includes("trio-quarantine"));
  assert.ok(validatePrepublicationPrTail(fixture.records[0], { root: fixture.root, trioRecords: fixture.records, cohort: fixture.cohort, cohortBytes: fixture.cohortBytes, quarantine: null }).some((item) => item.rule === "pr-tail"));
  await writeFile(join(fixture.root, "unrelated.txt"), "unrelated\n"); await commit(fixture.root, "unrelated fifth path");
  assert.ok(findings().includes("pr-tail"));
});
test("the one-time Trio control-tail authorization is exact, atomic, and cohort-bound", async (t) => {
  const fixture = retainedTrioControlTail();
  assert.equal(fixture.authorization.baseCommit, TRIO_CONTROL_TAIL_BASE_COMMIT);
  assert.deepEqual(fixture.authorization.authorizedFiles.map((item) => item.path), TRIO_CONTROL_TAIL_PATHS);
  assert.deepEqual(validateTrioControlTailAuthorization(fixture.authorization, { root: fixture.root, head: TRIO_PUBLICATION_TRANSITION_BASE, retainedRef: TRIO_PUBLICATION_TRANSITION_BASE, trioRecords: fixture.records, cohortBytes: fixture.cohortBytes }), []);
  const retained = await cloneRetainedTrioControlTail();
  t.after(() => rm(retained.parent, { recursive: true, force: true }));
  for (const record of retained.records) {
    assert.deepEqual(validatePrepublicationPrTail(record, {
      root: retained.root,
      head: TRIO_PUBLICATION_TRANSITION_BASE,
      trioRecords: retained.records,
      cohort: retained.cohort,
      cohortBytes: retained.cohortBytes,
      controlTailAuthorization: retained.authorization,
    }), []);
  }
});
test("the publication transition closes the sealed tail once and permits ordinary later evolution", async (t) => {
  const fixture = await clonePendingPublicationTransition({ commitTransition: false });
  t.after(() => rm(fixture.parent, { recursive: true, force: true }));
  const context = () => ({ root: fixture.root, trioRecords: fixture.records, cohortBytes: fixture.cohortBytes, controlTailAuthorization: fixture.authorization });
  assert.deepEqual(validateTrioPublicationClosure(fixture.publication, context()), []);

  await commit(fixture.root, "retain exact publication transition");
  assert.deepEqual(validateTrioPublicationClosure(fixture.publication, context()), []);
  for (const record of fixture.records) assert.deepEqual(validatePrepublicationPrTail(record, { root: fixture.root, publication: fixture.publication, publicationClosureValid: true }), []);

  await writeFile(join(fixture.root, "ordinary-later-change.txt"), "ordinary\n");
  await commit(fixture.root, "ordinary later evolution");
  assert.deepEqual(validateTrioPublicationClosure(fixture.publication, context()), []);

  const publicationPath = join(fixture.root, TRIO_PUBLICATION_PATH);
  const retainedPublication = readFileSync(publicationPath);
  await writeFile(publicationPath, `${retainedPublication.toString("utf8")}\n`); await commit(fixture.root, "rewrite publication record");
  await writeFile(publicationPath, retainedPublication); await commit(fixture.root, "restore publication record");
  assert.ok(validateTrioPublicationClosure(fixture.publication, context()).some((item) => item.rule === "publication-transition-record-history"));
});

test("sealed first-Trio selection remains exact when later qualification versions exist", async (t) => {
  const fixture = await clonePendingPublicationTransition();
  t.after(() => rm(fixture.parent, { recursive: true, force: true }));
  const originalDigests = fixture.authorization.records.map((entry) => sha256(readFileSync(join(fixture.root, entry.path))));

  for (const [index, key] of TRIO.entries()) {
    const record = structuredClone(fixture.records[index]);
    const version = `9.9.${index + 1}`;
    record.candidate.version = version;
    record.transcript.candidate.version = version;
    refreshTranscriptDigest(record);
    await writeFile(join(fixture.root, CONTROLLER_RECORD_DIRECTORY, `clossys-${key}-${version}.json`), `${JSON.stringify(record, null, 2)}\n`);
  }
  await commit(fixture.root, "retain later exact-version qualification records");

  const retained = retainedTrioControlTail(fixture.root);
  assert.deepEqual(retained.records.map((record) => record.candidate.version), ["0.1.3", "0.1.2", "0.8.21"]);
  assert.deepEqual(retained.authorization.records.map((entry) => sha256(readFileSync(join(fixture.root, entry.path)))), originalDigests);
  assert.deepEqual(validateTrioPublicationClosure(fixture.publication, {
    root: fixture.root,
    trioRecords: retained.records,
    cohortBytes: retained.cohortBytes,
    controlTailAuthorization: retained.authorization,
  }), []);
});

test("post-closure qualifications enter together in one record-only child of their reviewed commit", async (t) => {
  const fixture = await clonePendingPublicationTransition();
  t.after(() => rm(fixture.parent, { recursive: true, force: true }));
  const forward = await appendForwardTrioQualifications(fixture);
  const allRecords = [...fixture.records, ...forward.records];

  for (const record of fixture.records) assert.deepEqual(validatePrepublicationPrTail(record, {
    root: fixture.root,
    trioRecords: allRecords,
    publication: fixture.publication,
    publicationClosureValid: true,
  }), []);
  for (const record of forward.records) assert.deepEqual(validatePrepublicationPrTail(record, {
    root: fixture.root,
    trioRecords: allRecords,
    publication: fixture.publication,
    publicationClosureValid: true,
  }), []);
});

test("post-closure qualification introduction rejects an intervening parent, an extra path, and reviewed-join drift", async (t) => {
  for (const [options, expectedRule] of [
    [{ interveningPath: "intervening.txt" }, "forward-record-parent"],
    [{ introductionExtraPath: "unrelated.txt" }, "forward-record-paths"],
    [{ corruptJoin: true }, "forward-record-join"],
  ]) {
    const fixture = await clonePendingPublicationTransition();
    t.after(() => rm(fixture.parent, { recursive: true, force: true }));
    const forward = await appendForwardTrioQualifications(fixture, options);
    const findings = validatePrepublicationPrTail(forward.records[0], {
      root: fixture.root,
      trioRecords: [...fixture.records, ...forward.records],
      publication: fixture.publication,
      publicationClosureValid: true,
    }).map((item) => item.rule);
    assert.ok(findings.includes(expectedRule), `expected ${expectedRule}`);
  }
});

test("post-closure qualification history rejects rewrite restoration and an incomplete joint record set", async (t) => {
  const fixture = await clonePendingPublicationTransition();
  t.after(() => rm(fixture.parent, { recursive: true, force: true }));
  const forward = await appendForwardTrioQualifications(fixture);
  const path = qualificationPath(fixture.root, forward.records[0].candidate, forward.reviewedCommit);
  const retained = readFileSync(join(fixture.root, path));
  await writeFile(join(fixture.root, path), `${retained.toString("utf8")}\n`);
  await commit(fixture.root, "touch future qualification record");
  await writeFile(join(fixture.root, path), retained);
  await commit(fixture.root, "restore future qualification record");

  const context = {
    root: fixture.root,
    publication: fixture.publication,
    publicationClosureValid: true,
  };
  const touched = validatePrepublicationPrTail(forward.records[0], {
    ...context,
    trioRecords: [...fixture.records, ...forward.records],
  }).map((item) => item.rule);
  assert.ok(touched.includes("forward-record-touches"));

  const incomplete = validatePrepublicationPrTail(forward.records[1], {
    ...context,
    trioRecords: [...fixture.records, ...forward.records.slice(0, 2)],
  }).map((item) => item.rule);
  assert.ok(incomplete.includes("forward-record-paths"));
});

test("publication closure rejects retained evidence rewrite and restoration", async (t) => {
  const fixture = await clonePendingPublicationTransition();
  t.after(() => rm(fixture.parent, { recursive: true, force: true }));
  const recordPath = qualificationPath(fixture.root, fixture.records[0].candidate, fixture.records[0].reviewedCommit);
  const absolute = join(fixture.root, recordPath);
  const retained = readFileSync(absolute);
  await writeFile(absolute, `${retained.toString("utf8")}\n`); await commit(fixture.root, "rewrite retained qualification");
  await writeFile(absolute, retained); await commit(fixture.root, "restore retained qualification");
  const findings = validateTrioPublicationClosure(fixture.publication, { root: fixture.root, trioRecords: fixture.records, cohortBytes: fixture.cohortBytes, controlTailAuthorization: fixture.authorization });
  assert.ok(findings.some((item) => item.rule === "publication-transition-evidence-history"));
});
test("the one-time Trio control-tail authorization rejects base, cohort, record, digest, path, order, and shape drift", () => {
  const fixture = retainedTrioControlTail();
  const findings = (mutate) => {
    const authorization = structuredClone(fixture.authorization);
    mutate(authorization);
    return validateTrioControlTailAuthorization(authorization, { root: fixture.root, trioRecords: fixture.records, cohortBytes: fixture.cohortBytes }).map((item) => item.rule);
  };
  for (const [rule, mutate] of [
    ["control-tail-authorization", (value) => { value.baseCommit = "a".repeat(40); }],
    ["control-tail-cohort", (value) => { value.cohort.sha256 = "a".repeat(64); }],
    ["control-tail-record-digest", (value) => { value.records[0].sha256 = "a".repeat(64); }],
    ["control-tail-records", (value) => { value.records.reverse(); }],
    ["control-tail-files", (value) => { value.authorizedFiles.pop(); }],
    ["control-tail-files", (value) => { value.authorizedFiles.push({ path: "unrelated.txt", sha256: "a".repeat(64) }); }],
    ["control-tail-files", (value) => { value.authorizedFiles.reverse(); }],
    ["control-tail-file-digest", (value) => { value.authorizedFiles[0].sha256 = "a".repeat(64); }],
    ["unknown-field", (value) => { value.unexpected = true; }],
  ]) assert.ok(findings(mutate).includes(rule), `expected ${rule}`);
});
test("the sealed Trio control tail rejects wrong introduction bytes, rewrite restoration, and unrelated touch restoration", async (t) => {
  {
    const fixture = await cloneRetainedTrioControlTail(); t.after(() => rm(fixture.parent, { recursive: true, force: true }));
    const retained = new Map([...TRIO_CONTROL_TAIL_PATHS, TRIO_CONTROL_TAIL_AUTHORIZATION_PATH].map((path) => [path, readFileSync(join(fixture.root, path))]));
    await git(fixture.root, ["checkout", "-b", "wrong-introduction", TRIO_CONTROL_TAIL_BASE_COMMIT]);
    for (const [path, bytes] of retained) { await mkdir(dirname(join(fixture.root, path)), { recursive: true }); await writeFile(join(fixture.root, path), bytes); }
    const checkerPath = TRIO_CONTROL_TAIL_PATHS.find((path) => path.endsWith("/candidate-qualification.mjs"));
    await writeFile(join(fixture.root, checkerPath), `${retained.get(checkerPath).toString("utf8")}\n// wrong introduction bytes\n`);
    await commit(fixture.root, "introduce wrong authorized bytes");
    await writeFile(join(fixture.root, checkerPath), retained.get(checkerPath));
    await commit(fixture.root, "correct authorized bytes");
    const corrected = retainedTrioControlTail(fixture.root);
    const findings = validateTrioControlTailAuthorization(corrected.authorization, { root: corrected.root, trioRecords: corrected.records, cohortBytes: corrected.cohortBytes }).map((item) => item.rule);
    assert.ok(findings.includes("control-tail-introduction-digest"));
    assert.ok(findings.includes("control-tail-file-history"));
  }
  {
    const fixture = await cloneRetainedTrioControlTail(); t.after(() => rm(fixture.parent, { recursive: true, force: true }));
    const authorizationPath = join(fixture.root, TRIO_CONTROL_TAIL_AUTHORIZATION_PATH);
    const retained = readFileSync(authorizationPath);
    const changed = structuredClone(fixture.authorization); changed.authorizedFiles[0].sha256 = "a".repeat(64);
    await writeFile(authorizationPath, `${JSON.stringify(changed, null, 2)}\n`);
    await commit(fixture.root, "rewrite authorization");
    await writeFile(authorizationPath, retained); await commit(fixture.root, "restore authorization bytes");
    assert.ok(validateTrioControlTailAuthorization(fixture.authorization, { root: fixture.root, trioRecords: fixture.records, cohortBytes: fixture.cohortBytes }).some((item) => item.rule === "control-tail-file-history"));
  }
  {
    const fixture = await cloneRetainedTrioControlTail(); t.after(() => rm(fixture.parent, { recursive: true, force: true }));
    const checkerPath = join(fixture.root, TRIO_CONTROL_TAIL_PATHS.find((path) => path.endsWith("candidate-qualification.mjs")));
    const retained = readFileSync(checkerPath);
    await writeFile(checkerPath, `${readFileSync(checkerPath, "utf8")}\n// later rewrite\n`);
    await commit(fixture.root, "rewrite authorized checker");
    await writeFile(checkerPath, retained); await commit(fixture.root, "restore authorized checker bytes");
    const authorizationFindings = validateTrioControlTailAuthorization(fixture.authorization, { root: fixture.root, trioRecords: fixture.records, cohortBytes: fixture.cohortBytes }).map((item) => item.rule);
    assert.ok(authorizationFindings.includes("control-tail-file-history"));
    const tailFindings = validatePrepublicationPrTail(fixture.records[0], { root: fixture.root, trioRecords: fixture.records, cohort: fixture.cohort, cohortBytes: fixture.cohortBytes, controlTailAuthorization: fixture.authorization }).map((item) => item.rule);
    assert.ok(tailFindings.includes("trio-control-tail"));
  }
  {
    const fixture = await cloneRetainedTrioControlTail(); t.after(() => rm(fixture.parent, { recursive: true, force: true }));
    const unrelated = join(fixture.root, "governance/release-qualification-tail-authorizations/unrelated.json");
    await writeFile(unrelated, "{}\n"); await commit(fixture.root, "unrelated tail");
    await rm(unrelated); await commit(fixture.root, "restore unrelated tail");
    assert.deepEqual(validateTrioControlTailAuthorization(fixture.authorization, { root: fixture.root, trioRecords: fixture.records, cohortBytes: fixture.cohortBytes }), []);
    assert.ok(validatePrepublicationPrTail(fixture.records[0], { root: fixture.root, trioRecords: fixture.records, cohort: fixture.cohort, cohortBytes: fixture.cohortBytes, controlTailAuthorization: fixture.authorization }).some((item) => item.rule === "pr-tail-history"));
  }
});
test("future Trio quarantine must descend from the exact sealed control authorization", async (t) => {
  {
    const fixture = await cloneRetainedTrioControlTail(); t.after(() => rm(fixture.parent, { recursive: true, force: true }));
    const quarantine = await writeRetainedPartialFailureQuarantine(fixture);
    for (const record of fixture.records) assert.deepEqual(validatePrepublicationPrTail(record, { root: fixture.root, trioRecords: fixture.records, cohort: fixture.cohort, cohortBytes: fixture.cohortBytes, quarantine, controlTailAuthorization: fixture.authorization }), []);
  }
  {
    const fixture = await cloneRetainedTrioControlTail(); t.after(() => rm(fixture.parent, { recursive: true, force: true }));
    const controlHead = (await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
    await git(fixture.root, ["checkout", "-b", "parallel-quarantine", TRIO_CONTROL_TAIL_BASE_COMMIT]);
    const quarantine = await writeRetainedPartialFailureQuarantine(fixture);
    const quarantineHead = (await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
    await git(fixture.root, ["checkout", "-b", "combined-tail", controlHead]);
    await git(fixture.root, ["merge", "--no-ff", quarantineHead, "-m", "merge parallel quarantine"]);
    const combined = retainedTrioControlTail(fixture.root);
    const findings = validatePrepublicationPrTail(combined.records[0], { root: combined.root, trioRecords: combined.records, cohort: combined.cohort, cohortBytes: combined.cohortBytes, quarantine, controlTailAuthorization: combined.authorization }).map((item) => item.rule);
    assert.ok(findings.includes("trio-quarantine-history"));
  }
  {
    const fixture = await cloneRetainedTrioControlTail(); t.after(() => rm(fixture.parent, { recursive: true, force: true }));
    const quarantine = await writeRetainedPartialFailureQuarantine(fixture);
    const quarantinePath = join(fixture.root, TRIO_QUARANTINE_PATH);
    const retained = readFileSync(quarantinePath);
    const rewritten = structuredClone(quarantine); rewritten.reference = "rewritten fixture incident record";
    await writeFile(quarantinePath, `${JSON.stringify(rewritten, null, 2)}\n`);
    await commit(fixture.root, "rewrite future quarantine");
    await writeFile(quarantinePath, retained);
    await commit(fixture.root, "restore future quarantine bytes");
    const findings = validatePrepublicationPrTail(fixture.records[0], { root: fixture.root, trioRecords: fixture.records, cohort: fixture.cohort, cohortBytes: fixture.cohortBytes, quarantine, controlTailAuthorization: fixture.authorization }).map((item) => item.rule);
    assert.ok(findings.includes("trio-quarantine-history"));
  }
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
