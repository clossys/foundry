import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { argsFrom, assertEvidenceNpmFloor, buildLaterPublicationRecord, createLaterPublicationRecord, credentiallessAuditEnv, EVIDENCE_NPM_MIN_MAJOR, requireEvidenceNpm, resolveEvidenceNpm, verifiedAnonymousAudit, writeNoOverwrite } from "./record-later-publication.mjs";
import { buildPublicationRecordWithFallback, verifyPublicationProvenance } from "./lib/publication-evidence-run.mjs";
import { comparableTranscriptSha256, currentQualificationJoins } from "./lib/candidate-qualification.mjs";
import { publicNpmVersionUrl, PUBLIC_NPM_REGISTRY } from "./lib/public-npm-registry.mjs";

const hex = (value, length) => value.repeat(length);
const digest = (algorithm, value) => createHash(algorithm).update(value).digest("hex");
const candidateBytes = Buffer.from("candidate bytes");
// The recorder resolves npm once on PATH and runs that absolute path. Tests
// inject an existence predicate that accepts every candidate, so the first PATH
// entry ("/usr/bin" for an empty environment) supplies the resolved path.
const NPM = "/usr/bin/npm";
const anyExecutable = () => true;
// A run seam that answers the npm version probe and records every command the
// recorder runs. `answer` supplies the result of any other command.
function npmProbe({ version = "11.17.0\n", answer = () => "" } = {}) {
  const calls = [];
  const run = (file, args, options) => {
    calls.push([file, ...args]);
    if (args[0] === "--version") {
      if (version instanceof Error) throw version;
      return version;
    }
    return answer(file, args, options);
  };
  return { run, calls };
}
const FLOOR_REFUSAL = /evidence recording requires npm 11 or newer for "npm audit signatures --include-attestations" and "npm pack --dry-run"; observed npm /;
const candidate = {
  name: "@clossys/strategist", version: "0.1.1", packageTreeSha1: hex("a", 40), packageManifestSha256: hex("b", 64),
  policySha256: hex("c", 64), adapterSha256: hex("d", 64), fixtureSetSha256: hex("e", 64),
  tarball: { sha1: hex("f", 40), sha256: hex("1", 64), sha512: hex("2", 128) },
};
const qualification = {
  schemaVersion: 2, timing: "pre-publication", candidate,
  archetypes: ["current-direct", "prior-minor", "oldest-supported", "control-plane"].map((kind) => ({ kind, status: "unsupported" })),
  reviewedCommit: hex("3", 40), rootPackageJsonSha256: hex("4", 64), rootPackageLockSha256: hex("5", 64),
  transcript: { canonicalSha256: hex("b", 64) },
};
const qualificationBytes = Buffer.from("qualification bytes\n");
const catalogBytes = Buffer.from("catalog bytes\n");
const catalog = { defaultTarget: "clossys-npmjs", targets: [{ id: "clossys-npmjs", status: "active", packages: ["strategist"] }] };
const publication = {
  mode: "trusted-publisher", publishedAt: "2026-08-31T00:00:00.000Z", reference: "https://github.com/clossys/foundry/actions/runs/123",
  provenance: {
    repository: "https://github.com/clossys/foundry", workflow: ".github/workflows/publish.yml", ref: "refs/heads/main", event: "workflow_dispatch",
    sourceSha: hex("6", 40), builder: "https://github.com/actions/runner/github-hosted", invocation: "https://github.com/clossys/foundry/actions/runs/123/attempts/1",
    attestationUrl: `${PUBLIC_NPM_REGISTRY}/-/npm/v1/attestations/%40clossys%2Fstrategist%400.1.1`,
  },
};
const proof = {
  schemaVersion: 2, kind: "public-npm-anonymous-registry-proof-v2", evidence: {
    registry: PUBLIC_NPM_REGISTRY, access: "anonymous", name: candidate.name, version: candidate.version,
    metadataUrl: publicNpmVersionUrl(PUBLIC_NPM_REGISTRY, candidate.name, candidate.version), repository: "clossys/foundry",
    tarballUrl: `${PUBLIC_NPM_REGISTRY}/@clossys/strategist/-/strategist-0.1.1.tgz`, integrity: `sha512-${Buffer.from(candidate.tarball.sha512, "hex").toString("base64")}`,
    shasum: candidate.tarball.sha1, sha256: candidate.tarball.sha256, sha512: candidate.tarball.sha512, packedManifestSha256: candidate.packageManifestSha256, size: candidateBytes.length,
  },
};

function build(overrides = {}) {
  return buildLaterPublicationRecord({
    packageKey: "strategist", qualificationPath: "governance/release-qualifications/clossys-strategist-0.1.1.json", qualification,
    qualificationBytes, candidateBytes, proof, catalog, catalogBytes, publication,
    recordPath: "governance/release-publications/later/strategist-0.1.1.json", provenanceSourceValid: true, ...overrides,
  });
}

// A retained record supplies the real schema; every field that binds a specific
// tree — the version, the digests, the reviewed commit — is derived from the
// package actually packed below. The template's own version is therefore
// irrelevant, which is the point: a catalogue-wide bump must not stale a test
// about the creator's behaviour.
const QUALIFICATION_TEMPLATE = "governance/release-qualifications/clossys-strategist-0.1.2.json";
function syntheticQualification({ root, base, version, hashes }) {
  const qualification = JSON.parse(readFileSync(join(process.cwd(), QUALIFICATION_TEMPLATE), "utf8"));
  const joins = currentQualificationJoins(root, { name: qualification.candidate.name, version }, base, { schemaVersion: qualification.schemaVersion });
  qualification.reviewedCommit = base;
  qualification.candidateReview.headSha = base;
  qualification.candidate.version = version;
  qualification.candidate.packageTreeSha1 = joins.packageTreeSha1;
  qualification.candidate.packageManifestSha256 = joins.packageManifestSha256;
  qualification.candidate.policySha256 = joins.policySha256;
  qualification.candidate.adapterSha256 = joins.adapterSha256;
  qualification.candidate.fixtureSetSha256 = joins.fixtureSetSha256;
  qualification.candidate.tarball = hashes;
  qualification.rootPackageJsonSha256 = joins.rootPackageJsonSha256;
  qualification.rootPackageLockSha256 = joins.rootPackageLockSha256;
  qualification.archetypes = joins.archetypes;
  qualification.transcript.candidate.version = version;
  qualification.transcript.coverage.installedManifestSha256 = qualification.candidate.packageManifestSha256;
  qualification.transcript.tarball = hashes;
  qualification.transcript.dimensions = joins.dimensions;
  const transcriptForDigest = { ...qualification.transcript };
  delete transcriptForDigest.canonicalSha256;
  qualification.transcript.canonicalSha256 = digest("sha256", JSON.stringify(transcriptForDigest));
  return qualification;
}

