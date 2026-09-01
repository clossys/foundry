import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { currentQualificationJoins, parseStrictJson, qualificationPath } from "./lib/candidate-qualification.mjs";
import { argsFrom, freezeTarball, qualificationJoinsRef, validateCandidatePublish } from "./validate-candidate-publish.mjs";

const execFile = promisify(execFileCallback);
const sourceRoot = process.cwd();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const commit = async (root, message) => {
  await execFile("git", ["add", "."], { cwd: root });
  await execFile("git", ["commit", "-m", message], { cwd: root });
  return (await execFile("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
};
const gitOutput = async (root, args) => (await execFile("git", args, { cwd: root })).stdout.trim();
const removeFixtureDirectory = (path) => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

async function validatorFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "publish-validator-fixture-"));
  const tarRoot = await mkdtemp(join(tmpdir(), "publish-validator-tar-"));
  const evidenceRoot = await mkdtemp(join(tmpdir(), "publish-validator-evidence-"));
  t.after(async () => Promise.all([removeFixtureDirectory(root), removeFixtureDirectory(tarRoot), removeFixtureDirectory(evidenceRoot)]));
  await execFile("git", ["init"], { cwd: root });
  // Git may launch automatic maintenance after a commit; keep this short-lived
  // fixture single-process so its teardown cannot race a background pack write.
  await execFile("git", ["config", "gc.auto", "0"], { cwd: root });
  await execFile("git", ["config", "maintenance.auto", "false"], { cwd: root });
  await execFile("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  await execFile("git", ["config", "user.name", "Validator Test"], { cwd: root });
  for (const path of ["packages/controller", "governance/release-qualification-adapters/controller", "governance/release-qualification-fixtures/controller/current-direct"]) await mkdir(join(root, path), { recursive: true });
  await cp(join(sourceRoot, "packages/controller"), join(root, "packages/controller"), { recursive: true });
  await cp(join(sourceRoot, "package.json"), join(root, "package.json"));
  await cp(join(sourceRoot, "package-lock.json"), join(root, "package-lock.json"));
  await cp(join(sourceRoot, "governance/release-qualification-policy.json"), join(root, "governance/release-qualification-policy.json"));
  await cp(join(sourceRoot, "governance/release-qualification-adapters/controller/current-direct.json"), join(root, "governance/release-qualification-adapters/controller/current-direct.json"));
  for (const name of ["authority-valid-package-lock.json", "authority-duplicate-package-lock.json", "authority-indeterminate-package-lock.json", "authority-declarations.json"]) await cp(join(sourceRoot, "governance/release-qualification-fixtures/controller/current-direct", name), join(root, "governance/release-qualification-fixtures/controller/current-direct", name));
  const reviewedCommit = await commit(root, "reviewed candidate");
  const manifest = parseStrictJson(await readFile(join(root, "packages/controller/package.json"), "utf8"));
  const candidate = { name: manifest.name, version: manifest.version };
  const joins = currentQualificationJoins(root, candidate, reviewedCommit);
  const record = parseStrictJson(await readFile(join(sourceRoot, "governance/release-qualifications/clossys-controller-0.8.24.json"), "utf8"));
  record.reviewedCommit = reviewedCommit;
  record.rootPackageJsonSha256 = joins.rootPackageJsonSha256;
  record.rootPackageLockSha256 = joins.rootPackageLockSha256;
  record.candidate = { ...record.candidate, ...candidate, packageTreeSha1: joins.packageTreeSha1, packageManifestSha256: joins.packageManifestSha256, policySha256: joins.policySha256, adapterSha256: joins.adapterSha256, fixtureSetSha256: joins.fixtureSetSha256 };
  record.transcript.candidate = candidate;
  record.transcript.coverage.installedManifestSha256 = joins.packageManifestSha256;
  record.candidateReview = { headSha: reviewedCommit, reference: "fixture review" };

  const packed = join(tarRoot, "candidate.tgz");
  await mkdir(join(tarRoot, "package"), { recursive: true });
  await cp(join(root, "packages/controller/package.json"), join(tarRoot, "package/package.json"));
  await execFile("tar", ["-czf", packed, "-C", tarRoot, "package"]);
  const tarballBytes = await readFile(packed);
  const tarball = { sha1: createHash("sha1").update(tarballBytes).digest("hex"), sha256: sha256(tarballBytes), sha512: createHash("sha512").update(tarballBytes).digest("hex") };
  record.candidate.tarball = tarball;
  record.transcript.tarball = tarball;
  const transcriptCopy = { ...record.transcript };
  delete transcriptCopy.canonicalSha256;
  record.transcript.canonicalSha256 = sha256(JSON.stringify(transcriptCopy));
  const recordPath = qualificationPath(root, candidate);
  await mkdir(dirname(join(root, recordPath)), { recursive: true });
  await writeFile(join(root, recordPath), `${JSON.stringify(record, null, 2)}\n`);
  await commit(root, "retain candidate record");
  const transcriptPath = join(evidenceRoot, "transcript.json");
  await writeFile(transcriptPath, `${JSON.stringify(record.transcript, null, 2)}\n`);
  return { root, record, recordPath: join(root, recordPath), tarball: packed, transcriptPath, reviewedCommit };
}

