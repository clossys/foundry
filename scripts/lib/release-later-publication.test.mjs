import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { immutableSingleIntroduction, strictQualificationIntroductionAncestor, validateLaterPublication, validateRetainedLaterPublications } from "./release-later-publication.mjs";
import { publicNpmPackageUrl, publicNpmVersionUrl, PUBLIC_NPM_REGISTRY } from "./public-npm-registry.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const hex = (character, size) => character.repeat(size);
const qualificationBytes = "qualified bytes\n";
const catalogBytes = "catalog bytes\n";
const candidate = {
  name: "@clossys/strategist", version: "0.1.1", packageTreeSha1: hex("a", 40), packageManifestSha256: hex("b", 64),
  tarball: { sha1: hex("c", 40), sha256: hex("d", 64), sha512: hex("e", 128) },
};
const qualification = {
  candidate,
  timing: "pre-publication",
  reviewedCommit: hex("f", 40), rootPackageJsonSha256: hex("1", 64), rootPackageLockSha256: hex("2", 64),
  policySha256: hex("3", 64), adapterSha256: hex("4", 64), fixtureSetSha256: hex("5", 64),
};
const tarballUrl = `${PUBLIC_NPM_REGISTRY}/@clossys/strategist/-/strategist-0.1.1.tgz`;
function source() { return {
  schemaVersion: 1, kind: "foundry-later-publication-v1",
  qualification: { path: "governance/release-qualifications/clossys-strategist-0.1.1.json", sha256: hash(qualificationBytes) },
  candidate: structuredClone(candidate),
  source: Object.fromEntries(["reviewedCommit", "rootPackageJsonSha256", "rootPackageLockSha256", "policySha256", "adapterSha256", "fixtureSetSha256"].map((key) => [key, qualification[key]])),
  catalog: { path: "governance/release-catalog.json", sha256: hash(catalogBytes), packageKey: "strategist" },
  publication: { mode: "owner-present", publishedAt: "2026-08-30T00:00:00.000Z", reference: "https://evidence.example.invalid/publication" },
  registryProof: { schemaVersion: 1, kind: "public-npm-anonymous-registry-proof-v1", evidence: {
    registry: PUBLIC_NPM_REGISTRY, access: "anonymous", name: candidate.name, version: candidate.version,
    packumentUrl: publicNpmPackageUrl(PUBLIC_NPM_REGISTRY, candidate.name), tarballUrl,
    integrity: `sha512-${Buffer.from(candidate.tarball.sha512, "hex").toString("base64")}`,
    shasum: candidate.tarball.sha1, sha256: candidate.tarball.sha256, sha512: candidate.tarball.sha512,
    packedManifestSha256: candidate.packageManifestSha256, size: 42,
  } },
}; }
function context() { return { recordPath: "governance/release-publications/later/strategist-0.1.1.json", recordBytes: "record\n", qualification, qualificationBytes, qualificationPath: "governance/release-qualifications/clossys-strategist-0.1.1.json", catalogBytes, catalog: { defaultTarget: "clossys-npmjs", targets: [{ id: "clossys-npmjs", status: "active", packages: ["advisor", "starter", "controller", "strategist"] }] } }; }
function rules(record, overrides) { return validateLaterPublication(record, { ...context(), ...overrides }).map((item) => item.rule); }

test("later-publication record binds qualified candidate, active catalogue, anonymous bytes, and owner evidence", () => {
  assert.deepEqual(rules(source()), []);
});

test("later-publication admits only the exact-version anonymous proof shape for future public releases", () => {
  const value = source();
  value.registryProof = { schemaVersion: 2, kind: "public-npm-anonymous-registry-proof-v2", evidence: {
    ...value.registryProof.evidence,
    metadataUrl: publicNpmVersionUrl(PUBLIC_NPM_REGISTRY, candidate.name, candidate.version),
    repository: "clossys/foundry",
  } };
  delete value.registryProof.evidence.packumentUrl;
  assert.deepEqual(rules(value), []);
  value.registryProof.evidence.metadataUrl = publicNpmPackageUrl(PUBLIC_NPM_REGISTRY, candidate.name);
  assert.ok(rules(value).includes("registry-join"));
});

