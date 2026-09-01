import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { argsFrom, buildLaterPublicationRecord, createLaterPublicationRecord, credentiallessAuditEnv, verifiedAnonymousAudit, writeNoOverwrite } from "./record-later-publication.mjs";
import { publicNpmVersionUrl, PUBLIC_NPM_REGISTRY } from "./lib/public-npm-registry.mjs";
import { RELEASE_RUNTIME } from "./lib/release-runtime.mjs";

const hex = (value, length) => value.repeat(length);
const digest = (algorithm, value) => createHash(algorithm).update(value).digest("hex");
const candidateBytes = Buffer.from("candidate bytes");
const releaseRuntimeRun = (file, args) => {
  if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? `${RELEASE_RUNTIME.node}\n` : `${RELEASE_RUNTIME.npm}\n`, stderr: "" };
  if (args[0] === "-p") return { status: 0, stdout: `${RELEASE_RUNTIME.zlib}\n`, stderr: "" };
  throw new Error(`unexpected release runtime probe ${file} ${args.join(" ")}`);
};
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
  const candidatePath = join(packDirectory, "clossys-strategist-0.1.2.tgz");
  const candidateBytesForRecord = readFileSync(candidatePath);
  const hashes = { sha1: digest("sha1", candidateBytesForRecord), sha256: digest("sha256", candidateBytesForRecord), sha512: digest("sha512", candidateBytesForRecord) };
  const qualificationPath = "governance/release-qualifications/clossys-strategist-0.1.2.json";
  const qualification = JSON.parse(readFileSync(join(sourceRoot, qualificationPath), "utf8"));
  qualification.reviewedCommit = base;
  qualification.candidateReview.headSha = base;
  qualification.candidate.packageTreeSha1 = execFileSync("git", ["rev-parse", `${base}:packages/strategist`], { cwd: root, encoding: "utf8" }).trim();
  qualification.rootPackageJsonSha256 = digest("sha256", readFileSync(join(root, "package.json")));
  qualification.rootPackageLockSha256 = digest("sha256", readFileSync(join(root, "package-lock.json")));
  qualification.candidate.tarball = hashes;
  qualification.transcript.tarball = hashes;
  const transcriptForDigest = { ...qualification.transcript };
  delete transcriptForDigest.canonicalSha256;
  qualification.transcript.canonicalSha256 = digest("sha256", JSON.stringify(transcriptForDigest));
  writeFileSync(join(root, qualificationPath), `${JSON.stringify(qualification, null, 2)}\n`);
  execFileSync("git", ["add", qualificationPath], { cwd: root });
  execFileSync("git", ["commit", "-qm", "synthetic qualification record"], { cwd: root });

  const manifestBytes = readFileSync(join(root, "packages/strategist/package.json"));
  const proof = {
    schemaVersion: 2, kind: "public-npm-anonymous-registry-proof-v2", evidence: {
      registry: PUBLIC_NPM_REGISTRY, access: "anonymous", name: qualification.candidate.name, version: qualification.candidate.version,
      metadataUrl: publicNpmVersionUrl(PUBLIC_NPM_REGISTRY, qualification.candidate.name, qualification.candidate.version), repository: "clossys/foundry",
      tarballUrl: `${PUBLIC_NPM_REGISTRY}/@clossys/strategist/-/strategist-0.1.2.tgz`, integrity: `sha512-${Buffer.from(hashes.sha512, "hex").toString("base64")}`,
      shasum: hashes.sha1, sha256: hashes.sha256, sha512: hashes.sha512, packedManifestSha256: digest("sha256", manifestBytes), size: candidateBytesForRecord.length,
    },
  };
  const proofPath = join(root, "registry-proof.json");
  writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  const publicationPath = join(root, "publication-evidence.json");
  writeFileSync(publicationPath, `${JSON.stringify({ mode: "owner-present", publishedAt: "2026-08-31T00:00:00.000Z", reference: "https://registry.npmjs.org/%40clossys%2Fstrategist/0.1.2" }, null, 2)}\n`);

  const result = await createLaterPublicationRecord({
    root, packageKey: "strategist", qualificationPath: join(root, qualificationPath), candidatePath, proofPath, publicationPath, env: {}, releaseRuntimeRun,
  });
  assert.equal(result.path, "governance/release-publications/later/strategist-0.1.2.json");
  assert.equal(result.record.kind, "foundry-later-publication-v1");
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(root, result.path), "utf8"))), ["schemaVersion", "kind", "qualification", "candidate", "source", "catalog", "publication", "registryProof"]);
  assert.deepEqual(readdirSync(join(root, "governance/release-publications/later")), ["strategist-0.1.2.json"]);
  assert.deepEqual(readFileSync(join(root, result.path)), result.bytes);
});

