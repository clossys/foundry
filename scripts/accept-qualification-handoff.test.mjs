import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { currentQualificationJoins, parseStrictJson, qualificationPath } from "./lib/candidate-qualification.mjs";
import { generateQualificationRecord } from "./generate-qualification-record.mjs";
import { ACCEPTED_SCHEMA_VERSION, HANDOFF_FILE, MAX_RECORD_BYTES, acceptQualificationHandoff, argsFrom } from "./accept-qualification-handoff.mjs";

// The trusted half of qualify-candidate.yml's job split. Every refusal below
// is a shape an untrusted qualify job could upload; the one acceptance is a
// record generate-qualification-record.mjs itself produced, so the accepted
// schema and canonical serialization cannot drift from the generator's.
//
// The fixture is the same hermetic one generate-qualification-record.test.mjs
// builds: a throwaway git repository seeded from this repository's own
// controller package, adapter and fixtures, with a real v3 transcript cloned
// from a retained record and rebound to the fixture candidate.

const execFile = promisify(execFileCallback);
const sourceRoot = process.cwd();
const acceptScript = join(sourceRoot, "scripts", "accept-qualification-handoff.mjs");
const sha = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");
const git = (root, args) => execFile("git", args, { cwd: root });
const gitOutput = async (root, args) => (await git(root, args)).stdout.trim();
const removeDirectory = (path) => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
const REVIEW_REFERENCE = "github-actions-dispatch:qualify-candidate.yml;run:1;attempt:1";
const REPRODUCIBLE = () => ({ sha1: "stub", sha256: "stub", sha512: "stub" });

const cleanup = [];
let f;