test("later-publication rejects source, catalog, candidate and served-byte substitution", () => {
  const attacks = [
    (value) => { value.qualification.sha256 = hex("0", 64); },
    (value) => { value.candidate.tarball.sha256 = hex("0", 64); },
    (value) => { value.source.policySha256 = hex("0", 64); },
    (value) => { value.catalog.packageKey = "writer"; },
    (value) => { value.registryProof.evidence.tarballUrl += ".other"; },
    (value) => { value.registryProof.evidence.packedManifestSha256 = hex("0", 64); },
  ];
  for (const attack of attacks) { const value = source(); attack(value); assert.ok(rules(value).length > 0); }
});

test("later-publication binds each record to its introduction catalog while requiring present allowlisting", () => {
  const firstCatalogBytes = "catalog before writer\n";
  const secondCatalogBytes = "catalog after writer\n";
  const firstCatalog = { defaultTarget: "clossys-npmjs", targets: [{ id: "clossys-npmjs", status: "active", packages: ["advisor", "starter", "controller", "strategist"] }] };
  const secondCatalog = { defaultTarget: "clossys-npmjs", targets: [{ id: "clossys-npmjs", status: "active", packages: ["advisor", "starter", "controller", "strategist", "writer"] }] };
  const first = source(); first.catalog.sha256 = hash(firstCatalogBytes);
  assert.deepEqual(rules(first, { catalogBytes: firstCatalogBytes, catalog: firstCatalog, currentCatalog: secondCatalog }), []);

  const writer = source();
  writer.candidate.name = "@clossys/writer";
  writer.candidate.version = "0.3.1";
  writer.catalog = { path: "governance/release-catalog.json", sha256: hash(secondCatalogBytes), packageKey: "writer" };
  writer.qualification.path = "governance/release-qualifications/clossys-writer-0.3.1.json";
  writer.registryProof.evidence.name = writer.candidate.name;
  writer.registryProof.evidence.version = writer.candidate.version;
  writer.registryProof.evidence.packumentUrl = publicNpmPackageUrl(PUBLIC_NPM_REGISTRY, writer.candidate.name);
  writer.registryProof.evidence.tarballUrl = `${PUBLIC_NPM_REGISTRY}/@clossys/writer/-/writer-0.3.1.tgz`;
  const writerQualification = structuredClone(qualification); writerQualification.candidate = structuredClone(writer.candidate);
  assert.deepEqual(validateLaterPublication(writer, { ...context(), recordPath: "governance/release-publications/later/writer-0.3.1.json", qualification: writerQualification, qualificationPath: writer.qualification.path, catalogBytes: secondCatalogBytes, catalog: secondCatalog, currentCatalog: secondCatalog }).map((item) => item.rule), []);
  const removedFromCurrent = { defaultTarget: "clossys-npmjs", targets: [{ id: "clossys-npmjs", status: "active", packages: ["advisor", "starter", "controller"] }] };
  assert.ok(rules(first, { catalogBytes: firstCatalogBytes, catalog: firstCatalog, currentCatalog: removedFromCurrent }).includes("catalog-join"));
});

test("later-publication malformed records and controlled qualification paths return findings", (t) => {
  const root = mkdtempSync(join(tmpdir(), "later-publication-path-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "governance", "release-publications", "later");
  mkdirSync(directory, { recursive: true });
  mkdirSync(join(root, "governance"), { recursive: true });
  writeFileSync(join(root, "governance", "release-catalog.json"), "{}\n");
  execFileSync("git", ["init", "-q"], { cwd: root }); execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root }); execFileSync("git", ["config", "user.name", "test"], { cwd: root });
  for (const [file, qualificationPath] of [["traversal.json", "../../outside.json"], ["absolute.json", "/tmp/outside.json"]]) {
    writeFileSync(join(directory, file), JSON.stringify({ qualification: { path: qualificationPath } }));
  }
  execFileSync("git", ["add", "governance"], { cwd: root }); execFileSync("git", ["commit", "-qm", "introduce malformed records"], { cwd: root });
  assert.doesNotThrow(() => validateRetainedLaterPublications(root));
  const result = validateRetainedLaterPublications(root);
  assert.equal(result.findings.filter((item) => item.rule === "retained-record").length, 2);
});