test("creator emits exactly the closed later-publication v2 shape", () => {
  const result = build();
  assert.deepEqual(Object.keys(result.record), ["schemaVersion", "kind", "qualification", "candidate", "source", "catalog", "publication", "registryProof"]);
  assert.equal(result.record.schemaVersion, 2);
  assert.equal(result.record.kind, "foundry-trusted-publication-v2");
  assert.equal(result.record.qualification.sha256, digest("sha256", qualificationBytes));
  assert.equal(result.record.catalog.sha256, digest("sha256", catalogBytes));
});

test("creator rejects proof, publication, and path substitutions", () => {
  for (const mutation of [
    (value) => { value.proof = structuredClone(proof); value.proof.evidence.sha256 = hex("0", 64); return value; },
    (value) => { value.publication = { ...publication, extra: "unexpected" }; return value; },
    (value) => { value.qualificationPath = "governance/release-qualifications/../../outside.json"; return value; },
    (value) => { value.proof = { ...proof, schemaVersion: 1 }; return value; },
  ]) assert.throws(() => build(mutation({})), /invalid|unknown|canonical|proof|path/);
});

test("creator emits a v3 record only for closed replay evidence and never changes v2", () => {
  const replay = {
    source: {
      reviewedCommit: qualification.reviewedCommit,
      qualificationRoots: { packageJsonSha256: qualification.rootPackageJsonSha256, packageLockSha256: qualification.rootPackageLockSha256 },
      publicationSource: { sha: publication.provenance.sourceSha, rootPackageJsonSha256: hex("7", 64), rootPackageLockSha256: hex("8", 64) },
    },
    runQualification: {
      run: { id: 123, url: "https://github.com/clossys/foundry/actions/runs/123", headSha: publication.provenance.sourceSha, conclusion: "failure", qualificationJob: { id: 124, name: "qualify (strategist)", conclusion: "success", url: "https://github.com/clossys/foundry/actions/runs/123/job/124" } },
      artifact: { id: 125, name: "qualified-candidate-strategist", archiveSha256: `sha256:${hex("9", 64)}`, size: 42, url: "https://api.github.com/repos/clossys/foundry/actions/artifacts/125/zip" },
      transcript: { rawSha256: hex("a", 64), canonicalSha256: hex("b", 64), candidateTarball: structuredClone(candidate.tarball) },
      publicationJob: { id: 126, name: "publish (strategist)", conclusion: "success", url: "https://github.com/clossys/foundry/actions/runs/123/job/126" },
      anonymousRegistry: { packumentSha256: hex("c", 64), auditSha256: hex("d", 64), provenanceBundleSha256: hex("e", 64), signatureSha256: hex("f", 64), signatureKeyids: ["SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U"], attestationUrl: publication.provenance.attestationUrl },
    },
    sourceEvidence: { valid: true },
  };
  const result = build({ replay });
  assert.equal(result.record.schemaVersion, 3);
  assert.equal(result.record.kind, "foundry-trusted-publication-replay-v3");
  assert.deepEqual(Object.keys(result.record), ["schemaVersion", "kind", "qualification", "candidate", "source", "catalog", "publication", "registryProof", "runQualification"]);
  assert.throws(() => build({ replay: { ...replay, runQualification: { ...replay.runQualification, publicationJob: { ...replay.runQualification.publicationJob, conclusion: "failure" } } } }), /invalid/);
});