before(async () => {
  const root = await mkdtemp(join(tmpdir(), "accept-handoff-fixture-"));
  const tarRoot = await mkdtemp(join(tmpdir(), "accept-handoff-tar-"));
  const evidenceRoot = await mkdtemp(join(tmpdir(), "accept-handoff-evidence-"));
  cleanup.push(root, tarRoot, evidenceRoot);

  await git(root, ["init"]);
  await git(root, ["config", "gc.auto", "0"]);
  await git(root, ["config", "maintenance.auto", "false"]);
  await git(root, ["config", "user.email", "test@example.invalid"]);
  await git(root, ["config", "user.name", "Hand-off Test"]);
  for (const path of ["packages/controller", "governance/release-qualification-adapters/controller", "governance/release-qualification-fixtures/controller/current-direct"]) await mkdir(join(root, path), { recursive: true });
  await cp(join(sourceRoot, "packages/controller/package.json"), join(root, "packages/controller/package.json"));
  await cp(join(sourceRoot, "package.json"), join(root, "package.json"));
  await cp(join(sourceRoot, "package-lock.json"), join(root, "package-lock.json"));
  await cp(join(sourceRoot, "governance/release-qualification-policy.json"), join(root, "governance/release-qualification-policy.json"));
  await cp(join(sourceRoot, "governance/release-qualification-adapters/controller/current-direct.json"), join(root, "governance/release-qualification-adapters/controller/current-direct.json"));
  for (const name of ["authority-valid-package-lock.json", "authority-duplicate-package-lock.json", "authority-indeterminate-package-lock.json", "authority-declarations.json"]) await cp(join(sourceRoot, "governance/release-qualification-fixtures/controller/current-direct", name), join(root, "governance/release-qualification-fixtures/controller/current-direct", name));
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "reviewed candidate"]);
  const reviewedCommit = await gitOutput(root, ["rev-parse", "HEAD"]);

  const manifest = parseStrictJson(await readFile(join(root, "packages/controller/package.json"), "utf8"));
  const candidate = { name: manifest.name, version: manifest.version };
  const joins = currentQualificationJoins(root, candidate, reviewedCommit);

  const template = parseStrictJson(await readFile(join(sourceRoot, "governance/release-qualifications/clossys-controller-0.8.24.json"), "utf8"));
  const transcript = structuredClone(template.transcript);
  transcript.candidate = candidate;
  transcript.coverage.installedManifestSha256 = joins.packageManifestSha256;
  const packed = join(tarRoot, "candidate.tgz");
  await mkdir(join(tarRoot, "package"), { recursive: true });
  await cp(join(root, "packages/controller/package.json"), join(tarRoot, "package/package.json"));
  await execFile("tar", ["-czf", packed, "-C", tarRoot, "package"]);
  const tarballBytes = await readFile(packed);
  transcript.tarball = { sha1: sha("sha1", tarballBytes), sha256: sha("sha256", tarballBytes), sha512: sha("sha512", tarballBytes) };
  const transcriptCopy = { ...transcript };
  delete transcriptCopy.canonicalSha256;
  transcript.canonicalSha256 = sha("sha256", JSON.stringify(transcriptCopy));
  const transcriptPath = join(evidenceRoot, "transcript.json");
  await writeFile(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`);

  // The record exactly as the qualify job's generator step writes it.
  const generated = generateQualificationRecord({
    root,
    args: { package: "controller", tarball: packed, transcript: transcriptPath, "review-reference": REVIEW_REFERENCE },
    reproducibility: REPRODUCIBLE,
  });
  const text = `${JSON.stringify(generated.record, null, 2)}\n`;
  f = { root, candidate, reviewedCommit, record: generated.record, text, recordPath: generated.recordPath };
});

after(() => Promise.all(cleanup.map(removeDirectory)));

async function handoff(files) {
  const dir = await mkdtemp(join(tmpdir(), "accept-handoff-artifact-"));
  cleanup.push(dir);
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  return dir;
}

function accept(handoffDir, overrides = {}) {
  return acceptQualificationHandoff({
    root: f.root,
    packageKey: "controller",
    version: f.candidate.version,
    handoffDir,
    reviewedCommit: f.reviewedCommit,
    reviewReference: REVIEW_REFERENCE,
    ...overrides,
  });
}

function refused(pattern) {
  return (error) => error.constructor.name === "HandoffRefused" && pattern.test(error.message);
}

async function expectRefused(files, pattern) {
  const dir = await handoff(files);
  assert.throws(() => accept(dir), refused(pattern));
}

const mutated = (mutate) => {
  const record = structuredClone(f.record);
  mutate(record);
  return `${JSON.stringify(record, null, 2)}\n`;
};

test("the accepted schema is the one generate-qualification-record.mjs writes", () => {
  assert.equal(f.record.schemaVersion, ACCEPTED_SCHEMA_VERSION);
});

test("a record the generator produced at the reviewed commit is accepted, at the path the trusted checkout derives", async () => {
  const result = accept(await handoff({ [HANDOFF_FILE]: f.text }));
  assert.equal(result.recordPath, qualificationPath(f.root, f.candidate, f.reviewedCommit));
  assert.equal(result.recordPath, f.recordPath);
  assert.equal(result.text, f.text);
});

test("the hand-off directory must hold exactly the one expected file", async () => {
  assert.throws(() => accept(join(tmpdir(), "accept-handoff-does-not-exist")), refused(/does not exist/));
  await expectRefused({}, /exactly qualification-record\.json/);
  await expectRefused({ [HANDOFF_FILE]: f.text, "extra.sh": "echo hi\n" }, /exactly qualification-record\.json/);
  await expectRefused({ "record.json": f.text }, /exactly qualification-record\.json/);
});

test("a symlinked or directory-shaped record file is refused", async () => {
  const target = await handoff({ "real.json": f.text });
  const linked = await handoff({});
  await symlink(join(target, "real.json"), join(linked, HANDOFF_FILE));
  assert.throws(() => accept(linked), refused(/regular file/));

  const nested = await handoff({});
  await mkdir(join(nested, HANDOFF_FILE));
  assert.throws(() => accept(nested), refused(/regular file/));
});

test("an empty or oversized record file is refused before it is parsed", async () => {
  await expectRefused({ [HANDOFF_FILE]: "" }, /between 1 and/);
  await expectRefused({ [HANDOFF_FILE]: " ".repeat(MAX_RECORD_BYTES + 1) }, /between 1 and/);
});

test("bytes that are not strict, canonical JSON are refused", async () => {
  await expectRefused({ [HANDOFF_FILE]: Buffer.from([0xff, 0xfe, 0x7b]) }, /UTF-8/);
  await expectRefused({ [HANDOFF_FILE]: "{\"schemaVersion\": 2, \"schemaVersion\": 2}\n" }, /strict JSON/);
  await expectRefused({ [HANDOFF_FILE]: f.text.trimEnd() }, /canonical serialization/);
  await expectRefused({ [HANDOFF_FILE]: JSON.stringify(f.record) }, /canonical serialization/);
});

test("a record not bound to this run's candidate, commit and reference is refused", async () => {
  const cases = [
    [mutated((r) => { r.schemaVersion = 3; }), /schemaVersion/],
    [mutated((r) => { r.timing = "post-publication-bootstrap"; }), /timing/],
    [mutated((r) => { r.candidate.name = "@clossys/other"; }), /record names/],
    [mutated((r) => { r.candidate.version = "9.9.9"; }), /record names/],
    [mutated((r) => { r.reviewedCommit = "0".repeat(40); }), /reviewed commit/],
    [mutated((r) => { r.candidateReview.headSha = "0".repeat(40); }), /reviewed commit/],
    [mutated((r) => { r.candidateReview.reference = "someone else's run"; }), /review reference/],
    [mutated((r) => { r.findings = [{ classification: "consumer-integration", status: "open", reference: "x" }]; }), /findings/],
  ];
  for (const [text, pattern] of cases) await expectRefused({ [HANDOFF_FILE]: text }, pattern);
});

test("a record whose joins differ from the trusted checkout fails the existing validator", async () => {
  const cases = [
    mutated((r) => { r.candidate.packageTreeSha1 = "0".repeat(40); }),
    mutated((r) => { r.candidate.policySha256 = "0".repeat(64); }),
    mutated((r) => { r.rootPackageLockSha256 = "0".repeat(64); }),
    mutated((r) => { r.candidate.tarball.sha256 = "0".repeat(64); }),
    mutated((r) => { r.unexpected = true; }),
  ];
  for (const text of cases) await expectRefused({ [HANDOFF_FILE]: text }, /fails validation/);
});

test("the caller's own inputs must agree with the trusted checkout", async () => {
  const dir = await handoff({ [HANDOFF_FILE]: f.text });
  assert.throws(() => accept(dir, { version: "9.9.9" }), refused(/declares/));
  assert.throws(() => accept(dir, { reviewedCommit: "0".repeat(40) }), refused(/is not the reviewed commit/));
  assert.throws(() => accept(dir, { reviewReference: "github-actions-dispatch:qualify-candidate.yml;run:1;attempt:2" }), refused(/review reference/));
  assert.throws(() => accept(dir, { packageKey: "../controller" }), (error) => error.constructor.name === "UsageError");
});

test("a modified trusted checkout, or an existing record path, is refused", async () => {
  const dir = await handoff({ [HANDOFF_FILE]: f.text });
  const stray = join(f.root, "stray.txt");
  await writeFile(stray, "x");
  try { assert.throws(() => accept(dir), refused(/not clean/)); }
  finally { await unlink(stray); }

  const destination = join(f.root, f.recordPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, f.text);
  await git(f.root, ["add", "."]);
  await git(f.root, ["commit", "-m", "retain"]);
  const head = await gitOutput(f.root, ["rev-parse", "HEAD"]);
  try { assert.throws(() => accept(dir, { reviewedCommit: head }), refused(/already exists/)); }
  finally { await git(f.root, ["reset", "--hard", f.reviewedCommit]); }
});

test("the CLI has a closed argument set", () => {
  const argv = ["node", "script", "--package", "controller", "--version", "1.2.3", "--handoff-dir", "d", "--reviewed-commit", "a".repeat(40), "--review-reference", "r"];
  assert.equal(argsFrom(argv).package, "controller");
  for (const bad of [[...argv, "--out", "x"], argv.slice(0, -2), [...argv.slice(0, -1), " "], argv.map((v) => (v === "controller" ? "../x" : v))]) {
    assert.throws(() => argsFrom(bad), /Usage:/);
  }
});

test("the CLI writes the accepted bytes to the derived path and prints only that path; a refusal writes nothing", async () => {
  const good = await handoff({ [HANDOFF_FILE]: f.text });
  const bad = await handoff({ [HANDOFF_FILE]: f.text, "extra.json": "{}\n" });
  const args = (dir) => [acceptScript, "--package", "controller", "--version", f.candidate.version, "--handoff-dir", dir, "--reviewed-commit", f.reviewedCommit, "--review-reference", REVIEW_REFERENCE];

  await assert.rejects(execFile(process.execPath, args(bad), { cwd: f.root }), (error) => error.code === 1 && /HAND-OFF REFUSED/.test(error.stderr));
  assert.ok(!existsSync(join(f.root, f.recordPath)), "a refused hand-off must not write a record");

  try {
    const { stdout } = await execFile(process.execPath, args(good), { cwd: f.root });
    assert.equal(stdout, `${f.recordPath}\n`);
    assert.equal(await readFile(join(f.root, f.recordPath), "utf8"), f.text);
  } finally {
    await rm(join(f.root, f.recordPath), { force: true });
  }
});
