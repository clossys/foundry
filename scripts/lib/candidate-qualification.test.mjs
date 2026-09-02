import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { comparableTranscriptProjection, comparableTranscriptSha256, currentQualificationJoins, parseStrictJson, qualificationIntroductionCommit, qualificationPath, qualificationRecordHistory, sealedQualificationPathsAtTransitionBase, validateCandidateQualification, validatePrepublicationPrTail, validateRetainedCandidateQualification, validateTrioControlTailAuthorization, validateTrioPublicationClosure } from "./candidate-qualification.mjs";
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
/**
 * Git may start automatic maintenance of its own after a commit, and a pack
 * write still running when a short-lived fixture is torn down makes the
 * teardown fail with ENOTEMPTY rather than anything about the test. These
 * fixtures live for one test, so they never need maintenance: turn it off at
 * creation, and let the removal retry briefly in case anything else is still
 * writing. The same remedy the publish validator's own fixtures carry.
 */
async function disableFixtureMaintenance(root) { await git(root, ["config", "gc.auto", "0"]); await git(root, ["config", "maintenance.auto", "false"]); }
async function initFixtureRepository(root) { await git(root, ["init"]); await disableFixtureMaintenance(root); await git(root, ["config", "user.email", "test@example.invalid"]); await git(root, ["config", "user.name", "Qualification Test"]); }
const removeFixtureDirectory = (path) => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
function frameworkV3Record({ exports = 1 } = {}) {
  const record = source();
  const transcript = record.transcript;
  transcript.schema = "foundry-candidate-qualification-transcript-v3";
  transcript.version = 3;
  const packageName = transcript.candidate.name;
  const allImports = transcript.observations.filter((item) => item.kind === "import");
  for (const [index, observation] of allImports.entries()) observation.id = `import:import:${packageName}${index === 0 ? "" : `/test-${index}`}`;
  const imports = allImports.slice(0, exports);
  for (const [index, observation] of imports.entries()) {
    observation.id = `framework:next:${index === 0 ? "server" : "client"}:${packageName}${index === 0 ? "" : "/artifacts"}`;
    observation.kind = "framework";
    observation.launch = "next-build";
    if (index > 0) {
      observation.stdoutSha256 = imports[0].stdoutSha256;
      observation.stderrSha256 = imports[0].stderrSha256;
    }
  }
  transcript.coverage.runtimeImports -= imports.length;
  transcript.coverage.reactServerImports = 0;
  transcript.coverage.frameworkExports = imports.length;
  transcript.coverage.frameworkBuilds = imports.length > 0 ? 1 : 0;
  refreshTranscriptDigest(record);
  return record;
}
function runtimeConditionsV3Record() {
  const record = frameworkV3Record({ exports: 0 });
  const imports = record.transcript.observations.filter((item) => item.kind === "import");
  imports[1].id = `import:react-server:${record.transcript.candidate.name}`;
  record.transcript.coverage.reactServerImports = 1;
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
  await initFixtureRepository(root);
  await mkdir(join(root, CONTROLLER_RECORD_DIRECTORY), { recursive: true });
  await writeFile(join(root, "governance/release-qualification-policy.json"), readFileSync("governance/release-qualification-policy.json"));
  const record = bootstrapSource(); const path = historicalControllerRecordPath(record);
  await writeFile(join(root, path), JSON.stringify(record, null, 2)); await commit(root, "introduce retained record");
  return { root, record, path };
}
async function syntheticIndependentRecordIntroductions() {
  const root = await mkdtemp(join(tmpdir(), "qualification-merge-history-"));
  await initFixtureRepository(root);
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
  await initFixtureRepository(root);
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
  await initFixtureRepository(root);
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
  await disableFixtureMaintenance(root);
  await git(root, ["config", "user.email", "test@example.invalid"]);
  await git(root, ["config", "user.name", "Qualification Test"]);
  return { parent, ...retainedTrioControlTail(root) };
}
async function clonePendingPublicationTransition({ commitTransition = true } = {}) {
  const parent = await mkdtemp(join(tmpdir(), "qualification-publication-transition-"));
  const root = join(parent, "repo");
  await execFile("git", ["clone", "--local", "--no-hardlinks", process.cwd(), root]);
  await git(root, ["checkout", "--detach", TRIO_PUBLICATION_TRANSITION_BASE]);
  await disableFixtureMaintenance(root);
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
test("accepts v3 framework evidence while v1 and v2 remain closed to v3 fields and kinds", () => {
  assert.deepEqual(rules(frameworkV3Record()), []);

  const fields = source();
  fields.transcript.schema = "foundry-candidate-qualification-transcript-v2";
  fields.transcript.version = 2;
  fields.transcript.coverage.frameworkExports = 0;
  fields.transcript.coverage.frameworkBuilds = 0;
  fields.transcript.coverage.reactServerImports = 0;
  refreshTranscriptDigest(fields);
  assert.ok(rules(fields).includes("unknown-field"));

  const kind = source();
  kind.transcript.schema = "foundry-candidate-qualification-transcript-v2";
  kind.transcript.version = 2;
  const observation = kind.transcript.observations.find((item) => item.kind === "import");
  observation.kind = "framework";
  observation.launch = "next-build";
  observation.id = `framework:next:server:${kind.transcript.candidate.name}`;
  refreshTranscriptDigest(kind);
  assert.ok(rules(kind).includes("observation"));
});
test("v3 runtime conditions keep ordinary and react-server imports distinct and closed", () => {
  assert.deepEqual(rules(runtimeConditionsV3Record()), []);
  const mutations = [
    (record) => { record.transcript.observations = record.transcript.observations.filter((item) => !item.id.startsWith("import:react-server:")); },
    (record) => { record.transcript.observations.find((item) => item.id.startsWith("import:react-server:")).id = `import:import:${record.transcript.candidate.name}`; },
    (record) => { record.transcript.observations.find((item) => item.id.startsWith("import:react-server:")).id = `import:browser:${record.transcript.candidate.name}`; },
    (record) => { record.transcript.observations.find((item) => item.id.startsWith("import:react-server:")).id = "import:react-server:@clossys/other"; },
    (record) => { record.transcript.observations.find((item) => item.id.startsWith("import:react-server:")).id = `import:react-server:${record.transcript.candidate.name}/unpaired`; },
    (record) => { record.transcript.coverage.reactServerImports = 0; },
    (record) => { record.transcript.coverage.reactServerImports = record.transcript.coverage.runtimeImports + 1; },
  ];
  for (const mutate of mutations) {
    const record = runtimeConditionsV3Record();
    mutate(record);
    refreshTranscriptDigest(record);
    assert.ok(rules(record).some((rule) => ["coverage", "observations", "observation", "import-observation"].includes(rule)));
  }
  for (const secondCondition of ["default", "string"]) {
    const record = runtimeConditionsV3Record();
    const ordinary = record.transcript.observations.find((item) => item.id.startsWith("import:import:"));
    const duplicate = structuredClone(ordinary);
    duplicate.id = duplicate.id.replace("import:import:", `import:${secondCondition}:`);
    record.transcript.observations.push(duplicate);
    record.transcript.coverage.runtimeImports += 1;
    record.transcript.coverage.concreteTargets += 1;
    refreshTranscriptDigest(record);
    assert.ok(rules(record).includes("import-observation"));
  }
});
test("v3 framework evidence cannot be omitted, miscounted, relabelled, duplicated, or split across build results", () => {
  const mutations = [
    (record) => { record.transcript.observations = record.transcript.observations.filter((item) => item.kind !== "framework"); },
    (record) => { record.transcript.coverage.frameworkExports = 2; record.transcript.coverage.concreteTargets += 1; },
    (record) => { record.transcript.coverage.frameworkBuilds = 0; },
    (record) => { record.transcript.coverage.concreteTargets -= 1; },
    (record) => { record.transcript.observations.find((item) => item.kind === "framework").id = "framework:next:edge:@clossys/controller"; },
    (record) => { record.transcript.observations.find((item) => item.kind === "framework").id = "framework:next:server:@clossys/other"; },
    (record) => { const item = record.transcript.observations.find((value) => value.kind === "framework"); record.transcript.observations.push(structuredClone(item)); record.transcript.coverage.frameworkExports += 1; record.transcript.coverage.concreteTargets += 1; },
  ];
  for (const mutate of mutations) {
    const record = frameworkV3Record();
    mutate(record);
    refreshTranscriptDigest(record);
    assert.ok(rules(record).some((rule) => ["coverage", "observations", "observation", "framework-observation"].includes(rule)));
  }

  const split = frameworkV3Record({ exports: 2 });
  split.transcript.observations.filter((item) => item.kind === "framework")[1].stdoutSha256 = "f".repeat(64);
  refreshTranscriptDigest(split);
  assert.ok(rules(split).includes("framework-observation"));

  const duplicateSpecifier = frameworkV3Record({ exports: 2 });
  const framework = duplicateSpecifier.transcript.observations.filter((item) => item.kind === "framework");
  framework[1].id = `${framework[1].id.slice(0, framework[1].id.lastIndexOf(":"))}:${duplicateSpecifier.transcript.candidate.name}`;
  refreshTranscriptDigest(duplicateSpecifier);
  assert.ok(rules(duplicateSpecifier).includes("framework-observation"));

  const rawFrameworkReuse = frameworkV3Record();
  const frameworkSpecifier = rawFrameworkReuse.transcript.observations.find((item) => item.kind === "framework").id.split(":").slice(3).join(":");
  rawFrameworkReuse.transcript.observations.find((item) => item.kind === "import").id = `import:import:${frameworkSpecifier}`;
  refreshTranscriptDigest(rawFrameworkReuse);
  assert.ok(rules(rawFrameworkReuse).includes("framework-observation"));

  const expectedIds = frameworkV3Record({ exports: 2 }).transcript.observations.filter((item) => item.kind === "framework").map((item) => item.id).sort();
  const expected = { frameworkObservationsSha256: sha256(JSON.stringify(expectedIds)) };
  const roleSwap = frameworkV3Record({ exports: 2 });
  const swapped = roleSwap.transcript.observations.filter((item) => item.kind === "framework");
  [swapped[0].id, swapped[1].id] = [swapped[0].id.replace("server", "client"), swapped[1].id.replace("client", "server")];
  refreshTranscriptDigest(roleSwap);
  assert.ok(rules(roleSwap, { expected }).includes("framework-source-join"));
  const allOneRole = frameworkV3Record({ exports: 2 });
  for (const item of allOneRole.transcript.observations.filter((value) => value.kind === "framework")) item.id = item.id.replace(/framework:next:(?:client|server|proxy):/, "framework:next:server:");
  refreshTranscriptDigest(allOneRole);
  assert.ok(rules(allOneRole, { expected }).includes("framework-source-join"));
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
test("fresh replay ignores only generated consumer digest drift", () => {
  const record = rawStarterV2Record();
  const fresh = structuredClone(record.transcript);
  fresh.consumer = { manifestSha256: "1".repeat(64), lockfileSha256: "2".repeat(64) };
  delete fresh.canonicalSha256; fresh.canonicalSha256 = sha256(JSON.stringify(fresh));
  assert.equal(comparableTranscriptSha256(record.transcript), comparableTranscriptSha256(fresh));
  assert.deepEqual(comparableTranscriptProjection(fresh).consumer, {});
  assert.equal(rules(record, { freshTranscript: fresh }).some((rule) => rule.startsWith("fresh-transcript")), false);

  const rejectDrift = (mutate, label) => {
    const changed = structuredClone(fresh);
    mutate(changed);
    delete changed.canonicalSha256; changed.canonicalSha256 = sha256(JSON.stringify(changed));
    assert.notEqual(comparableTranscriptSha256(record.transcript), comparableTranscriptSha256(changed), `${label} must remain in the comparable projection`);
    assert.ok(rules(record, { freshTranscript: changed }).some((rule) => rule.startsWith("fresh-transcript")), `${label} must reject fresh replay`);
  };
  rejectDrift((value) => {
    const observation = value.observations.find((item) => item.kind === "case");
    observation.rawCaseEvidence.stdout = `${observation.rawCaseEvidence.stdout}changed\n`;
    observation.stdoutSha256 = sha256(observation.rawCaseEvidence.stdout);
  }, "observation");
  rejectDrift((value) => { value.coverage.bins += 1; }, "coverage");
  rejectDrift((value) => { value.candidate.version = "9.9.9"; }, "candidate");
  rejectDrift((value) => { value.restoration.manifestRestored = false; }, "rollback");
  rejectDrift((value) => { value.dimensions.find((item) => item.dimension === "rollback").evidence = ["uninstall"]; }, "operation");

  const invalid = structuredClone(fresh);
  invalid.consumer.manifestSha256 = "not-a-digest";
  delete invalid.canonicalSha256; invalid.canonicalSha256 = sha256(JSON.stringify(invalid));
  assert.ok(rules(record, { freshTranscript: invalid }).includes("fresh-transcript-transcript"));
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
  const fixture = await syntheticPrepublication(); t.after(() => removeFixtureDirectory(fixture.root));
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
  const fixture = await syntheticIndependentRecordIntroductions(); t.after(() => removeFixtureDirectory(fixture.root));
  for (const head of fixture.heads) {
    assert.throws(() => qualificationIntroductionCommit(fixture.root, fixture.record.candidate, head, historicalControllerRecordPath(fixture.record)), /one introduction commit/);
  }
});
test("fixture repositories disable automatic git maintenance so teardown cannot race a pack write", async (t) => {
  const fixture = await syntheticRetainedRecord(); t.after(() => removeFixtureDirectory(fixture.root));
  assert.equal((await git(fixture.root, ["config", "--get", "gc.auto"])).stdout.trim(), "0");
  assert.equal((await git(fixture.root, ["config", "--get", "maintenance.auto"])).stdout.trim(), "false");
});
test("the history seal rejects coherent tarball, transcript, and registry rewrites", async (t) => {
  const fixture = await syntheticRetainedRecord(); t.after(() => removeFixtureDirectory(fixture.root));
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
  const fixture = await syntheticPrepublication(); t.after(() => removeFixtureDirectory(fixture.root));
  assert.deepEqual(validatePrepublicationPrTail(fixture.record, { root: fixture.root }), []);
  const expected = { name: fixture.record.candidate.name, version: fixture.record.candidate.version, ...currentQualificationJoins(fixture.root, fixture.record.candidate) };
  assert.deepEqual(rules(fixture.record, { mode: "prepublish", expected, freshTranscript: fixture.record.transcript }), []);
  fixture.record.reviewedCommit = "a".repeat(40);
  assert.ok(validatePrepublicationPrTail(fixture.record, { root: fixture.root }).some((item) => item.rule === "reviewed-ancestor"));
});
test("Trio prepublication tail admits only a closed exact partial-failure quarantine", async (t) => {
  for (let completed = 0; completed < TRIO.length; completed += 1) {
    const fixture = await syntheticTrioPrepublication(); t.after(() => removeFixtureDirectory(fixture.root));
    const quarantine = await appendPartialFailureQuarantine(fixture, TRIO.slice(0, completed));
    for (const record of fixture.records) {
      assert.deepEqual(validatePrepublicationPrTail(record, { root: fixture.root, trioRecords: fixture.records, cohort: fixture.cohort, cohortBytes: fixture.cohortBytes, quarantine }), []);
    }
  }
});
test("Trio quarantine tail rejects malformed, reordered, next-member, cohort-drift, missing-path, and unrelated changes", async (t) => {
  const fixture = await syntheticTrioPrepublication(); t.after(() => removeFixtureDirectory(fixture.root));
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
  t.after(() => removeFixtureDirectory(retained.parent));
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
  t.after(() => removeFixtureDirectory(fixture.parent));
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
  t.after(() => removeFixtureDirectory(fixture.parent));
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

test("transition-base predecessor records survive a fresh clone without dangling reviewed commits", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "qualification-sealed-history-"));
  const root = join(parent, "repo");
  t.after(() => removeFixtureDirectory(parent));
  await execFile("git", ["clone", "--no-local", process.cwd(), root]);
  await git(root, ["config", "user.email", "test@example.invalid"]); await git(root, ["config", "user.name", "Qualification Test"]);
  const path = "governance/release-qualifications/controller-0.8.21.json";
  const record = parseStrictJson(readFileSync(join(root, path), "utf8"));
  await assert.rejects(git(root, ["cat-file", "-e", `${record.reviewedCommit}^{commit}`]));
  const sealedPaths = sealedQualificationPathsAtTransitionBase(root);
  assert.equal(sealedPaths.size, 7);
  assert.ok(sealedPaths.has(path));
  assert.deepEqual(validateRetainedCandidateQualification(record, { root, path, sealedBase: TRIO_PUBLICATION_TRANSITION_BASE }), []);

  const retained = readFileSync(join(root, path));
  await rm(join(root, path));
  await assert.rejects(
    execFile(process.execPath, [join(process.cwd(), "scripts/check-candidate-qualification.mjs")], { cwd: root }),
    (error) => error?.stderr?.includes(`[sealed-record-set] ${path}`),
  );
  await writeFile(join(root, path), retained);

  const futurePath = "governance/release-qualifications/controller-9.9.9.json";
  const future = structuredClone(record);
  future.candidate.version = "9.9.9";
  future.transcript.candidate.version = "9.9.9";
  refreshTranscriptDigest(future);
  await writeFile(join(root, futurePath), `${JSON.stringify(future, null, 2)}\n`);
  await commit(root, "introduce a later legacy-shaped record");
  assert.equal(sealedPaths.has(futurePath), false);
  assert.throws(() => validateRetainedCandidateQualification(future, { root, path: futurePath, expectedPath: futurePath }), /release-qualification-policy\.json/);

  await writeFile(join(root, path), `${retained.toString("utf8")}\n`); await commit(root, "rewrite sealed predecessor");
  await writeFile(join(root, path), retained); await commit(root, "restore sealed predecessor");
  assert.ok(validateRetainedCandidateQualification(record, { root, path, sealedBase: TRIO_PUBLICATION_TRANSITION_BASE }).some((item) => item.rule === "sealed-record-touches"));

  const drifted = structuredClone(record);
  drifted.candidate.policySha256 = "0".repeat(64);
  assert.ok(validateRetainedCandidateQualification(drifted, { root, path, sealedBase: TRIO_PUBLICATION_TRANSITION_BASE }).some((item) => item.rule === "content-join"));

  const spoofedPublication = parseStrictJson(readFileSync(join(root, TRIO_PUBLICATION_PATH), "utf8"));
  spoofedPublication.members[2].qualification.path = futurePath;
  spoofedPublication.members[2].qualification.sha256 = "0".repeat(64);
  assert.ok(validatePrepublicationPrTail(record, { root, recordPath: futurePath, publication: spoofedPublication, publicationClosureValid: true }).some((item) => item.rule === "reviewed-ancestor"));
});

test("post-closure qualifications enter together in one record-only child of their reviewed commit", async (t) => {
  const fixture = await clonePendingPublicationTransition();
  t.after(() => removeFixtureDirectory(fixture.parent));
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
    t.after(() => removeFixtureDirectory(fixture.parent));
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
  t.after(() => removeFixtureDirectory(fixture.parent));
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

test("forward-record-touches ignores a pass-through merge but still catches a genuine rewrite or deletion", async (t) => {
  const fixture = await clonePendingPublicationTransition();
  t.after(() => removeFixtureDirectory(fixture.parent));
  const base = (await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
  const forward = await appendForwardTrioQualifications(fixture);
  const path = qualificationPath(fixture.root, forward.records[0].candidate, forward.reviewedCommit);
  const context = {
    root: fixture.root,
    publication: fixture.publication,
    publicationClosureValid: true,
    trioRecords: [...fixture.records, ...forward.records],
  };

  // 1. A branch merged in after the record's introduction, that never itself
  // touches the record, must not trip forward-record-touches merely because
  // `git log --full-history` reports the merge for that path.
  await git(fixture.root, ["checkout", "-b", "forward-head"]);
  await git(fixture.root, ["checkout", "-b", "unrelated-side", base]);
  await writeFile(join(fixture.root, "unrelated-side-change.txt"), "side\n");
  await commit(fixture.root, "unrelated side-branch change");
  await git(fixture.root, ["checkout", "forward-head"]);
  await git(fixture.root, ["merge", "--no-ff", "-m", "merge unrelated side branch", "unrelated-side"]);
  assert.deepEqual(validatePrepublicationPrTail(forward.records[0], context).map((item) => item.rule), []);

  // 2. A genuine post-introduction rewrite (even later restored to the exact
  // introduction bytes) must still trip it.
  const retained = readFileSync(join(fixture.root, path));
  await writeFile(join(fixture.root, path), `${retained.toString("utf8")}\n`);
  await commit(fixture.root, "rewrite future qualification record");
  await writeFile(join(fixture.root, path), retained);
  await commit(fixture.root, "restore future qualification record");
  const rewritten = validatePrepublicationPrTail(forward.records[0], context).map((item) => item.rule);
  assert.ok(rewritten.includes("forward-record-touches"));

  // 3. A genuine post-introduction deletion (even later restored) must still
  // be rejected. It surfaces as `forward-record-history` rather than
  // `forward-record-touches`: the sibling history rule reaches a vanished
  // record first. Asserted by its real rule name so this test states what
  // actually enforces the invariant.
  await rm(join(fixture.root, path));
  await commit(fixture.root, "delete future qualification record");
  await writeFile(join(fixture.root, path), retained);
  await commit(fixture.root, "restore deleted future qualification record");
  const deleted = validatePrepublicationPrTail(forward.records[0], context).map((item) => item.rule);
  assert.ok(deleted.includes("forward-record-history"));
});

test("forward-record-touches catches a rewrite that arrives through a merge rather than a direct commit", async (t) => {
  const fixture = await clonePendingPublicationTransition();
  t.after(() => removeFixtureDirectory(fixture.parent));
  const forward = await appendForwardTrioQualifications(fixture);
  const path = qualificationPath(fixture.root, forward.records[0].candidate, forward.reviewedCommit);
  const context = {
    root: fixture.root,
    publication: fixture.publication,
    publicationClosureValid: true,
    trioRecords: [...fixture.records, ...forward.records],
  };

  // The rewrite happens on a side branch and reaches the head only as a
  // merge, so the merge commit's own blob is identical to the blob of the
  // parent that rewrote it. A parent-relative pass-through test reads that
  // as "carried through unchanged" and lets it past; measuring against the
  // introduction blob is what actually catches it.
  const retained = readFileSync(join(fixture.root, path));
  await git(fixture.root, ["checkout", "-b", "rewrite-side"]);
  await writeFile(join(fixture.root, path), `${retained.toString("utf8")}\n`);
  await commit(fixture.root, "rewrite the record on a side branch");
  await git(fixture.root, ["checkout", "-"]);
  await git(fixture.root, ["merge", "--no-ff", "-m", "merge the side-branch rewrite", "rewrite-side"]);

  const merged = validatePrepublicationPrTail(forward.records[0], context).map((item) => item.rule);
  assert.ok(merged.includes("forward-record-touches"));
});

test("publication closure rejects retained evidence rewrite and restoration", async (t) => {
  const fixture = await clonePendingPublicationTransition();
  t.after(() => removeFixtureDirectory(fixture.parent));
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
    const fixture = await cloneRetainedTrioControlTail(); t.after(() => removeFixtureDirectory(fixture.parent));
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
    const fixture = await cloneRetainedTrioControlTail(); t.after(() => removeFixtureDirectory(fixture.parent));
    const authorizationPath = join(fixture.root, TRIO_CONTROL_TAIL_AUTHORIZATION_PATH);
    const retained = readFileSync(authorizationPath);
    const changed = structuredClone(fixture.authorization); changed.authorizedFiles[0].sha256 = "a".repeat(64);
    await writeFile(authorizationPath, `${JSON.stringify(changed, null, 2)}\n`);
    await commit(fixture.root, "rewrite authorization");
    await writeFile(authorizationPath, retained); await commit(fixture.root, "restore authorization bytes");
    assert.ok(validateTrioControlTailAuthorization(fixture.authorization, { root: fixture.root, trioRecords: fixture.records, cohortBytes: fixture.cohortBytes }).some((item) => item.rule === "control-tail-file-history"));
  }
  {
    const fixture = await cloneRetainedTrioControlTail(); t.after(() => removeFixtureDirectory(fixture.parent));
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
    const fixture = await cloneRetainedTrioControlTail(); t.after(() => removeFixtureDirectory(fixture.parent));
    const unrelated = join(fixture.root, "governance/release-qualification-tail-authorizations/unrelated.json");
    await writeFile(unrelated, "{}\n"); await commit(fixture.root, "unrelated tail");
    await rm(unrelated); await commit(fixture.root, "restore unrelated tail");
    assert.deepEqual(validateTrioControlTailAuthorization(fixture.authorization, { root: fixture.root, trioRecords: fixture.records, cohortBytes: fixture.cohortBytes }), []);
    assert.ok(validatePrepublicationPrTail(fixture.records[0], { root: fixture.root, trioRecords: fixture.records, cohort: fixture.cohort, cohortBytes: fixture.cohortBytes, controlTailAuthorization: fixture.authorization }).some((item) => item.rule === "pr-tail-history"));
  }
});
test("future Trio quarantine must descend from the exact sealed control authorization", async (t) => {
  {
    const fixture = await cloneRetainedTrioControlTail(); t.after(() => removeFixtureDirectory(fixture.parent));
    const quarantine = await writeRetainedPartialFailureQuarantine(fixture);
    for (const record of fixture.records) assert.deepEqual(validatePrepublicationPrTail(record, { root: fixture.root, trioRecords: fixture.records, cohort: fixture.cohort, cohortBytes: fixture.cohortBytes, quarantine, controlTailAuthorization: fixture.authorization }), []);
  }
  {
    const fixture = await cloneRetainedTrioControlTail(); t.after(() => removeFixtureDirectory(fixture.parent));
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
    const fixture = await cloneRetainedTrioControlTail(); t.after(() => removeFixtureDirectory(fixture.parent));
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
    const fixture = await syntheticPrepublication(); t.after(() => removeFixtureDirectory(fixture.root));
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