test("output is atomic and never overwrites an existing record", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "record-later-publication-output-")));
  try {
    const destination = join(root, "record.json"), bytes = Buffer.from("record\n");
    writeNoOverwrite(destination, bytes);
    assert.deepEqual(readFileSync(destination), bytes);
    assert.throws(() => writeNoOverwrite(destination, Buffer.from("replacement\n")));
    const target = join(root, "target"), symlink = join(root, "symlink.json");
    writeFileSync(target, "target\n"); symlinkSync(target, symlink);
    assert.throws(() => writeNoOverwrite(symlink, bytes));
    assert.equal(readFileSync(target, "utf8"), "target\n");
    const directory = join(root, "directory"), directoryLink = join(root, "directory-link");
    mkdirSync(directory); symlinkSync(directory, directoryLink);
    assert.throws(() => writeNoOverwrite(join(directoryLink, "record.json"), bytes), /directory/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("creator writes one canonical owner-present record in a synthetic git repository", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "record-later-publication-e2e-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceRoot = process.cwd();
  const copied = [
    "package.json", "package-lock.json", "package-scope.json", "governance/release-catalog.json",
    "governance/release-qualification-policy.json", "governance/release-qualification-adapters/strategist",
    "governance/release-qualification-fixtures/strategist", "packages/strategist",
  ];
  for (const path of copied) cpSync(join(sourceRoot, path), join(root, path), { recursive: true });
  mkdirSync(join(root, "governance/release-publications/later"), { recursive: true });
  mkdirSync(join(root, "governance/release-qualifications"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "record test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "synthetic qualification base"], { cwd: root });
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

  const packDirectory = join(root, ".pack-output");
  mkdirSync(packDirectory);
  execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", packDirectory, "--workspace=packages/strategist"], { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
  // Derived, not hardcoded: the packed filename carries strategist's current
  // version, so pinning it here breaks on every version bump.
  const candidatePath = join(packDirectory, readdirSync(packDirectory).find((entry) => entry.endsWith(".tgz")));
  const candidateBytesForRecord = readFileSync(candidatePath);
  const hashes = { sha1: digest("sha1", candidateBytesForRecord), sha256: digest("sha256", candidateBytesForRecord), sha512: digest("sha512", candidateBytesForRecord) };
  const manifestBytes = readFileSync(join(root, "packages/strategist/package.json"));
  const version = JSON.parse(manifestBytes).version;
  const qualification = syntheticQualification({ root, base, manifestBytes, version, hashes });
  const qualificationPath = `governance/release-qualifications/clossys-strategist-${version}.json`;
  writeFileSync(join(root, qualificationPath), `${JSON.stringify(qualification, null, 2)}\n`);
  execFileSync("git", ["add", qualificationPath], { cwd: root });
  execFileSync("git", ["commit", "-qm", "synthetic qualification record"], { cwd: root });

  const proof = {
    schemaVersion: 2, kind: "public-npm-anonymous-registry-proof-v2", evidence: {
      registry: PUBLIC_NPM_REGISTRY, access: "anonymous", name: qualification.candidate.name, version: qualification.candidate.version,
      metadataUrl: publicNpmVersionUrl(PUBLIC_NPM_REGISTRY, qualification.candidate.name, qualification.candidate.version), repository: "clossys/foundry",
      tarballUrl: `${PUBLIC_NPM_REGISTRY}/@clossys/strategist/-/strategist-${version}.tgz`, integrity: `sha512-${Buffer.from(hashes.sha512, "hex").toString("base64")}`,
      shasum: hashes.sha1, sha256: hashes.sha256, sha512: hashes.sha512, packedManifestSha256: digest("sha256", manifestBytes), size: candidateBytesForRecord.length,
    },
  };
  const proofPath = join(root, "registry-proof.json");
  writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  const publicationPath = join(root, "publication-evidence.json");
  writeFileSync(publicationPath, `${JSON.stringify({ mode: "owner-present", publishedAt: "2026-08-31T00:00:00.000Z", reference: `https://registry.npmjs.org/%40clossys%2Fstrategist/${version}` }, null, 2)}\n`);

  // The direct join runs no signature audit, yet the npm floor still applies to
  // it. `direct.calls` lists every command the recorder ran through its seam.
  const direct = npmProbe();
  const call = () => createLaterPublicationRecord({
    root, packageKey: "strategist", qualificationPath: join(root, qualificationPath), candidatePath, proofPath, publicationPath, env: {}, auditRun: direct.run, isExecutable: anyExecutable,
  });
  const result = await call();
  assert.deepEqual(direct.calls, [[NPM, "--version"]], "the direct join reads the npm version once and runs no audit");
  assert.equal(result.path, `governance/release-publications/later/strategist-${version}.json`);
  assert.equal(result.record.kind, "foundry-later-publication-v1");
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(root, result.path), "utf8"))), ["schemaVersion", "kind", "qualification", "candidate", "source", "catalog", "publication", "registryProof"]);
  assert.deepEqual(readdirSync(join(root, "governance/release-publications/later")), [`strategist-${version}.json`]);
  assert.deepEqual(readFileSync(join(root, result.path)), result.bytes);

  // The qualification above is derived from the very tree it qualifies, so the
  // manifest join is satisfied by construction and would no longer be exercised
  // by the happy path alone. Drift the live manifest and assert the creator
  // still refuses: that refusal is the property these tests exist to defend,
  // and it must not rest on a package's version happening to be stale.
  writeFileSync(join(root, "packages/strategist/package.json"), `${manifestBytes.toString("utf8")}\n`);
  await assert.rejects(call(), /current package manifest does not match the immutable qualification/);
  assert.deepEqual(readdirSync(join(root, "governance/release-publications/later")), [`strategist-${version}.json`]);
});

