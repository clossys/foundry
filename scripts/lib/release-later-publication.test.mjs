import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { immutableSingleIntroduction, strictQualificationIntroductionAncestor, trustedProvenanceSourceValid, trustedReplaySourceEvidence, validateLaterPublication, validateRetainedLaterPublications } from "./release-later-publication.mjs";
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
  transcript: { canonicalSha256: hex("b", 64) },
};
const tarballUrl = `${PUBLIC_NPM_REGISTRY}/@clossys/strategist/-/strategist-0.1.1.tgz`;
const historicalRepository = "https://github.com/clossys/" + "platform";
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
function rules(record, overrides) { return validateLaterPublication(record, { ...context(), provenanceSourceValid: true, ...overrides }).map((item) => item.rule); }

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
  assert.throws(() => immutableSingleIntroduction(root, path), /retained bytes differ/);
  writeFileSync(absolute, "original\n"); execFileSync("git", ["commit", "-am", "restore", "-q"], { cwd: root });
  assert.throws(() => immutableSingleIntroduction(root, path), /touched after/);
});

function retainedMergeFixture(t, label) {
  const root = mkdtempSync(join(tmpdir(), `later-publication-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = "governance/release-publications/later/strategist-0.1.1.json";
  const absolute = join(root, path);
  mkdirSync(join(root, "governance/release-publications/later"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "test"], { cwd: root });
  writeFileSync(join(root, "base"), "base\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
  execFileSync("git", ["branch", "pre-introduction"], { cwd: root });
  writeFileSync(absolute, "original\n");
  execFileSync("git", ["add", path], { cwd: root });
  execFileSync("git", ["commit", "-qm", "introduce"], { cwd: root });
  const introduction = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  execFileSync("git", ["checkout", "-q", "pre-introduction"], { cwd: root });
  writeFileSync(join(root, "branch"), "unrelated\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "pre-introduction work"], { cwd: root });
  return { root, path, absolute, introduction };
}

test("immutable records survive a byte-identical pre-introduction merge in either orientation", (t) => {
  for (const orientation of ["main-first", "branch-first"]) {
    const fixture = retainedMergeFixture(t, orientation);
    if (orientation === "main-first") {
      execFileSync("git", ["checkout", "-q", "main"], { cwd: fixture.root });
      execFileSync("git", ["merge", "--no-ff", "-qm", "merge early branch", "pre-introduction"], { cwd: fixture.root });
    } else {
      execFileSync("git", ["merge", "--no-ff", "-qm", "merge introduction", "main"], { cwd: fixture.root });
    }
    assert.deepEqual(immutableSingleIntroduction(fixture.root, fixture.path), {
      introductionCommit: fixture.introduction,
      introducedBytes: "original\n",
    });
  }
});

test("immutable records survive GitHub's exact synthetic merge topology", (t) => {
  const fixture = retainedMergeFixture(t, "github-synthetic");
  execFileSync("git", ["checkout", "-q", "main"], { cwd: fixture.root });
  execFileSync("git", ["checkout", "-qb", "pull-request-head"], { cwd: fixture.root });
  writeFileSync(join(fixture.root, "pull-request-change"), "unrelated\n");
  execFileSync("git", ["add", "."], { cwd: fixture.root });
  execFileSync("git", ["commit", "-qm", "pull request head"], { cwd: fixture.root });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: fixture.root, encoding: "utf8" }).trim();
  const synthetic = execFileSync(
    "git",
    ["commit-tree", tree, "-p", fixture.introduction, "-p", head, "-m", "synthetic pull request merge"],
    { cwd: fixture.root, encoding: "utf8" },
  ).trim();
  execFileSync("git", ["reset", "--hard", synthetic], { cwd: fixture.root, stdio: "ignore" });

  expectParents(fixture.root, synthetic, [fixture.introduction, head]);
  assert.deepEqual(immutableSingleIntroduction(fixture.root, fixture.path), {
    introductionCommit: fixture.introduction,
    introducedBytes: "original\n",
  });
});

function expectParents(root, commit, expected) {
  const [, ...parents] = execFileSync("git", ["rev-list", "--parents", "-n", "1", commit], {
    cwd: root,
    encoding: "utf8",
  }).trim().split(" ");
  assert.deepEqual(parents, expected);
}

test("immutable records reject side-branch rewrite or delete restored before merge", (t) => {
  for (const mutation of ["rewrite", "delete"]) {
    const fixture = retainedMergeFixture(t, `side-${mutation}-restore`);
    execFileSync("git", ["checkout", "-q", "main"], { cwd: fixture.root });
    execFileSync("git", ["checkout", "-qb", `side-${mutation}`], { cwd: fixture.root });
    if (mutation === "rewrite") {
      writeFileSync(fixture.absolute, "divergent\n");
      execFileSync("git", ["commit", "-qam", "rewrite retained record"], { cwd: fixture.root });
    } else {
      rmSync(fixture.absolute);
      execFileSync("git", ["add", "-u", fixture.path], { cwd: fixture.root });
      execFileSync("git", ["commit", "-qm", "delete retained record"], { cwd: fixture.root });
    }
    writeFileSync(fixture.absolute, "original\n");
    execFileSync("git", ["add", fixture.path], { cwd: fixture.root });
    execFileSync("git", ["commit", "-qm", "restore retained record"], { cwd: fixture.root });
    execFileSync("git", ["checkout", "-q", "main"], { cwd: fixture.root });
    execFileSync("git", ["merge", "--no-ff", "-qm", "merge restored side branch", `side-${mutation}`], {
      cwd: fixture.root,
    });
    assert.throws(
      () => immutableSingleIntroduction(fixture.root, fixture.path),
      mutation === "delete" ? /one immutable introduction|touched after/ : /touched after/,
    );
  }
});

test("immutable records reject a divergent merge parent", (t) => {
  const fixture = retainedMergeFixture(t, "divergent-parent");
  execFileSync("git", ["checkout", "-q", "main"], { cwd: fixture.root });
  execFileSync("git", ["checkout", "-qb", "divergent", fixture.introduction], { cwd: fixture.root });
  writeFileSync(fixture.absolute, "divergent\n");
  execFileSync("git", ["commit", "-qam", "diverge retained record"], { cwd: fixture.root });
  execFileSync("git", ["checkout", "-q", "main"], { cwd: fixture.root });
  execFileSync("git", ["merge", "--no-ff", "-s", "ours", "-qm", "retain original", "divergent"], { cwd: fixture.root });
  assert.throws(() => immutableSingleIntroduction(fixture.root, fixture.path), /touched after/);
});

test("immutable records reject delete-and-restore through a merge", (t) => {
  const fixture = retainedMergeFixture(t, "delete-restore");
  execFileSync("git", ["checkout", "-q", "main"], { cwd: fixture.root });
  execFileSync("git", ["checkout", "-qb", "deleted", fixture.introduction], { cwd: fixture.root });
  rmSync(fixture.absolute);
  execFileSync("git", ["add", "-u", fixture.path], { cwd: fixture.root });
  execFileSync("git", ["commit", "-qm", "delete retained record"], { cwd: fixture.root });
  execFileSync("git", ["checkout", "-q", "main"], { cwd: fixture.root });
  execFileSync("git", ["merge", "--no-ff", "-s", "ours", "-qm", "restore from main", "deleted"], { cwd: fixture.root });
  assert.throws(() => immutableSingleIntroduction(fixture.root, fixture.path), /touched after/);
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

test("trusted provenance source is post-qualification, pre-publication, and candidate-identical", (t) => {
  const root = mkdtempSync(join(tmpdir(), "later-publication-provenance-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root }); execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root }); execFileSync("git", ["config", "user.name", "test"], { cwd: root });
  const commit = (name) => { writeFileSync(join(root, "evidence"), `${name}\n`); execFileSync("git", ["add", "."], { cwd: root }); execFileSync("git", ["commit", "-qm", name], { cwd: root }); return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); };
  const reviewed = commit("reviewed"); const qualificationIntroduction = commit("qualification"); const sourceSha = commit("publish source");
  execFileSync("git", ["checkout", "-qb", "sibling", qualificationIntroduction], { cwd: root }); const siblingSource = commit("sibling source"); execFileSync("git", ["checkout", "-q", "-"], { cwd: root }); const publicationIntroduction = commit("publication");
  const candidate = { packageTreeSha1: "a".repeat(40), packageManifestSha256: "b".repeat(64), policySha256: "c".repeat(64), adapterSha256: "d".repeat(64), fixtureSetSha256: "e".repeat(64) };
  const qualification = { candidate, rootPackageJsonSha256: "f".repeat(64), rootPackageLockSha256: "1".repeat(64), archetypes: [{ kind: "current-direct", status: "qualified" }], transcript: { dimensions: [{ dimension: "rollback", status: "supported" }] } };
  const matching = () => ({ ...candidate, rootPackageJsonSha256: qualification.rootPackageJsonSha256, rootPackageLockSha256: qualification.rootPackageLockSha256, archetypes: qualification.archetypes, dimensions: qualification.transcript.dimensions });
  assert.equal(trustedProvenanceSourceValid(root, qualification, qualificationIntroduction, publicationIntroduction, sourceSha, { joinsAt: matching }), true);
  assert.equal(trustedProvenanceSourceValid(root, qualification, qualificationIntroduction, publicationIntroduction, qualificationIntroduction, { joinsAt: matching }), false);
  assert.equal(trustedProvenanceSourceValid(root, qualification, qualificationIntroduction, publicationIntroduction, reviewed, { joinsAt: matching }), false);
  assert.equal(trustedProvenanceSourceValid(root, qualification, qualificationIntroduction, publicationIntroduction, siblingSource, { joinsAt: matching }), false);
  for (const key of ["packageTreeSha1", "packageManifestSha256", "rootPackageJsonSha256", "rootPackageLockSha256", "policySha256", "adapterSha256", "fixtureSetSha256", "archetypes", "dimensions"]) {
    assert.equal(trustedProvenanceSourceValid(root, qualification, qualificationIntroduction, publicationIntroduction, sourceSha, { joinsAt: () => ({ ...matching(), [key]: key === "archetypes" || key === "dimensions" ? [] : "0".repeat(64) }) }), false, key);
  }
});

test("v3 source evidence permits exactly root resolution drift and no package-policy substitution", (t) => {
  const root = mkdtempSync(join(tmpdir(), "later-publication-replay-source-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root }); execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root }); execFileSync("git", ["config", "user.name", "test"], { cwd: root });
  const commit = (name) => { writeFileSync(join(root, "evidence"), `${name}\n`); execFileSync("git", ["add", "."], { cwd: root }); execFileSync("git", ["commit", "-qm", name], { cwd: root }); return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); };
  const qualificationIntroduction = commit("qualification"); const sourceSha = commit("source"); const publicationIntroduction = commit("publication");
  const replayQualification = { ...qualification, candidate: { ...candidate, policySha256: hex("3", 64), adapterSha256: hex("4", 64), fixtureSetSha256: hex("5", 64) }, archetypes: [{ kind: "current-direct", status: "qualified" }], transcript: { dimensions: [{ dimension: "rollback", status: "supported" }] } };
  const source = { reviewedCommit: replayQualification.reviewedCommit, qualificationRoots: { packageJsonSha256: replayQualification.rootPackageJsonSha256, packageLockSha256: replayQualification.rootPackageLockSha256 }, publicationSource: { sha: sourceSha, rootPackageJsonSha256: hex("7", 64), rootPackageLockSha256: hex("8", 64) } };
  const joins = () => ({ packageTreeSha1: candidate.packageTreeSha1, packageManifestSha256: candidate.packageManifestSha256, policySha256: hex("3", 64), adapterSha256: hex("4", 64), fixtureSetSha256: hex("5", 64), rootPackageJsonSha256: hex("7", 64), rootPackageLockSha256: hex("8", 64), archetypes: replayQualification.archetypes, dimensions: replayQualification.transcript.dimensions });
  assert.equal(trustedReplaySourceEvidence(root, replayQualification, qualificationIntroduction, publicationIntroduction, source, { joinsAt: joins }).valid, true);
  const sourceAtHead = structuredClone(source); sourceAtHead.publicationSource.sha = publicationIntroduction;
  assert.equal(trustedReplaySourceEvidence(root, replayQualification, qualificationIntroduction, publicationIntroduction, sourceAtHead, { joinsAt: joins, allowSourceAtPublication: true }).valid, true);
  assert.equal(trustedReplaySourceEvidence(root, replayQualification, qualificationIntroduction, publicationIntroduction, sourceAtHead, { joinsAt: joins }).valid, false);
  for (const mutate of [
    (value) => { value.publicationSource.sha = qualificationIntroduction; },
    (value) => { value.publicationSource.sha = publicationIntroduction; },
    (value) => { value.qualificationRoots.packageJsonSha256 = hex("0", 64); },
    (value) => { value.publicationSource.rootPackageJsonSha256 = replayQualification.rootPackageJsonSha256; },
    (value) => { value.publicationSource.rootPackageLockSha256 = replayQualification.rootPackageLockSha256; },
  ]) { const hostile = structuredClone(source); mutate(hostile); assert.equal(trustedReplaySourceEvidence(root, replayQualification, qualificationIntroduction, publicationIntroduction, hostile, { joinsAt: joins }).valid, false); }
  for (const field of ["packageTreeSha1", "packageManifestSha256", "policySha256", "adapterSha256", "fixtureSetSha256", "archetypes", "dimensions"]) {
    assert.equal(trustedReplaySourceEvidence(root, replayQualification, qualificationIntroduction, publicationIntroduction, source, { joinsAt: () => ({ ...joins(), [field]: field === "archetypes" || field === "dimensions" ? [] : hex("0", 64) }) }).valid, false, field);
  }
});

test("trusted-publication v2 binds immutable provenance to the qualified served bytes", () => {
  const trusted = source();
  trusted.schemaVersion = 2;
  trusted.kind = "foundry-trusted-publication-v2";
  trusted.publication.mode = "trusted-publisher";
  trusted.publication.reference = "https://github.com/clossys/foundry/actions/runs/123";
  trusted.publication.provenance = {
    repository: "https://github.com/clossys/foundry", workflow: ".github/workflows/publish.yml", ref: "refs/heads/main", event: "workflow_dispatch",
    sourceSha: qualification.reviewedCommit, builder: "https://github.com/actions/runner/github-hosted",
    invocation: "https://github.com/clossys/foundry/actions/runs/123/attempts/1",
    attestationUrl: "https://registry.npmjs.org/-/npm/v1/attestations/%40clossys%2Fstrategist%400.1.1",
  };
  trusted.registryProof = { schemaVersion: 2, kind: "public-npm-anonymous-registry-proof-v2", evidence: {
    ...trusted.registryProof.evidence, metadataUrl: publicNpmVersionUrl(PUBLIC_NPM_REGISTRY, candidate.name, candidate.version), repository: "clossys/foundry",
  } };
  delete trusted.registryProof.evidence.packumentUrl;
  assert.deepEqual(rules(trusted), []);
  for (const mutate of [
    (value) => { value.publication.reference = "https://github.com/clossys/foundry/actions/runs/999"; },
    (value) => { value.publication.provenance.repository = historicalRepository; },
    (value) => { value.publication.provenance.repository = historicalRepository; value.publication.provenance.sourceSha = "b".repeat(40); },
    (value) => { value.publication.provenance.repository = historicalRepository; value.publication.provenance.invocation = "https://github.com/clossys/foundry/actions/runs/999/attempts/1"; },
    (value) => { value.publication.provenance.workflow = ".github/workflows/other.yml"; },
    (value) => { value.publication.provenance.invocation = "https://github.com/clossys/foundry/actions/runs/123"; },
    (value) => { value.publication.provenance.attestationUrl = "https://registry.npmjs.org/-/npm/v1/attestations/other"; },
    (value) => { value.registryProof.evidence.repository = "clossys/other"; },
    (value) => { value.registryProof.evidence.sha512 = "0".repeat(128); },
  ]) { const value = structuredClone(trusted); mutate(value); assert.ok(rules(value, { provenanceSourceValid: value.publication.provenance.repository === historicalRepository }).length > 0); }
  assert.ok(rules(trusted, { provenanceSourceValid: false }).includes("publication-provenance"));
  const unrelatedSource = structuredClone(trusted); unrelatedSource.publication.provenance.sourceSha = "b".repeat(40);
  assert.ok(rules(unrelatedSource, { provenanceSourceValid: false }).includes("publication-provenance"));
  const wrongSubject = structuredClone(trusted); wrongSubject.registryProof.evidence.sha512 = "0".repeat(128);
  assert.ok(rules(wrongSubject).includes("attestation-subject"));
  const v1Proof = structuredClone(trusted); v1Proof.registryProof = source().registryProof;
  assert.ok(rules(v1Proof).includes("registry-proof"));
});

function replayRecord() {
  const value = source();
  value.schemaVersion = 3;
  value.kind = "foundry-trusted-publication-replay-v3";
  value.publication = {
    mode: "trusted-publisher", publishedAt: "2026-08-30T00:00:00.000Z", reference: "https://github.com/clossys/foundry/actions/runs/123",
    provenance: {
      repository: "https://github.com/clossys/foundry", workflow: ".github/workflows/publish.yml", ref: "refs/heads/main", event: "workflow_dispatch",
      sourceSha: hex("6", 40), builder: "https://github.com/actions/runner/github-hosted", invocation: "https://github.com/clossys/foundry/actions/runs/123/attempts/1",
      attestationUrl: "https://registry.npmjs.org/-/npm/v1/attestations/%40clossys%2Fstrategist%400.1.1",
    },
  };
  value.registryProof = { schemaVersion: 2, kind: "public-npm-anonymous-registry-proof-v2", evidence: {
    ...value.registryProof.evidence, metadataUrl: publicNpmVersionUrl(PUBLIC_NPM_REGISTRY, candidate.name, candidate.version), repository: "clossys/foundry",
  } };
  delete value.registryProof.evidence.packumentUrl;
  value.source = {
    reviewedCommit: qualification.reviewedCommit,
    qualificationRoots: { packageJsonSha256: qualification.rootPackageJsonSha256, packageLockSha256: qualification.rootPackageLockSha256 },
    publicationSource: { sha: hex("6", 40), rootPackageJsonSha256: hex("7", 64), rootPackageLockSha256: hex("8", 64) },
  };
  value.runQualification = {
    run: { id: 123, url: "https://github.com/clossys/foundry/actions/runs/123", headSha: hex("6", 40), conclusion: "failure", qualificationJob: { id: 124, name: "qualify (strategist)", conclusion: "success", url: "https://github.com/clossys/foundry/actions/runs/123/job/124" } },
    artifact: { id: 125, name: "qualified-candidate-strategist", archiveSha256: `sha256:${hex("9", 64)}`, size: 42, url: "https://api.github.com/repos/clossys/foundry/actions/artifacts/125/zip" },
    transcript: { rawSha256: hex("a", 64), canonicalSha256: qualification.transcript?.canonicalSha256 ?? hex("b", 64), candidateTarball: structuredClone(candidate.tarball) },
    publicationJob: { id: 126, name: "publish (strategist)", conclusion: "success", url: "https://github.com/clossys/foundry/actions/runs/123/job/126" },
    anonymousRegistry: { packumentSha256: hex("c", 64), auditSha256: hex("d", 64), provenanceBundleSha256: hex("e", 64), signatureSha256: hex("f", 64), signatureKeyids: ["SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U"], attestationUrl: "https://registry.npmjs.org/-/npm/v1/attestations/%40clossys%2Fstrategist%400.1.1" },
  };
  return value;
}

test("v3 replay evidence is closed around root-only drift, exact jobs, artifact, transcript, signatures, and attestation", () => {
  const value = replayRecord();
  assert.deepEqual(rules(value, { replaySourceEvidence: { valid: true } }), []);
  const attacks = [
    (record) => { record.publication.provenance.sourceSha = hex("0", 40); },
    (record) => { record.runQualification.run.qualificationJob.conclusion = "failure"; },
    (record) => { record.runQualification.transcript.candidateTarball.sha256 = hex("0", 64); },
    (record) => { record.runQualification.transcript.canonicalSha256 = hex("0", 64); },
    (record) => { record.runQualification.publicationJob.name = "publish (other)"; },
    (record) => {
      record.publication.reference = "https://github.com/clossys/foundry/actions/runs/999";
      record.publication.provenance.invocation = "https://github.com/clossys/foundry/actions/runs/999/attempts/1";
    },
    (record) => { record.runQualification.anonymousRegistry.attestationUrl = "https://registry.npmjs.org/-/npm/v1/attestations/other"; },
    (record) => { record.runQualification.anonymousRegistry.signatureKeyids = []; },
  ];
  for (const [index, attack] of attacks.entries()) { const hostile = replayRecord(); attack(hostile); assert.ok(rules(hostile, { replaySourceEvidence: { valid: true } }).length > 0, `attack ${index}`); }
  assert.ok(rules(value).includes("replay-source"));
});

test("only the three retained historical release tuples may use the retired provenance repository", () => {
  const result = validateRetainedLaterPublications(process.cwd());
  assert.deepEqual(result.findings, []);
  const records = ["advisor-0.1.5", "starter-0.1.4", "controller-0.8.23"];
  for (const record of records) assert.equal(JSON.parse(readFileSync(`governance/release-publications/later/${record}.json`, "utf8")).publication.provenance.repository, historicalRepository);
});