test("creator retains one provider-bound replay record from the exact qualified archive", async (t) => {
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
  const candidatePath = join(packDirectory, "clossys-strategist-0.1.2.tgz");
  const candidateBytesForRecord = readFileSync(candidatePath);
  const hashes = { sha1: digest("sha1", candidateBytesForRecord), sha256: digest("sha256", candidateBytesForRecord), sha512: digest("sha512", candidateBytesForRecord) };
  const qualificationPath = "governance/release-qualifications/clossys-strategist-0.1.2.json";
  const qualification = JSON.parse(readFileSync(join(sourceRoot, qualificationPath), "utf8"));
  qualification.reviewedCommit = base;
  qualification.candidateReview.headSha = base;
  qualification.candidate.packageTreeSha1 = execFileSync("git", ["rev-parse", `${base}:packages/strategist`], { cwd: root, encoding: "utf8" }).trim();
  qualification.rootPackageJsonSha256 = digest("sha256", readFileSync(join(root, "package.json")));
  qualification.rootPackageLockSha256 = digest("sha256", readFileSync(join(root, "package-lock.json")));
  qualification.candidate.tarball = hashes;
  qualification.transcript.tarball = hashes;
  const transcriptForDigest = { ...qualification.transcript };
  delete transcriptForDigest.canonicalSha256;
  qualification.transcript.canonicalSha256 = digest("sha256", JSON.stringify(transcriptForDigest));
  writeFileSync(join(root, qualificationPath), `${JSON.stringify(qualification, null, 2)}\n`);
  execFileSync("git", ["add", qualificationPath], { cwd: root });
  execFileSync("git", ["commit", "-qm", "synthetic qualification record"], { cwd: root });

  // The replay exception is only for raw root-resolution drift; changing
  // whitespace keeps both root files valid while changing their byte hashes.
  writeFileSync(join(root, "package.json"), `${readFileSync(join(root, "package.json"), "utf8")}\n`);
  writeFileSync(join(root, "package-lock.json"), `${readFileSync(join(root, "package-lock.json"), "utf8")}\n`);
  execFileSync("git", ["add", "package.json", "package-lock.json"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "synthetic root resolution drift"], { cwd: root });
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

  const manifestBytes = readFileSync(join(root, "packages/strategist/package.json"));
  const replayProof = {
    schemaVersion: 2, kind: "public-npm-anonymous-registry-proof-v2", evidence: {
      registry: PUBLIC_NPM_REGISTRY, access: "anonymous", name: qualification.candidate.name, version: qualification.candidate.version,
      metadataUrl: publicNpmVersionUrl(PUBLIC_NPM_REGISTRY, qualification.candidate.name, qualification.candidate.version), repository: "clossys/foundry",
      tarballUrl: `${PUBLIC_NPM_REGISTRY}/@clossys/strategist/-/strategist-0.1.2.tgz`, integrity: `sha512-${Buffer.from(hashes.sha512, "hex").toString("base64")}`,
      shasum: hashes.sha1, sha256: hashes.sha256, sha512: hashes.sha512, packedManifestSha256: digest("sha256", manifestBytes), size: candidateBytesForRecord.length,
    },
  };
  const proofPath = join(root, "registry-proof.json");
  writeFileSync(proofPath, `${JSON.stringify(replayProof, null, 2)}\n`);
  const runId = 777, artifactId = 778;
  const publicationPath = join(root, "publication-evidence.json");
  const attestationUrl = `${PUBLIC_NPM_REGISTRY}/-/npm/v1/attestations/%40clossys%2Fstrategist%400.1.2`;
  writeFileSync(publicationPath, `${JSON.stringify({
    mode: "trusted-publisher", publishedAt: "2026-08-31T00:00:00.000Z", reference: `https://github.com/clossys/foundry/actions/runs/${runId}`,
    provenance: {
      repository: "https://github.com/clossys/foundry", workflow: ".github/workflows/publish.yml", ref: "refs/heads/main", event: "workflow_dispatch",
      sourceSha, builder: "https://github.com/actions/runner/github-hosted", invocation: `https://github.com/clossys/foundry/actions/runs/${runId}/attempts/1`, attestationUrl,
    },
  }, null, 2)}\n`);
  const archiveDirectory = join(root, ".qualified-artifact");
  mkdirSync(archiveDirectory);
  writeFileSync(join(archiveDirectory, "candidate.tgz"), candidateBytesForRecord);
  writeFileSync(join(archiveDirectory, "transcript.json"), `${JSON.stringify(qualification.transcript, null, 2)}\n`);
  const archivePath = join(root, "qualified-candidate.zip");
  execFileSync("zip", ["-q", archivePath, "candidate.tgz", "transcript.json"], { cwd: archiveDirectory });
  const archiveBytes = readFileSync(archivePath);
  const replayEvidencePath = join(root, "replay-evidence.json");
  writeFileSync(replayEvidencePath, `${JSON.stringify({ schemaVersion: 1, kind: "foundry-trusted-publication-replay-input-v1", runId, artifactId })}\n`);

  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: "pkg:npm/%40clossys/strategist@0.1.2", digest: { sha512: hashes.sha512 } }],
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
  const fetchImpl = async (url) => {
    const response = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url.endsWith(`/actions/runs/${runId}`)) return response({ id: runId, head_sha: sourceSha, event: "workflow_dispatch", conclusion: "success" });
    if (url.endsWith(`/actions/artifacts/${artifactId}`)) return response({ id: artifactId, name: "qualified-candidate-strategist", digest: `sha256:${digest("sha256", archiveBytes)}`, size_in_bytes: archiveBytes.length, archive_download_url: `https://api.github.com/repos/clossys/foundry/actions/artifacts/${artifactId}/zip`, workflow_run: { id: runId, head_sha: sourceSha } });
    if (url.endsWith(`/actions/runs/${runId}/jobs?per_page=100`)) return response({ jobs: [
      { id: 779, name: "qualify (strategist)", conclusion: "success", html_url: `https://github.com/clossys/foundry/actions/runs/${runId}/job/779` },
      { id: 780, name: "publish (strategist)", conclusion: "success", html_url: `https://github.com/clossys/foundry/actions/runs/${runId}/job/780` },
    ] });
    if (url === `https://registry.npmjs.org/${encodeURIComponent(qualification.candidate.name)}`) return response(packument);
    throw new Error(`unexpected fetch ${url}`);
  };
  const auditRun = (_file, args) => args[0] === "audit" ? JSON.stringify(audit) : "";

  const result = await createLaterPublicationRecord({
    root, packageKey: "strategist", qualificationPath: join(root, qualificationPath), candidatePath, proofPath, publicationPath,
    artifactArchivePath: archivePath, replayEvidencePath, fetchImpl, auditRun, env: {}, releaseRuntimeRun,
  });
  assert.equal(result.record.kind, "foundry-trusted-publication-replay-v3");
  assert.equal(result.record.publication.reference, result.record.runQualification.run.url);
  assert.equal(result.record.runQualification.artifact.archiveSha256, `sha256:${digest("sha256", archiveBytes)}`);
  assert.equal(result.record.runQualification.transcript.rawSha256, digest("sha256", Buffer.from(`${JSON.stringify(qualification.transcript, null, 2)}\n`)));
  assert.deepEqual(readdirSync(join(root, "governance/release-publications/later")), ["strategist-0.1.2.json"]);
});