// Builds a synthetic qualified repository, applies the requested root drift
// (and optional package-owned change) at the publication source, and runs the
// creator's replay path against it. Returns the creator result or its rejection.
// `changedTarball` repacks after qualification so the served candidate bytes
// differ while the qualification still names the original tarball. `prepareOnly`
// returns that repository without calling the creator, so a caller can drive
// the real fallback with the same fixture.
async function replayScenario(t, { driftFiles = ["package.json", "package-lock.json"], packageChange = false, expectRecord = true, refusal, changedTarball = false, prepareOnly = false, npmVersion = "11.17.0\n", env = {}, isExecutable = anyExecutable } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "record-later-publication-replay-e2e-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceRoot = process.cwd();
  const copied = [
    "package.json", "package-lock.json", "package-scope.json", "governance/release-catalog.json",
    "governance/release-qualification-policy.json", "governance/release-qualification-adapters/strategist",
    "governance/release-qualification-fixtures/strategist", "packages/strategist",
  ];
  for (const path of copied) cpSync(join(sourceRoot, path), join(root, path), { recursive: true });
  mkdirSync(join(root, "governance/release-publications/later"), { recursive: true });
  mkdirSync(join(root, "governance/release-qualifications"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "record test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "synthetic qualification base"], { cwd: root });
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

  const packDirectory = join(root, ".pack-output");
  mkdirSync(packDirectory);
  execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", packDirectory, "--workspace=packages/strategist"], { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
  // Derived, not hardcoded: the packed filename carries strategist's current
  // version, so pinning it here breaks on every version bump.
  const candidatePath = join(packDirectory, readdirSync(packDirectory).find((entry) => entry.endsWith(".tgz")));
  const qualifiedBytes = readFileSync(candidatePath);
  const hashes = { sha1: digest("sha1", qualifiedBytes), sha256: digest("sha256", qualifiedBytes), sha512: digest("sha512", qualifiedBytes) };
  const manifestBytes = readFileSync(join(root, "packages/strategist/package.json"));
  const version = JSON.parse(manifestBytes).version;
  const qualification = syntheticQualification({ root, base, manifestBytes, version, hashes });
  const qualificationPath = `governance/release-qualifications/clossys-strategist-${version}.json`;
  writeFileSync(join(root, qualificationPath), `${JSON.stringify(qualification, null, 2)}\n`);
  execFileSync("git", ["add", qualificationPath], { cwd: root });
  execFileSync("git", ["commit", "-qm", "synthetic qualification record"], { cwd: root });

  // The replay exception is only for raw root-resolution drift; changing
  // whitespace keeps both root files valid while changing their byte hashes.
  for (const file of driftFiles) writeFileSync(join(root, file), `${readFileSync(join(root, file), "utf8")}\n`);
  if (packageChange) writeFileSync(join(root, "packages/strategist", packageChange), "placeholder change\n");
  execFileSync("git", ["add", "-A", ...driftFiles, ...(packageChange ? ["packages/strategist"] : [])], { cwd: root });
  execFileSync("git", ["commit", "-qm", "synthetic root resolution drift", "--allow-empty"], { cwd: root });
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

  // A changed tarball is a second pack of a shipped file, after the source
  // commit. The qualification, the proof, and the registry bytes below keep
  // the original digests; only the candidate the creator reads changes.
  let creatorBytes = qualifiedBytes;
  if (changedTarball) {
    const readmePath = join(root, "packages/strategist/README.md");
    writeFileSync(readmePath, `${readFileSync(readmePath, "utf8")}\n`);
    const repackDirectory = join(root, ".pack-output-changed");
    mkdirSync(repackDirectory);
    execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", repackDirectory, "--workspace=packages/strategist"], { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
    creatorBytes = readFileSync(join(repackDirectory, readdirSync(repackDirectory).find((entry) => entry.endsWith(".tgz"))));
    if (creatorBytes.equals(qualifiedBytes)) throw new Error("changed-tarball fixture packed identical bytes");
    writeFileSync(candidatePath, creatorBytes);
  }

  const replayProof = {
    schemaVersion: 2, kind: "public-npm-anonymous-registry-proof-v2", evidence: {
      registry: PUBLIC_NPM_REGISTRY, access: "anonymous", name: qualification.candidate.name, version: qualification.candidate.version,
      metadataUrl: publicNpmVersionUrl(PUBLIC_NPM_REGISTRY, qualification.candidate.name, qualification.candidate.version), repository: "clossys/foundry",
      tarballUrl: `${PUBLIC_NPM_REGISTRY}/@clossys/strategist/-/strategist-${version}.tgz`, integrity: `sha512-${Buffer.from(hashes.sha512, "hex").toString("base64")}`,
      shasum: hashes.sha1, sha256: hashes.sha256, sha512: hashes.sha512, packedManifestSha256: digest("sha256", manifestBytes), size: qualifiedBytes.length,
    },
  };
  const proofPath = join(root, "registry-proof.json");
  writeFileSync(proofPath, `${JSON.stringify(replayProof, null, 2)}\n`);
  const runId = 777, artifactId = 778;
  const publicationPath = join(root, "publication-evidence.json");
  const attestationUrl = `${PUBLIC_NPM_REGISTRY}/-/npm/v1/attestations/%40clossys%2Fstrategist%40${version}`;
  writeFileSync(publicationPath, `${JSON.stringify({
    mode: "trusted-publisher", publishedAt: "2026-08-31T00:00:00.000Z", reference: `https://github.com/clossys/foundry/actions/runs/${runId}`,
    provenance: {
      repository: "https://github.com/clossys/foundry", workflow: ".github/workflows/publish.yml", ref: "refs/heads/main", event: "workflow_dispatch",
      sourceSha, builder: "https://github.com/actions/runner/github-hosted", invocation: `https://github.com/clossys/foundry/actions/runs/${runId}/attempts/1`, attestationUrl,
    },
  }, null, 2)}\n`);
  const archiveDirectory = join(root, ".qualified-artifact");
  mkdirSync(archiveDirectory);
  writeFileSync(join(archiveDirectory, "candidate.tgz"), creatorBytes);
  writeFileSync(join(archiveDirectory, "transcript.json"), `${JSON.stringify(qualification.transcript, null, 2)}\n`);
  const archivePath = join(root, "qualified-candidate.zip");
  execFileSync("zip", ["-q", archivePath, "candidate.tgz", "transcript.json"], { cwd: archiveDirectory });
  const archiveBytes = readFileSync(archivePath);
  const replayEvidencePath = join(root, "replay-evidence.json");
  writeFileSync(replayEvidencePath, `${JSON.stringify({ schemaVersion: 1, kind: "foundry-trusted-publication-replay-input-v1", runId, artifactId })}\n`);

  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: `pkg:npm/%40clossys/strategist@${version}`, digest: { sha512: hashes.sha512 } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: { workflow: { repository: "https://github.com/clossys/foundry", path: ".github/workflows/publish.yml", ref: "refs/heads/main" } },
        internalParameters: { github: { event_name: "workflow_dispatch" } },
        resolvedDependencies: [{ uri: "git+https://github.com/clossys/foundry@refs/heads/main", digest: { gitCommit: sourceSha } }],
      },
      runDetails: { builder: { id: "https://github.com/actions/runner/github-hosted" }, metadata: { invocationId: `https://github.com/clossys/foundry/actions/runs/${runId}/attempts/1` } },
    },
  };
  const bundle = { predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") } } };
  const packument = { versions: { [qualification.candidate.version]: { name: qualification.candidate.name, version: qualification.candidate.version, dist: { integrity: replayProof.evidence.integrity, signatures: [{ keyid: "SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U" }], attestations: { url: attestationUrl } } } } };
  const audit = { invalid: [], missing: [], verified: [{ name: qualification.candidate.name, version: qualification.candidate.version, registry: "https://registry.npmjs.org/", attestations: { url: attestationUrl, provenance: { predicateType: "https://slsa.dev/provenance/v1" } }, attestationBundles: [bundle] }] };
  const fetched = []; // every URL the recorder fetched, so a test can prove a refusal came before any network read
  const fetchImpl = async (url) => {
    fetched.push(String(url));
    const response = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url.endsWith(`/actions/runs/${runId}`)) return response({ id: runId, head_sha: sourceSha, event: "workflow_dispatch", conclusion: "success" });
    if (url.endsWith(`/actions/artifacts/${artifactId}`)) return response({ id: artifactId, name: "qualified-candidate-strategist", digest: `sha256:${digest("sha256", archiveBytes)}`, size_in_bytes: archiveBytes.length, archive_download_url: `https://api.github.com/repos/clossys/foundry/actions/artifacts/${artifactId}/zip`, workflow_run: { id: runId, head_sha: sourceSha } });
    if (url.endsWith(`/actions/runs/${runId}/jobs?per_page=100`)) return response({ jobs: [
      { id: 779, name: "qualify (strategist)", conclusion: "success", html_url: `https://github.com/clossys/foundry/actions/runs/${runId}/job/779` },
      { id: 780, name: "publish (strategist)", conclusion: "success", html_url: `https://github.com/clossys/foundry/actions/runs/${runId}/job/780` },
    ] });
    if (url === `https://registry.npmjs.org/${encodeURIComponent(qualification.candidate.name)}`) return response(packument);
    if (url === replayProof.evidence.metadataUrl) return response({
      name: qualification.candidate.name, version: qualification.candidate.version,
      repository: { type: "git", url: "git+https://github.com/clossys/foundry.git" },
      dist: { tarball: replayProof.evidence.tarballUrl, integrity: replayProof.evidence.integrity, shasum: hashes.sha1 },
    });
    if (url === replayProof.evidence.tarballUrl) return {
      ok: true, status: 200,
      headers: { get: (name) => String(name).toLowerCase() === "content-length" ? String(qualifiedBytes.length) : null },
      arrayBuffer: async () => Uint8Array.from(qualifiedBytes).buffer,
      json: async () => { throw new Error("tarball is not JSON"); },
    };
    throw new Error(`unexpected fetch ${url}`);
  };
  // The audit seam also answers the recorder's npm floor probe. `probes` lists
  // every command the recorder ran, so a test can assert it never asked for
  // the Node or zlib version and that every command used the resolved npm.
  const { run: auditRun, calls: probes } = npmProbe({ version: npmVersion, answer: (_file, args) => args[0] === "audit" ? JSON.stringify(audit) : "" });

  const harness = {
    root, qualification, archiveBytes, version, sourceSha, publicationPath, qualificationPath, fetchImpl, auditRun, runId, artifactId, probes, isExecutable,
  };
  if (prepareOnly) return harness;
  const run = () => createLaterPublicationRecord({
    root, packageKey: "strategist", qualificationPath: join(root, qualificationPath), candidatePath, proofPath, publicationPath,
    artifactArchivePath: archivePath, replayEvidencePath, fetchImpl, auditRun, env, isExecutable,
  });
  if (!expectRecord) {
    await assert.rejects(run(), refusal);
    assert.deepEqual(readdirSync(join(root, "governance/release-publications/later")), []);
    return { root, probes, fetched };
  }
  const result = await run();
  return { root, result, qualification, archiveBytes, version, probes, fetched };
}

