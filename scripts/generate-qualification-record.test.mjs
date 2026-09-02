import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { currentQualificationJoins, parseStrictJson, qualificationPath, validateRetainedCandidateQualification } from "./lib/candidate-qualification.mjs";
import { validateCandidatePublish } from "./validate-candidate-publish.mjs";
import { argsFrom, generateQualificationRecord } from "./generate-qualification-record.mjs";

const execFile = promisify(execFileCallback);
const sourceRoot = process.cwd();
const generatorScript = join(sourceRoot, "scripts", "generate-qualification-record.mjs");
const sha = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");
const git = (root, args) => execFile("git", args, { cwd: root });
const gitOutput = async (root, args) => (await git(root, args)).stdout.trim();
const removeFixtureDirectory = (path) => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
async function commit(root, message) {
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", message]);
  return gitOutput(root, ["rev-parse", "HEAD"]);
}

/**
 * A real, hermetic release-qualification fixture built the same way
 * scripts/validate-candidate-publish.test.mjs already builds one: a
 * throwaway git repository seeded from this repository's own controller
 * package, adapter and fixtures, so `currentQualificationJoins()` computes
 * real content joins instead of stubbed ones. The transcript is a real,
 * fully-shaped v3 transcript — cloned from an already-retained record and
 * rebound to this fixture's candidate/tarball/coverage identity — so the
 * real validators accept it on its shape, not just on our say-so.
 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "generate-record-fixture-"));
  const tarRoot = await mkdtemp(join(tmpdir(), "generate-record-tar-"));
  const evidenceRoot = await mkdtemp(join(tmpdir(), "generate-record-evidence-"));
  t.after(() => Promise.all([removeFixtureDirectory(root), removeFixtureDirectory(tarRoot), removeFixtureDirectory(evidenceRoot)]));

  await git(root, ["init"]);
  // Same remedy the repository's other qualification fixtures use: a
  // short-lived fixture repo has no need of git's own background
  // maintenance, and a pack write racing teardown is not a test failure.
  await git(root, ["config", "gc.auto", "0"]);
  await git(root, ["config", "maintenance.auto", "false"]);
  await git(root, ["config", "user.email", "test@example.invalid"]);
  await git(root, ["config", "user.name", "Generator Test"]);
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

  const template = parseStrictJson(await readFile(join(sourceRoot, "governance/release-qualifications/clossys-controller-0.8.24.json"), "utf8"));
  const transcript = structuredClone(template.transcript);
  transcript.candidate = candidate;
  transcript.coverage.installedManifestSha256 = joins.packageManifestSha256;

  const packed = join(tarRoot, "candidate.tgz");
  await mkdir(join(tarRoot, "package"), { recursive: true });
  await cp(join(root, "packages/controller/package.json"), join(tarRoot, "package/package.json"));
  await execFile("tar", ["-czf", packed, "-C", tarRoot, "package"]);
  const tarballBytes = await readFile(packed);
  const tarballHashes = { sha1: sha("sha1", tarballBytes), sha256: sha("sha256", tarballBytes), sha512: sha("sha512", tarballBytes) };
  transcript.tarball = tarballHashes;
  const transcriptCopy = { ...transcript };
  delete transcriptCopy.canonicalSha256;
  transcript.canonicalSha256 = sha("sha256", JSON.stringify(transcriptCopy));

  const transcriptPath = join(evidenceRoot, "transcript.json");
  await writeFile(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`);

  return { root, candidate, joins, reviewedCommit, tarball: packed, tarballHashes, transcriptPath, transcript };
}

function argsOf(f, overrides = {}) {
  return { package: "controller", tarball: f.tarball, transcript: f.transcriptPath, "review-reference": "fixture review", ...overrides };
}

test("generator CLI has a closed argument set and requires every field", () => {
  const argv = ["node", "script", "--package", "controller", "--tarball", "candidate.tgz", "--transcript", "result.json", "--review-reference", "github-pull:1"];
  assert.deepEqual(argsFrom(argv), { package: "controller", tarball: "candidate.tgz", transcript: "result.json", "review-reference": "github-pull:1" });
  assert.deepEqual(argsFrom([...argv, "--out", "custom.json"]).out, "custom.json");
  for (const mutation of [["--unknown", "x"], ["--package", "../controller"]]) assert.throws(() => argsFrom([...argv, ...mutation]), /Usage:/);
  assert.throws(() => argsFrom(argv.slice(0, -2)), /Usage:/, "missing --review-reference must be rejected");
  assert.throws(() => argsFrom([...argv.slice(0, -1), "   "]), /Usage:/, "a blank review reference must be rejected");
});

test("generator derives a full retained record from a real qualify artifact", async (t) => {
  const f = await fixture(t);
  const result = generateQualificationRecord({ root: f.root, args: argsOf(f) });
  assert.equal(result.record.schemaVersion, 2);
  assert.equal(result.record.timing, "pre-publication");
  assert.deepEqual(result.record.candidate, {
    name: f.candidate.name,
    version: f.candidate.version,
    packageTreeSha1: f.joins.packageTreeSha1,
    packageManifestSha256: f.joins.packageManifestSha256,
    policySha256: f.joins.policySha256,
    adapterSha256: f.joins.adapterSha256,
    fixtureSetSha256: f.joins.fixtureSetSha256,
    tarball: f.tarballHashes,
  });
  assert.deepEqual(result.record.archetypes, f.joins.archetypes);
  assert.equal(result.record.reviewedCommit, f.reviewedCommit);
  assert.equal(result.record.rootPackageJsonSha256, f.joins.rootPackageJsonSha256);
  assert.equal(result.record.rootPackageLockSha256, f.joins.rootPackageLockSha256);
  assert.deepEqual(result.record.transcript, f.transcript);
  assert.deepEqual(result.record.candidateReview, { headSha: f.reviewedCommit, reference: "fixture review" });
  assert.deepEqual(result.record.findings, []);
  assert.equal(result.recordPath, qualificationPath(f.root, f.candidate, f.reviewedCommit));
});

test("generator CLI writes the record at its canonical governance path and exits 0", async (t) => {
  const f = await fixture(t);
  const { stdout } = await execFile(process.execPath, [generatorScript, "--package", "controller", "--tarball", f.tarball, "--transcript", f.transcriptPath, "--review-reference", "fixture review"], { cwd: f.root });
  assert.match(stdout, /QUALIFICATION RECORD WRITTEN/);
  const recordPath = join(f.root, qualificationPath(f.root, f.candidate, f.reviewedCommit));
  assert.ok(existsSync(recordPath), "record file must exist at its canonical path");
  const written = parseStrictJson(await readFile(recordPath, "utf8"));
  assert.deepEqual(written.candidate.tarball, f.tarballHashes);
});

test("generator CLI refuses to overwrite an existing record and exits 1", async (t) => {
  const f = await fixture(t);
  const args = [generatorScript, "--package", "controller", "--tarball", f.tarball, "--transcript", f.transcriptPath, "--review-reference", "fixture review"];
  await execFile(process.execPath, args, { cwd: f.root });
  await assert.rejects(
    execFile(process.execPath, args, { cwd: f.root }),
    (error) => error.code === 1 && /refusing to overwrite/.test(error.stderr),
  );
});

test("a tarball that does not match the transcript's own digests is refused (exit 1)", async (t) => {
  const f = await fixture(t);
  const badTarball = join(dirname(f.tarball), "other.tgz");
  await writeFile(badTarball, Buffer.concat([await readFile(f.tarball), Buffer.from("x")]));
  await assert.rejects(
    execFile(process.execPath, [generatorScript, "--package", "controller", "--tarball", badTarball, "--transcript", f.transcriptPath, "--review-reference", "fixture review"], { cwd: f.root }),
    (error) => error.code === 1 && /do not match the digests recorded in the transcript/.test(error.stderr),
  );
});

test("an unresolvable policy package key is indeterminate (exit 2)", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    execFile(process.execPath, [generatorScript, "--package", "not-a-real-package", "--tarball", f.tarball, "--transcript", f.transcriptPath, "--review-reference", "fixture review"], { cwd: f.root }),
    (error) => error.code === 2,
  );
});

test("reviewedCommit is refused once git HEAD no longer corroborates the transcript's manifest digest (exit 1)", async (t) => {
  const f = await fixture(t);
  const manifestPath = join(f.root, "packages/controller/package.json");
  const manifest = parseStrictJson(await readFile(manifestPath, "utf8"));
  manifest.description = `${manifest.description ?? ""} (drifted after review, for this test only)`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await commit(f.root, "drift the manifest after the reviewed commit");
  await assert.rejects(
    execFile(process.execPath, [generatorScript, "--package", "controller", "--tarball", f.tarball, "--transcript", f.transcriptPath, "--review-reference", "fixture review"], { cwd: f.root }),
    (error) => error.code === 1 && /reviewedCommit could not be corroborated/.test(error.stderr),
  );
});

test("a generated record is accepted by the real prepublish validator", async (t) => {
  const f = await fixture(t);
  const result = generateQualificationRecord({ root: f.root, args: argsOf(f) });
  await mkdir(dirname(result.outPath), { recursive: true });
  await writeFile(result.outPath, `${JSON.stringify(result.record, null, 2)}\n`);
  const findings = validateCandidatePublish({ root: f.root, args: { package: "controller", tarball: f.tarball, transcript: f.transcriptPath, mode: "prepublish" } });
  assert.deepEqual(findings, []);
});

test("a generated record satisfies the retained-record validator check-candidate-qualification.mjs runs per record", async (t) => {
  const f = await fixture(t);
  const result = generateQualificationRecord({ root: f.root, args: argsOf(f) });
  await mkdir(dirname(result.outPath), { recursive: true });
  await writeFile(result.outPath, `${JSON.stringify(result.record, null, 2)}\n`);
  await commit(f.root, "retain candidate record");
  const findings = validateRetainedCandidateQualification(result.record, { root: f.root, path: result.recordPath, expectedPath: result.recordPath });
  assert.deepEqual(findings, []);
});

test("negative control: a mutated candidate.tarball.sha256 is rejected by both real validators, naming transcript-join and/or tarball", async (t) => {
  const f = await fixture(t);
  const result = generateQualificationRecord({ root: f.root, args: argsOf(f) });
  const mutated = structuredClone(result.record);
  const original = mutated.candidate.tarball.sha256;
  mutated.candidate.tarball.sha256 = original.slice(0, -1) + (original.endsWith("0") ? "1" : "0");
  assert.notEqual(mutated.candidate.tarball.sha256, original);

  await mkdir(dirname(result.outPath), { recursive: true });
  await writeFile(result.outPath, `${JSON.stringify(mutated, null, 2)}\n`);
  await commit(f.root, "retain mutated candidate record (negative control)");

  // check-candidate-qualification.mjs's own per-record validator.
  const retainedFindings = validateRetainedCandidateQualification(mutated, { root: f.root, path: result.recordPath, expectedPath: result.recordPath });
  assert.ok(retainedFindings.some((item) => item.rule === "transcript-join"), `expected a transcript-join finding, got: ${JSON.stringify(retainedFindings)}`);

  // validate-candidate-publish.mjs's own validator, against the real tarball bytes on disk.
  const publishFindings = validateCandidatePublish({ root: f.root, args: { package: "controller", tarball: f.tarball, transcript: f.transcriptPath, mode: "prepublish" } });
  assert.ok(publishFindings.some((item) => ["transcript-join", "tarball"].includes(item.rule)), `expected transcript-join and/or tarball, got: ${JSON.stringify(publishFindings)}`);
});
