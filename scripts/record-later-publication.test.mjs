import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { argsFrom, buildLaterPublicationRecord, createLaterPublicationRecord, writeNoOverwrite } from "./record-later-publication.mjs";
import { publicNpmVersionUrl, PUBLIC_NPM_REGISTRY } from "./lib/public-npm-registry.mjs";

const hex = (value, length) => value.repeat(length);
const digest = (algorithm, value) => createHash(algorithm).update(value).digest("hex");
const candidateBytes = Buffer.from("candidate bytes");
const candidate = {
  name: "@clossys/strategist", version: "0.1.1", packageTreeSha1: hex("a", 40), packageManifestSha256: hex("b", 64),
  policySha256: hex("c", 64), adapterSha256: hex("d", 64), fixtureSetSha256: hex("e", 64),
  tarball: { sha1: hex("f", 40), sha256: hex("1", 64), sha512: hex("2", 128) },
};
const qualification = {
  schemaVersion: 2, timing: "pre-publication", candidate,
  archetypes: ["current-direct", "prior-minor", "oldest-supported", "control-plane"].map((kind) => ({ kind, status: "unsupported" })),
  reviewedCommit: hex("3", 40), rootPackageJsonSha256: hex("4", 64), rootPackageLockSha256: hex("5", 64),
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
    root, packageKey: "strategist", qualificationPath: join(root, qualificationPath), candidatePath, proofPath, publicationPath, env: {},
  });
  assert.equal(result.path, "governance/release-publications/later/strategist-0.1.2.json");
  assert.equal(result.record.kind, "foundry-later-publication-v1");
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(root, result.path), "utf8"))), ["schemaVersion", "kind", "qualification", "candidate", "source", "catalog", "publication", "registryProof"]);
  assert.deepEqual(readdirSync(join(root, "governance/release-publications/later")), ["strategist-0.1.2.json"]);
  assert.deepEqual(readFileSync(join(root, result.path)), result.bytes);
});

test("creator refuses credential-bearing environments before reading inputs", async () => {
  await assert.rejects(
    createLaterPublicationRecord({ packageKey: "strategist", qualificationPath: "missing.json", publicationPath: "missing-publication.json", candidatePath: "missing.tgz", proofPath: "missing-proof.json", env: { NPM_TOKEN: "present" } }),
    /credential-bearing/,
  );
});

test("CLI rejects traversal, duplicate, credential, and mixed-fetch inputs", () => {
  const base = ["node", "script", "--package", "strategist", "--qualification", "q.json", "--publication", "p.json", "--candidate", "candidate.tgz", "--proof", "proof.json"];
  assert.deepEqual(argsFrom(base), { fetch: false, package: "strategist", qualification: "q.json", publication: "p.json", candidate: "candidate.tgz", proof: "proof.json" });
  for (const mutation of [
    ["--package", "../strategist"], ["--otp", "123456"], ["--fetch"], ["--candidate", "https://example.invalid/candidate.tgz"],
  ]) assert.throws(() => argsFrom([...base, ...mutation]), /Usage/);
  assert.deepEqual(argsFrom(["node", "script", "--package", "strategist", "--qualification", "q.json", "--publication", "p.json", "--fetch"]), { fetch: true, package: "strategist", qualification: "q.json", publication: "p.json" });
});