function validatorArgs(fixture, mode = "prepublish") {
  return { package: "controller", tarball: fixture.tarball, transcript: fixture.transcriptPath, mode };
}

test("publish validator has a closed CLI and rejects traversal or bootstrap authorization flags", () => {
  const argv = ["node", "script", "--package", "controller", "--tarball", "candidate.tgz", "--transcript", "result.json", "--mode", "prepublish"];
  assert.deepEqual(argsFrom(argv), { package: "controller", tarball: "candidate.tgz", transcript: "result.json", mode: "prepublish" });
  for (const mutation of [["--unknown", "x"], ["--package", "../controller"], ["--mode", "other"], ["--package", "again"]]) assert.throws(() => argsFrom([...argv, ...mutation]), /Usage:/);
});

test("validator fixture disables automatic git maintenance", async (t) => {
  const fixture = await validatorFixture(t);
  assert.equal(await gitOutput(fixture.root, ["config", "--get", "gc.auto"]), "0");
  assert.equal(await gitOutput(fixture.root, ["config", "--get", "maintenance.auto"]), "false");
});

test("validator freezes the supplied tarball before a source path replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "publish-validator-test-")); t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "candidate.tgz"); await writeFile(source, "first bytes");
  const frozen = freezeTarball(source); await writeFile(source, "replacement bytes");
  try { assert.equal((await readFile(frozen.tarball, "utf8")), "first bytes"); } finally { frozen.cleanup(); }
});

test("prepublication joins select the immutable reviewed commit while bootstrap retains live-root selection", async (t) => {
  const fixture = await validatorFixture(t);
  assert.equal(qualificationJoinsRef(fixture.record, "prepublish", fixture.root), fixture.reviewedCommit);
  assert.equal(qualificationJoinsRef({ timing: "post-publication-bootstrap", reviewedCommit: fixture.reviewedCommit }, "bootstrap", fixture.root), "WORKTREE");
  assert.equal(qualificationJoinsRef(fixture.record, "bootstrap", fixture.root), "WORKTREE");
});