test("later-publication cannot substitute a sealed first-publication Trio member", () => {
  const value = source(); value.candidate.name = "@clossys/advisor";
  assert.ok(rules(value).includes("sealed-trio"));
});

test("later-publication history rejects a rewrite followed by restoration", (t) => {
  const root = mkdtempSync(join(tmpdir(), "later-publication-history-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = "governance/release-publications/later/strategist-0.1.1.json"; const absolute = join(root, path);
  mkdirSync(join(root, "governance/release-publications/later"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root }); execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root }); execFileSync("git", ["config", "user.name", "test"], { cwd: root });
  writeFileSync(absolute, "original\n"); execFileSync("git", ["add", path], { cwd: root }); execFileSync("git", ["commit", "-qm", "introduce"], { cwd: root });
  assert.doesNotThrow(() => immutableSingleIntroduction(root, path));
  writeFileSync(absolute, "rewritten\n"); execFileSync("git", ["commit", "-am", "rewrite", "-q"], { cwd: root });
  writeFileSync(absolute, "original\n"); execFileSync("git", ["commit", "-am", "restore", "-q"], { cwd: root });
  assert.throws(() => immutableSingleIntroduction(root, path), /touched after/);
});

test("later-publication requires a strict qualification-introduction ancestor", (t) => {
  const root = mkdtempSync(join(tmpdir(), "later-publication-ancestry-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root }); execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root }); execFileSync("git", ["config", "user.name", "test"], { cwd: root });
  writeFileSync(join(root, "qualification"), "first\n"); execFileSync("git", ["add", "."], { cwd: root }); execFileSync("git", ["commit", "-qm", "qualification introduction"], { cwd: root });
  const qualificationIntroduction = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  writeFileSync(join(root, "publication"), "second\n"); execFileSync("git", ["add", "."], { cwd: root }); execFileSync("git", ["commit", "-qm", "publication introduction"], { cwd: root });
  const publicationIntroduction = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assert.doesNotThrow(() => strictQualificationIntroductionAncestor(root, qualificationIntroduction, publicationIntroduction));
  assert.throws(() => strictQualificationIntroductionAncestor(root, publicationIntroduction, publicationIntroduction), /strictly precede/);
  assert.throws(() => strictQualificationIntroductionAncestor(root, publicationIntroduction, qualificationIntroduction), /ancestor/);
  assert.throws(() => strictQualificationIntroductionAncestor(root, "not-a-commit", publicationIntroduction), /commit hashes/);
});

test("trusted-publication v2 binds immutable provenance to the qualified served bytes", () => {
  const trusted = source();
  trusted.schemaVersion = 2;
  trusted.kind = "foundry-trusted-publication-v2";
  trusted.publication.mode = "trusted-publisher";
  trusted.publication.reference = "https://github.com/clossys/foundry/actions/runs/123";
  trusted.publication.provenance = {
    repository: "https://github.com/clossys/foundry", workflow: ".github/workflows/publish.yml", ref: "refs/heads/main", event: "workflow_dispatch",
    sourceSha: "a".repeat(40), builder: "https://github.com/actions/runner/github-hosted",
    invocation: "https://github.com/clossys/foundry/actions/runs/123/attempts/1",
    attestationUrl: "https://registry.npmjs.org/-/npm/v1/attestations/%40clossys%2Fstrategist%400.1.1",
  };
  trusted.registryProof = { schemaVersion: 2, kind: "public-npm-anonymous-registry-proof-v2", evidence: {
    ...trusted.registryProof.evidence, metadataUrl: publicNpmVersionUrl(PUBLIC_NPM_REGISTRY, candidate.name, candidate.version), repository: "clossys/foundry",
  } };
  delete trusted.registryProof.evidence.packumentUrl;
  assert.deepEqual(rules(trusted), []);
  for (const mutate of [
    (value) => { value.publication.provenance.workflow = ".github/workflows/other.yml"; },
    (value) => { value.publication.provenance.invocation = "https://github.com/clossys/foundry/actions/runs/123"; },
    (value) => { value.publication.provenance.attestationUrl = "https://registry.npmjs.org/-/npm/v1/attestations/other"; },
    (value) => { value.registryProof.evidence.repository = "clossys/other"; },
  ]) { const value = structuredClone(trusted); mutate(value); assert.ok(rules(value).length > 0); }
});