test("creator retains one provider-bound replay record from the exact qualified archive", async (t) => {
  const { root, result, qualification, archiveBytes, version } = await replayScenario(t);
  assert.equal(result.record.kind, "foundry-trusted-publication-replay-v3");
  assert.equal(result.record.publication.reference, result.record.runQualification.run.url);
  assert.equal(result.record.runQualification.artifact.archiveSha256, `sha256:${digest("sha256", archiveBytes)}`);
  assert.equal(result.record.runQualification.transcript.rawSha256, digest("sha256", Buffer.from(`${JSON.stringify(qualification.transcript, null, 2)}\n`)));
  assert.equal(result.record.runQualification.transcript.comparableSha256, comparableTranscriptSha256(qualification.transcript));
  assert.deepEqual(readdirSync(join(root, "governance/release-publications/later")), [`strategist-${version}.json`]);
});

test("creator records the v3 replay when only the root package-lock hash drifted, and the record validates", async (t) => {
  const { root, result, qualification, version } = await replayScenario(t, { driftFiles: ["package-lock.json"] });
  assert.equal(result.record.kind, "foundry-trusted-publication-replay-v3");
  const roots = result.record.source.qualificationRoots;
  const measured = result.record.source.publicationSource;
  assert.equal(roots.packageJsonSha256, qualification.rootPackageJsonSha256);
  assert.equal(measured.rootPackageJsonSha256, qualification.rootPackageJsonSha256, "unchanged root package.json hash is recorded truthfully");
  assert.notEqual(measured.rootPackageLockSha256, qualification.rootPackageLockSha256);
  assert.equal(measured.rootPackageLockSha256, digest("sha256", readFileSync(join(root, "package-lock.json"))));
  assert.deepEqual(readdirSync(join(root, "governance/release-publications/later")), [`strategist-${version}.json`]);
});

test("creator records the v3 replay when only the root package.json hash drifted", async (t) => {
  const { result, qualification } = await replayScenario(t, { driftFiles: ["package.json"] });
  const measured = result.record.source.publicationSource;
  assert.notEqual(measured.rootPackageJsonSha256, qualification.rootPackageJsonSha256);
  assert.equal(measured.rootPackageLockSha256, qualification.rootPackageLockSha256);
});

test("creator refuses the v3 replay with a fixed reason when neither root hash drifted", async (t) => {
  await replayScenario(t, { driftFiles: [], expectRecord: false, refusal: /replay v3 is reserved for drift in at least one root resolution hash/ });
});

test("creator still refuses lock-only drift when a package-owned file also changed", async (t) => {
  await replayScenario(t, { driftFiles: ["package-lock.json"], packageChange: "PLACEHOLDER.txt", expectRecord: false, refusal: /only the two root resolution hashes may differ/ });
});

// Lock-only drift does not waive the tarball join. The candidate bytes are a
// second pack of a shipped file; the qualification still names the first pack.
// The refusal is the creator's tarball comparison, which runs before the
// drift decision, so removing that comparison changes this error.
test("creator refuses lock-only drift when the candidate tarball also changed", async (t) => {
  await replayScenario(t, {
    driftFiles: ["package-lock.json"], changedTarball: true, expectRecord: false,
    refusal: /candidate tarball differs from the qualification record/,
  });
});