test("later unrelated root package manifest and lockfile changes do not invalidate a prepublication record", async (t) => {
  const fixture = await validatorFixture(t);
  const manifest = JSON.parse(await readFile(join(fixture.root, "package.json"), "utf8"));
  manifest.private = !manifest.private;
  await writeFile(join(fixture.root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(fixture.root, "package-lock.json"), `${await readFile(join(fixture.root, "package-lock.json"), "utf8")}\n`);
  await commit(fixture.root, "unrelated root metadata");
  assert.deepEqual(validateCandidatePublish({ root: fixture.root, args: validatorArgs(fixture) }), []);
});

test("wrong reviewed refs and recorded root hashes still fail closed", async (t) => {
  const wrongRef = await validatorFixture(t);
  const wrongRefRecord = JSON.parse(await readFile(wrongRef.recordPath, "utf8"));
  wrongRefRecord.reviewedCommit = "HEAD";
  wrongRefRecord.candidateReview.headSha = "HEAD";
  await writeFile(wrongRef.recordPath, `${JSON.stringify(wrongRefRecord, null, 2)}\n`);
  assert.throws(() => validateCandidatePublish({ root: wrongRef.root, args: validatorArgs(wrongRef) }), /full commit SHA/);

  const wrongHash = await validatorFixture(t);
  const wrongHashRecord = JSON.parse(await readFile(wrongHash.recordPath, "utf8"));
  wrongHashRecord.rootPackageJsonSha256 = "0".repeat(64);
  await writeFile(wrongHash.recordPath, `${JSON.stringify(wrongHashRecord, null, 2)}\n`);
  assert.ok(validateCandidatePublish({ root: wrongHash.root, args: validatorArgs(wrongHash) }).some((finding) => finding.rule === "content-join"));
});

test("prepublication selector rejects abbreviated, tag, tree, blob, and missing refs", async (t) => {
  const fixture = await validatorFixture(t);
  const record = () => ({ timing: "pre-publication", reviewedCommit: fixture.reviewedCommit });
  const tree = await gitOutput(fixture.root, ["rev-parse", `${fixture.reviewedCommit}^{tree}`]);
  assert.throws(() => qualificationJoinsRef({ ...record(), reviewedCommit: tree }, "prepublish", fixture.root), /commit object/);
  assert.throws(() => qualificationJoinsRef({ ...record(), reviewedCommit: fixture.reviewedCommit.slice(0, 12) }, "prepublish", fixture.root), /full commit SHA/);
  await execFile("git", ["tag", "-a", "reviewed-tag", "-m", "reviewed", fixture.reviewedCommit], { cwd: fixture.root });
  const tagObject = await gitOutput(fixture.root, ["rev-parse", "refs/tags/reviewed-tag^{tag}"]);
  assert.throws(() => qualificationJoinsRef({ ...record(), reviewedCommit: tagObject }, "prepublish", fixture.root), /identical commit SHA/);
  const blob = await gitOutput(fixture.root, ["rev-parse", `${fixture.reviewedCommit}:package.json`]);
  assert.throws(() => qualificationJoinsRef({ ...record(), reviewedCommit: blob }, "prepublish", fixture.root), /commit object/);
  assert.throws(() => qualificationJoinsRef({ ...record(), reviewedCommit: "f".repeat(40) }, "prepublish", fixture.root), /commit object/);
});

test("uncommitted live-root drift cannot change prepublication authority", async (t) => {
  const fixture = await validatorFixture(t);
  const manifest = JSON.parse(await readFile(join(fixture.root, "package.json"), "utf8"));
  manifest.description = `${manifest.description ?? ""} unrelated drift`;
  await writeFile(join(fixture.root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(fixture.root, "package-lock.json"), `${await readFile(join(fixture.root, "package-lock.json"), "utf8")}\n`);
  assert.deepEqual(validateCandidatePublish({ root: fixture.root, args: validatorArgs(fixture) }), []);
});

test("bootstrap validation continues to use current worktree joins", async (t) => {
  const fixture = await validatorFixture(t);
  const record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  record.timing = "post-publication-bootstrap";
  record.publishedCommit = fixture.reviewedCommit;
  record.registry = { reference: "fixture registry", ...record.candidate.tarball };
  delete record.reviewedCommit;
  delete record.rootPackageJsonSha256;
  delete record.rootPackageLockSha256;
  delete record.candidateReview;
  await writeFile(fixture.recordPath, `${JSON.stringify(record, null, 2)}\n`);
  const packageManifestPath = join(fixture.root, "packages/controller/package.json");
  const packageManifest = JSON.parse(await readFile(packageManifestPath, "utf8"));
  packageManifest.description = `${packageManifest.description ?? ""} bootstrap drift`;
  await writeFile(packageManifestPath, `${JSON.stringify(packageManifest, null, 2)}\n`);
  assert.ok(validateCandidatePublish({ root: fixture.root, args: validatorArgs(fixture, "bootstrap") }).some((finding) => finding.rule === "content-join"));
});