test("creator refuses credential-bearing environments before reading inputs", async () => {
  await assert.rejects(
    createLaterPublicationRecord({ packageKey: "strategist", qualificationPath: "missing.json", publicationPath: "missing-publication.json", candidatePath: "missing.tgz", proofPath: "missing-proof.json", env: { NPM_TOKEN: "present" } }),
    /credential-bearing/,
  );
});

test("creator refuses a mismatched release runtime before reading or retaining a record", async () => {
  const mismatch = (file, args) => {
    if (args[0] === "--version") return { status: 0, stdout: `${file === process.execPath ? RELEASE_RUNTIME.node : "11.12.0"}\n`, stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: `${RELEASE_RUNTIME.zlib}\n`, stderr: "" };
    throw new Error("unexpected release runtime probe");
  };
  await assert.rejects(
    createLaterPublicationRecord({ packageKey: "strategist", qualificationPath: "missing.json", publicationPath: "missing-publication.json", candidatePath: "missing.tgz", proofPath: "missing-proof.json", env: {}, releaseRuntimeRun: mismatch }),
    /observed npm 11\.12\.0/,
  );
});

test("replay signature audit never inherits a token, private registry, or npm configuration", () => {
  const parent = { PATH: "/safe/bin", NODE_AUTH_TOKEN: "secret", NPM_CONFIG_USERCONFIG: "/private/npmrc", npm_config_registry: "https://private.example.invalid" };
  const calls = [];
  const run = (_file, args, options) => { calls.push({ args, env: options.env }); return args[0] === "audit" ? "{}" : ""; };
  assert.deepEqual(verifiedAnonymousAudit("@clossys/strategist", "0.1.1", run, parent), {});
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.env.npm_config_registry, "https://registry.npmjs.org/");
    assert.equal(call.env.npm_config_always_auth, "false");
    assert.equal(call.env.npm_config_ignore_scripts, "true");
    assert.equal(call.env.NODE_AUTH_TOKEN, undefined);
    assert.equal(call.env.NPM_CONFIG_USERCONFIG, undefined);
    assert.equal(call.env.npm_config_userconfig.startsWith(call.env.HOME), true);
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