// The direct join fails because only the lock hash drifted. Record creation
// is the real creator. The fallback does not forward the creator's audit seam,
// so this test supplies the same one the other creator tests use; it does not
// substitute a record. Removing the
// fallback leaves the direct failure, and reserving v3 for both-hash drift
// makes the second attempt fail too.
test("direct join failure records lock-only drift through the real v3 replay", async (t) => {
  const harness = await replayScenario(t, { driftFiles: ["package-lock.json"], prepareOnly: true });
  const attempts = [];
  const createRecord = async (options) => {
    attempts.push(options.artifactArchivePath === undefined ? "direct" : "replay");
    return createLaterPublicationRecord({ ...options, auditRun: harness.auditRun, isExecutable: harness.isExecutable });
  };
  const tempDir = mkdtempSync(join(harness.root, "fallback-"));
  const result = await buildPublicationRecordWithFallback({
    root: harness.root,
    packageKey: "strategist",
    qualificationPath: join(harness.root, harness.qualificationPath),
    publicationPath: harness.publicationPath,
    fetchImpl: harness.fetchImpl,
    env: {},
    runId: harness.runId,
    runAttempt: 1,
    name: harness.qualification.candidate.name,
    version: harness.version,
    sourceSha: harness.sourceSha,
    auditRun: harness.auditRun,
    tempDir,
    findArtifact: async () => ({ id: harness.artifactId, name: "qualified-candidate-strategist" }),
    downloadZip: async () => harness.archiveBytes,
    createRecord,
    verifyProvenance: (options) => verifyPublicationProvenance({ ...options, isExecutable: harness.isExecutable }),
  });
  assert.deepEqual(attempts, ["direct", "replay"]);
  assert.equal(result.record.schemaVersion, 3);
  assert.equal(result.record.kind, "foundry-trusted-publication-replay-v3");
  assert.equal(result.record.source.publicationSource.rootPackageJsonSha256, harness.qualification.rootPackageJsonSha256);
  assert.notEqual(result.record.source.publicationSource.rootPackageLockSha256, harness.qualification.rootPackageLockSha256);
  assert.deepEqual(readdirSync(join(harness.root, "governance/release-publications/later")), [`strategist-${harness.version}.json`]);
});

// The introduced blob is the altered record, so the immutable-bytes check is
// satisfied. The validator behind `npm run check:later-publications` still
// refuses because the retained publicationSource lock hash is not the hash
// measured at that source commit. One character is enough.
test("check:later-publications refuses a retained v3 record whose publicationSource hash changed by one character", async (t) => {
  const { root, result } = await replayScenario(t, { driftFiles: ["package-lock.json"] });
  const absolute = join(root, result.path);
  const record = JSON.parse(readFileSync(absolute, "utf8"));
  const original = record.source.publicationSource.rootPackageLockSha256;
  const altered = `${original[0] === "0" ? "1" : "0"}${original.slice(1)}`;
  assert.equal(altered.length, original.length);
  assert.notEqual(altered, original);
  record.source.publicationSource.rootPackageLockSha256 = altered;
  writeFileSync(absolute, `${JSON.stringify(record, null, 2)}\n`);
  execFileSync("git", ["add", result.path], { cwd: root });
  execFileSync("git", ["commit", "-qm", "introduce tampered publication record"], { cwd: root });
  const check = spawnSync(process.execPath, [join(process.cwd(), "scripts/check-later-publications.mjs")], { cwd: root, encoding: "utf8" });
  assert.notEqual(check.status, 0, check.stderr || check.stdout);
  assert.match(`${check.stderr}`, /\[replay-source\]/);
});

test("creator refuses credential-bearing environments before reading inputs", async () => {
  await assert.rejects(
    createLaterPublicationRecord({ packageKey: "strategist", qualificationPath: "missing.json", publicationPath: "missing-publication.json", candidatePath: "missing.tgz", proofPath: "missing-proof.json", env: { NPM_TOKEN: "present" } }),
    /credential-bearing/,
  );
});

// The exact release runtime pin governs steps that produce bytes. Recording
// evidence for a published version never packs or writes a tarball, so it
// resolves npm once, requires its major version to be 11 or newer, and never
// probes Node or zlib. A machine whose Node and zlib differ from the pin
// therefore records successfully. The floor is checked at the start of
// createLaterPublicationRecord, before any input is read, so it covers the
// direct join, the v3 replay, and the schema-3 `npm pack --dry-run` join alike.
test("creator records the v3 replay on a machine that is not the pinned runtime when npm is 11 or newer", async (t) => {
  const { result, probes } = await replayScenario(t, { npmVersion: "11.4.2\n" });
  assert.equal(result.record.kind, "foundry-trusted-publication-replay-v3");
  assert.notEqual(probes.length, 0);
  assert.equal(probes.every(([file]) => file === NPM), true, "only the one resolved npm is ever executed; Node and zlib are not probed");
  assert.deepEqual(probes.filter(([, ...args]) => args[0] === "--version"), [[NPM, "--version"], [NPM, "--version"]], "one probe at the start of the creator and one immediately before the audit");
  assert.deepEqual(probes.slice(0, 1), [[NPM, "--version"]], "the floor is the first command the recorder runs");
});

test("creator accepts a newer npm major than the floor", async (t) => {
  const { result } = await replayScenario(t, { npmVersion: "12.0.0\n" });
  assert.equal(result.record.kind, "foundry-trusted-publication-replay-v3");
});

// Every version the floor must refuse, whatever path reaches it.
const REFUSED_NPM_VERSIONS = [
  ["older than 11", "10.9.4\n"],
  ["unparseable", "not-a-version\n"],
  ["empty", "\n"],
  ["unreadable (probe throws)", new Error("spawn npm ENOENT")],
  ["a malformed suffix", "11.0.0garbage\n"],
  ["multi-line output", "11.0.0\n11.0.0\n"],
  ["a leading v", "v11.0.0\n"],
  ["an incomplete version", "11.0\n"],
  ["trailing words", "11.0.0 (custom build)\n"],
];

// The direct join reads no signature audit, so before this floor moved to the
// start of the creator it had no runtime check at all. The inputs below do not
// exist: a refusal that names the npm floor proves the floor ran before any
// input was read, and a refusal about a missing file proves the floor passed.
for (const [label, version] of REFUSED_NPM_VERSIONS) {
  test(`creator refuses the direct path before reading any input when npm is ${label}`, async () => {
    const { run, calls } = npmProbe({ version });
    await assert.rejects(
      createLaterPublicationRecord({ packageKey: "strategist", qualificationPath: "missing.json", publicationPath: "missing-publication.json", candidatePath: "missing.tgz", proofPath: "missing-proof.json", env: {}, auditRun: run, isExecutable: anyExecutable }),
      FLOOR_REFUSAL,
    );
    assert.deepEqual(calls, [[NPM, "--version"]]);
  });
}

test("creator passes the npm floor on the direct path and only then reads its inputs", async () => {
  const { run, calls } = npmProbe();
  await assert.rejects(
    createLaterPublicationRecord({ packageKey: "strategist", qualificationPath: "missing.json", publicationPath: "missing-publication.json", candidatePath: "missing.tgz", proofPath: "missing-proof.json", env: {}, auditRun: run, isExecutable: anyExecutable }),
    (error) => !FLOOR_REFUSAL.test(error.message) && /ENOENT|no such file/.test(error.message),
  );
  assert.deepEqual(calls, [[NPM, "--version"]]);
});

for (const [label, version] of REFUSED_NPM_VERSIONS.filter(([label]) => ["older than 11", "unreadable (probe throws)", "a malformed suffix", "multi-line output"].includes(label))) {
  test(`creator refuses the v3 replay when npm is ${label}, before any audit runs and before a record is written`, async (t) => {
    const { root, probes, fetched } = await replayScenario(t, { npmVersion: version, expectRecord: false, refusal: FLOOR_REFUSAL });
    assert.deepEqual(fetched, [], "the floor is checked before any provider or registry metadata is fetched");
    assert.deepEqual(readdirSync(join(root, "governance/release-publications/later")), []);
    assert.deepEqual(probes, [[NPM, "--version"]], "the floor is checked before init, install, or audit");
  });
}

for (const [label, PATH] of [["a relative entry", "node_modules/.bin:/usr/bin"], ["an empty entry", ":/usr/bin"], ["a dot entry", ".:/usr/bin"]]) {
  test(`creator refuses to resolve npm through ${label} on PATH, before running anything`, async (t) => {
    const { root, probes, fetched } = await replayScenario(t, { env: { PATH }, expectRecord: false, refusal: /refuses to resolve npm through a relative or empty PATH entry/ });
    assert.deepEqual(probes, [], "no command runs when the npm resolution is refused");
    assert.deepEqual(fetched, [], "nothing is fetched when the npm resolution is refused");
    assert.deepEqual(readdirSync(join(root, "governance/release-publications/later")), []);
  });
}

test("creator refuses when no absolute PATH entry contains an executable npm", async () => {
  const { run, calls } = npmProbe();
  await assert.rejects(
    createLaterPublicationRecord({ packageKey: "strategist", qualificationPath: "missing.json", publicationPath: "missing-publication.json", candidatePath: "missing.tgz", proofPath: "missing-proof.json", env: {}, auditRun: run, isExecutable: () => false }),
    /cannot resolve npm: no absolute PATH entry contains an executable npm/,
  );
  assert.deepEqual(calls, []);
});

test("npm floor refusal names the observed version or that it was unreadable", () => {
  assert.throws(() => assertEvidenceNpmFloor(() => "10.9.4\n", {}), /observed npm 10\.9\.4$/);
  assert.throws(() => assertEvidenceNpmFloor(() => { throw new Error("spawn npm ENOENT"); }, {}), /observed npm <unreadable>$/);
  assert.throws(() => assertEvidenceNpmFloor(() => "11.0.0garbage\n", {}), /observed npm 11\.0\.0garbage$/);
  assert.throws(() => assertEvidenceNpmFloor(() => "11.0.0\n11.0.0\n", {}), /observed npm <multi-line output>$/);
  assert.equal(EVIDENCE_NPM_MIN_MAJOR, 11);
});

test("npm floor accepts exactly one semantic version at major 11 or newer, and runs the npm it was given", () => {
  for (const version of ["11.0.0", "11.17.0\n", "  12.1.3  ", "11.0.0-beta.1", "11.0.0+build.5", "11.0.0-rc.1+sha.abc", "100.0.0"]) {
    const seen = [];
    assert.doesNotThrow(() => assertEvidenceNpmFloor((file, args, options) => { seen.push([file, args, options.env]); return version; }, { HOME: "/tmp/home", PATH: "/opt/bin" }, "/opt/bin/npm"), version);
    assert.deepEqual(seen, [["/opt/bin/npm", ["--version"], { HOME: "/tmp/home", PATH: "/opt/bin" }]]);
  }
  assert.doesNotThrow(() => assertEvidenceNpmFloor(() => Buffer.from("11.17.0\n"), {}));
  for (const version of ["10.99.99", "11.0.0garbage", "11.0.0\n11.0.0", "11.0.0-", "11.0.0+", "11.0.0-beta/x", "v11.0.0", "011x", "", "[object Object]"]) {
    assert.throws(() => assertEvidenceNpmFloor(() => version, {}), /requires npm 11 or newer/, JSON.stringify(version));
  }
  assert.throws(() => assertEvidenceNpmFloor(() => ({ stdout: "11.0.0" }), {}), /requires npm 11 or newer/);
});

test("npm resolves once to an absolute path and refuses a relative or empty PATH entry", () => {
  const present = (...paths) => (candidate) => paths.includes(candidate);
  assert.equal(resolveEvidenceNpm("/opt/a:/opt/b:/opt/c", present("/opt/b/npm", "/opt/c/npm")), "/opt/b/npm", "the first executable npm on PATH wins");
  assert.equal(resolveEvidenceNpm("/opt/a:relative/bin", present("/opt/a/npm")), "/opt/a/npm", "entries after the resolved one are not consulted");
  assert.equal(resolveEvidenceNpm("/opt/a:", present("/opt/a/npm")), "/opt/a/npm", "an empty entry after the resolved one is not consulted");
  for (const PATH of ["relative/bin:/opt/a", "./bin:/opt/a", ".:/opt/a", ":/opt/a", "/opt/x::/opt/a", "/opt/x:node_modules/.bin:/opt/a", "node_modules/.bin"]) {
    assert.throws(() => resolveEvidenceNpm(PATH, present("/opt/a/npm")), /relative or empty PATH entry/, PATH);
  }
  assert.throws(() => resolveEvidenceNpm("relative/bin:/opt/a", () => true), /relative or empty PATH entry/, "a relative entry is refused even when npm would exist there");
  assert.throws(() => resolveEvidenceNpm("/opt/a:/opt/b", () => false), /no absolute PATH entry contains an executable npm/);
  assert.throws(() => resolveEvidenceNpm("", () => true), /PATH is empty/);
  assert.throws(() => resolveEvidenceNpm(undefined, () => true), /PATH is empty/);
});

test("npm resolution finds only a regular executable file on a real PATH", (t) => {
  const bin = mkdtempSync(join(tmpdir(), "record-later-publication-npm-path-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  assert.throws(() => resolveEvidenceNpm(bin), /no absolute PATH entry contains an executable npm/, "no npm at all");
  mkdirSync(join(bin, "npm"));
  assert.throws(() => resolveEvidenceNpm(bin), /no absolute PATH entry contains an executable npm/, "a directory named npm is not npm");
  rmSync(join(bin, "npm"), { recursive: true });
  writeFileSync(join(bin, "npm"), "#!/bin/sh\necho 11.0.0\n", { mode: 0o644 });
  assert.throws(() => resolveEvidenceNpm(bin), /no absolute PATH entry contains an executable npm/, "a non-executable npm is not npm");
  chmodSync(join(bin, "npm"), 0o755);
  assert.equal(resolveEvidenceNpm(bin), join(bin, "npm"));
});

test("requireEvidenceNpm resolves first and reads the version from that same absolute path", () => {
  const { run, calls } = npmProbe();
  assert.equal(requireEvidenceNpm(run, { PATH: "/opt/a:/opt/b", HOME: "/tmp/h" }, (candidate) => candidate === "/opt/b/npm"), "/opt/b/npm");
  assert.deepEqual(calls, [["/opt/b/npm", "--version"]]);
  const refused = npmProbe({ version: "10.0.0\n" });
  assert.throws(() => requireEvidenceNpm(refused.run, { PATH: "/opt/b" }, anyExecutable), FLOOR_REFUSAL);
  const unresolved = npmProbe();
  assert.throws(() => requireEvidenceNpm(unresolved.run, { PATH: "rel:/opt/b" }, anyExecutable), /relative or empty PATH entry/);
  assert.deepEqual(unresolved.calls, [], "nothing is run when resolution is refused");
});

test("npm floor refusal stops verifiedAnonymousAudit before it installs anything", () => {
  const { run, calls } = npmProbe({ version: "9.8.1\n" });
  assert.throws(() => verifiedAnonymousAudit("@clossys/strategist", "0.1.1", run, {}, { isExecutable: anyExecutable }), /observed npm 9\.8\.1/);
  assert.deepEqual(calls, [[NPM, "--version"]]);
});

test("verifiedAnonymousAudit refuses a relative PATH entry before running any command", () => {
  const { run, calls } = npmProbe();
  assert.throws(() => verifiedAnonymousAudit("@clossys/strategist", "0.1.1", run, { PATH: "node_modules/.bin:/usr/bin" }, { isExecutable: anyExecutable }), /relative or empty PATH entry/);
  assert.deepEqual(calls, []);
});

test("verifiedAnonymousAudit re-reads the version from the npm it is given and runs that same binary", () => {
  const { run, calls } = npmProbe({ answer: (_file, args) => args[0] === "audit" ? "{}" : "" });
  assert.deepEqual(verifiedAnonymousAudit("@clossys/strategist", "0.1.1", run, { PATH: "/safe/bin" }, { npm: "/checked/bin/npm" }), {});
  assert.deepEqual(calls.map(([file, ...args]) => [file, args[0]]), [["/checked/bin/npm", "--version"], ["/checked/bin/npm", "init"], ["/checked/bin/npm", "install"], ["/checked/bin/npm", "audit"]]);
  const old = npmProbe({ version: "10.0.0\n" });
  assert.throws(() => verifiedAnonymousAudit("@clossys/strategist", "0.1.1", old.run, { PATH: "/safe/bin" }, { npm: "/checked/bin/npm" }), FLOOR_REFUSAL);
  assert.deepEqual(old.calls, [["/checked/bin/npm", "--version"]]);
});

test("replay signature audit never inherits a token, private registry, or npm configuration", () => {
  const parent = { PATH: "/safe/bin", NODE_AUTH_TOKEN: "secret", NPM_CONFIG_USERCONFIG: "/private/npmrc", npm_config_registry: "https://private.example.invalid" };
  const probed = [];
  const { run, calls } = npmProbe({ version: "11.17.0\n", answer: (_file, args) => args[0] === "audit" ? "{}" : "" });
  const spy = (file, args, options) => { probed.push(options.env); return run(file, args, options); };
  assert.deepEqual(verifiedAnonymousAudit("@clossys/strategist", "0.1.1", spy, parent, { isExecutable: anyExecutable }), {});
  assert.equal(calls.length, 4, "the npm floor probe, init, install, and audit");
  assert.equal(calls.every(([file]) => file === "/safe/bin/npm"), true, "the checked npm is the one that runs");
  assert.equal(probed.length, 4);
  for (const env of probed) {
    assert.equal(env.npm_config_registry, "https://registry.npmjs.org/");
    assert.equal(env.npm_config_always_auth, "false");
    assert.equal(env.npm_config_ignore_scripts, "true");
    assert.equal(env.NODE_AUTH_TOKEN, undefined);
    assert.equal(env.NPM_CONFIG_USERCONFIG, undefined);
    assert.equal(env.npm_config_userconfig.startsWith(env.HOME), true);
  }
  assert.equal(credentiallessAuditEnv("/tmp/replay", parent).PATH, "/safe/bin");
});

test("CLI rejects traversal, duplicate, credential, and mixed-fetch inputs", () => {
  const base = ["node", "script", "--package", "strategist", "--qualification", "q.json", "--publication", "p.json", "--candidate", "candidate.tgz", "--proof", "proof.json"];
  assert.deepEqual(argsFrom(base), { fetch: false, package: "strategist", qualification: "q.json", publication: "p.json", candidate: "candidate.tgz", proof: "proof.json" });
  for (const mutation of [
    ["--package", "../strategist"], ["--otp", "123456"], ["--fetch"], ["--candidate", "https://example.invalid/candidate.tgz"],
  ]) assert.throws(() => argsFrom([...base, ...mutation]), /Usage/);
  assert.deepEqual(argsFrom(["node", "script", "--package", "strategist", "--qualification", "q.json", "--publication", "p.json", "--fetch"]), { fetch: true, package: "strategist", qualification: "q.json", publication: "p.json" });
  assert.throws(() => argsFrom(["node", "script", "--package", "strategist", "--qualification", "q.json", "--publication", "p.json", "--fetch", "--artifact-archive", "qualified.zip"]), /Usage/);
  assert.deepEqual(argsFrom(["node", "script", "--package", "strategist", "--qualification", "q.json", "--publication", "p.json", "--fetch", "--artifact-archive", "qualified.zip", "--replay-evidence", "provider.json"]), { fetch: true, package: "strategist", qualification: "q.json", publication: "p.json", "artifact-archive": "qualified.zip", "replay-evidence": "provider.json" });
});
