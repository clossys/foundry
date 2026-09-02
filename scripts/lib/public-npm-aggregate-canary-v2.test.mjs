import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { AggregateUnavailableError, containedRegularDirectory } from "./public-npm-aggregate-canary.mjs";
import {
  AGGREGATE_V2_CANARY_PATH,
  AGGREGATE_V2_CLOSURE_DIRECTORY,
  AGGREGATE_V2_TRANSCRIPT_DIRECTORY,
  aggregateV2ErrorExitCode,
  aggregateV2GitHistory,
  aggregateV2PlanSha256,
  buildAggregateV2Closure,
  canonicalJson,
  parseAggregateV2Cli,
  readAggregateV2Head,
  retainAggregateV2Transcript,
  runAggregatePublicNpmCanaryV2,
  validateAggregateV2Closure,
  validateAggregateV2Plan,
  validateAggregateV2PlanHistory,
  validateAggregateV2RecordSets,
  validateAggregateV2Transcript,
  validateCommittedV2LaterPublication,
} from "./public-npm-aggregate-canary-v2.mjs";

const plan = JSON.parse(readFileSync("governance/public-npm-aggregate-canary-v2.json", "utf8"));
const clone = function (value) { return structuredClone(value); };
const hash = function (value) { return createHash("sha256").update(value).digest("hex"); };
const read = function (path) { return readFileSync(path, "utf8"); };
const stable = function (value) {
  return Array.isArray(value) ? value.map(stable) : value !== null && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(function (key) { return [key, stable(value[key])]; })) : value;
};

function fixture() {
  const qualifications = new Map(plan.selectedEvidence.map(function (entry) { return [entry.path, read(entry.path)]; }));
  const laterTemplate = JSON.parse(read("governance/release-publications/later/designer-0.2.7.json"));
  const publications = new Map();
  for (const entry of plan.packages) {
    const qualification = plan.selectedEvidence.find(function (item) { return item.packageKey === entry.packageKey; });
    const publication = clone(laterTemplate);
    const candidate = JSON.parse(qualifications.get(qualification.path)).candidate;
    publication.qualification = { path: qualification.path, sha256: qualification.sha256 };
    publication.candidate = { name: candidate.name, version: candidate.version, packageTreeSha1: candidate.packageTreeSha1, packageManifestSha256: candidate.packageManifestSha256, tarball: candidate.tarball };
    publication.catalog.packageKey = entry.packageKey;
    Object.assign(publication.registryProof.evidence, { name: candidate.name, version: candidate.version, shasum: candidate.tarball.sha1, sha256: candidate.tarball.sha256, sha512: candidate.tarball.sha512, packedManifestSha256: candidate.packageManifestSha256 });
    publications.set("governance/release-publications/later/" + entry.packageKey + "-" + entry.version + ".json", JSON.stringify(publication));
  }
  const values = new Map(qualifications);
  for (const [path, bytes] of publications) values.set(path, bytes);
  const readCommitted = function (path) { return values.get(path) ?? read(path); };
  const generated = buildAggregateV2Closure({ root: null, plan, read: readCommitted, publicationPaths: [...publications.keys()] });
  return { generated, publications, readCommitted, values };
}

test("v2 freezes all nineteen exact current releases", function () {
  assert.deepEqual(validateAggregateV2Plan(plan, { read }), []);
  assert.equal(plan.packages[5].version, "0.2.7");
  assert.equal(plan.packages[18].version, "0.2.1");
  assert.equal(plan.selectedEvidence[5].sha256, "8da2f28f6e5beacde80ccd2abfa302409c49a16a49c3c3ee6b88172787a6f924");
  assert.equal(plan.selectedEvidence[18].sha256, "09b575475a1991cf7fcf157f39c250df323a496447f3ca2391ee119794f4fb36");
  assert.equal(aggregateV2PlanSha256(plan), aggregateV2PlanSha256(clone(plan)));
});

test("v2 rejects stale rows and qualification rewrites", function () {
  const stale = clone(plan);
  stale.packages[5].version = "0.2.5";
  stale.selectedEvidence[5] = {
    packageKey: "designer",
    path: "governance/release-qualifications/clossys-designer-0.2.5.json",
    sha256: "959b7eeb2c51806f7e64884a83b68d77b37873c3d101e8736489ab65d7a73d5d",
  };
  assert.ok(validateAggregateV2Plan(stale, { read }).some(function (finding) { return finding.rule === "package-identity"; }));
  const swapped = clone(plan);
  swapped.selectedEvidence[0].path = swapped.selectedEvidence[1].path;
  assert.ok(validateAggregateV2Plan(swapped, { read }).length > 0);
  const peerRewrite = clone(plan);
  peerRewrite.peerResolution.requested.react = "19.2.7";
  assert.ok(validateAggregateV2Plan(peerRewrite, { read }).some(function (finding) { return finding.rule === "peer-resolution"; }));
  const matrixRewrite = clone(plan);
  matrixRewrite.optionalPeerMatrix.find(function (row) { return row.packageKey === "publisher"; }).version = "0.1.11";
  assert.ok(validateAggregateV2Plan(matrixRewrite, { read }).some(function (finding) { return finding.rule === "optional-peer-row"; }));
});

test("closure creation requires exactly one committed publication blob per selected row", function () {
  const { generated, publications, readCommitted } = fixture();
  assert.deepEqual(validateAggregateV2Closure(generated.closure, plan, { read: readCommitted, root: null }), []);
  const duplicate = new Map(publications);
  duplicate.set("governance/release-publications/later/duplicate-0.0.1.json", publications.get("governance/release-publications/later/designer-0.2.7.json"));
  assert.throws(function () {
    return buildAggregateV2Closure({ root: null, plan, read: function (path) { return duplicate.get(path) ?? readCommitted(path); }, publicationPaths: [...duplicate.keys()] });
  }, /exactly one committed publication/);
  assert.throws(function () {
    return buildAggregateV2Closure({ root: null, plan, read: readCommitted, publicationPaths: [...publications.keys(), "governance/release-publications/later/designer-0.2.7.json"] });
  }, /canonical committed later-publication path list/);
  const missing = [...publications.keys()].filter(function (path) { return !path.endsWith("publisher-0.2.1.json"); });
  assert.throws(function () {
    return buildAggregateV2Closure({ root: null, plan, read: readCommitted, publicationPaths: missing });
  }, /requires exactly one committed publication/);
});

test("v2 plan history refuses every post-introduction rewrite", function () {
  const introduction = [{ commit: "a".repeat(40), status: "A", sha256: "b".repeat(64) }];
  assert.deepEqual(validateAggregateV2PlanHistory({ history: introduction, parentCount: function () { return 1; } }), []);
  assert.ok(validateAggregateV2PlanHistory({
    history: [{ commit: "c".repeat(40), status: "M", sha256: "d".repeat(64) }, ...introduction],
    parentCount: function () { return 1; },
  }).length > 0);
});

test("v2 plan history follows real merge parents to one direct introduction", async function () {
  const makeRepository = async function (prefix) {
    const root = await mkdtemp(join(tmpdir(), prefix));
    for (const [command, args] of [
      ["git", ["init", "-q", "-b", "main"]],
      ["git", ["config", "user.email", "v2-history@example.invalid"]],
      ["git", ["config", "user.name", "v2 history"]],
      ["git", ["commit", "--allow-empty", "-qm", "root"]],
    ]) execFileSync(command, args, { cwd: root });
    return root;
  };
  const commit = async function (root, path, bytes, message) {
    await mkdir(join(root, dirname(path)), { recursive: true });
    await writeFile(join(root, path), bytes);
    execFileSync("git", ["add", path], { cwd: root });
    execFileSync("git", ["commit", "-qm", message], { cwd: root });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  };
  const parents = function (root, revision) {
    return execFileSync("git", ["rev-list", "--parents", "-n", "1", revision], { cwd: root, encoding: "utf8" }).trim().split(/\s+/).length - 1;
  };
  const preservedMerge = async function (label) {
    const root = await makeRepository("foundry-v2-" + label + "-");
    execFileSync("git", ["checkout", "-qb", "review-head"], { cwd: root });
    const introduction = await commit(root, AGGREGATE_V2_CANARY_PATH, "{\"v2\":true}\n", "introduce v2 plan");
    execFileSync("git", ["checkout", "-q", "main"], { cwd: root });
    await commit(root, "governance/unrelated-" + label + ".txt", label + "\n", "target change");
    execFileSync("git", ["merge", "--no-ff", "-qm", label + " merge", "review-head"], { cwd: root });
    const history = aggregateV2GitHistory({ root });
    assert.deepEqual(history.map(function (entry) { return [entry.commit, entry.status]; }), [[introduction, "A"]]);
    assert.deepEqual(validateAggregateV2PlanHistory({ history, parentCount: function (revision) { return parents(root, revision); } }), []);
  };
  await preservedMerge("github-synthetic");
  await preservedMerge("content-preserving");

  const mergeOnly = await makeRepository("foundry-v2-history-merge-only-");
  execFileSync("git", ["checkout", "-qb", "left"], { cwd: mergeOnly });
  const left = await commit(mergeOnly, "governance/left.txt", "left\n", "left change");
  execFileSync("git", ["checkout", "-q", "main"], { cwd: mergeOnly });
  const right = await commit(mergeOnly, "governance/right.txt", "right\n", "right change");
  await writeFile(join(mergeOnly, AGGREGATE_V2_CANARY_PATH), "{\"v2\":true}\n");
  execFileSync("git", ["add", AGGREGATE_V2_CANARY_PATH], { cwd: mergeOnly });
  const tree = execFileSync("git", ["write-tree"], { cwd: mergeOnly, encoding: "utf8" }).trim();
  const synthetic = execFileSync("git", ["commit-tree", tree, "-p", left, "-p", right, "-m", "merge-only v2 plan"], { cwd: mergeOnly, encoding: "utf8" }).trim();
  execFileSync("git", ["update-ref", "refs/heads/main", synthetic], { cwd: mergeOnly });
  let history = aggregateV2GitHistory({ root: mergeOnly });
  assert.deepEqual(history.map(function (entry) { return entry.status; }), ["M"]);
  assert.ok(validateAggregateV2PlanHistory({ history, parentCount: function (revision) { return parents(mergeOnly, revision); } }).length > 0);

  const hostile = await makeRepository("foundry-v2-history-hostile-");
  execFileSync("git", ["checkout", "-qb", "rewrite"], { cwd: hostile });
  await commit(hostile, AGGREGATE_V2_CANARY_PATH, "{\"v2\":true}\n", "introduce v2 plan");
  await commit(hostile, AGGREGATE_V2_CANARY_PATH, "{\"v2\":false}\n", "rewrite v2 plan");
  execFileSync("git", ["checkout", "-q", "main"], { cwd: hostile });
  await commit(hostile, "governance/target.txt", "target\n", "target change");
  execFileSync("git", ["merge", "--no-ff", "-qm", "merge conflicting parent", "rewrite"], { cwd: hostile });
  history = aggregateV2GitHistory({ root: hostile });
  assert.ok(history.some(function (entry) { return entry.status === "M"; }));
  assert.ok(validateAggregateV2PlanHistory({ history, parentCount: function (revision) { return parents(hostile, revision); } }).length > 0);

  const deleted = await makeRepository("foundry-v2-history-delete-");
  const introduction = await commit(deleted, AGGREGATE_V2_CANARY_PATH, "{\"v2\":true}\n", "introduce v2 plan");
  execFileSync("git", ["checkout", "-qb", "delete-path"], { cwd: deleted });
  execFileSync("git", ["rm", "-q", AGGREGATE_V2_CANARY_PATH], { cwd: deleted });
  execFileSync("git", ["commit", "-qm", "delete v2 plan"], { cwd: deleted });
  execFileSync("git", ["checkout", "-q", "main"], { cwd: deleted });
  await commit(deleted, "governance/target.txt", "target\n", "target change");
  execFileSync("git", ["merge", "--no-ff", "-qm", "merge deleted parent", "delete-path"], { cwd: deleted });
  history = aggregateV2GitHistory({ root: deleted });
  assert.ok(history.some(function (entry) { return entry.status === "D"; }));
  assert.ok(history.some(function (entry) { return entry.commit === introduction && entry.status === "A"; }));
  assert.ok(validateAggregateV2PlanHistory({ history, parentCount: function (revision) { return parents(deleted, revision); } }).length > 0);
});

test("v2 committed reads ignore a hostile working-tree mutation", async function () {
  const root = await mkdtemp(join(tmpdir(), "foundry-v2-head-"));
  await mkdir(join(root, "governance"), { recursive: true });
  await writeFile(join(root, "governance", "record.json"), "committed\n");
  for (const [command, args] of [
    ["git", ["init", "-q"]],
    ["git", ["config", "user.email", "v2-test@example.invalid"]],
    ["git", ["config", "user.name", "v2 test"]],
    ["git", ["add", "governance/record.json"]],
    ["git", ["commit", "-qm", "record"]],
  ]) execFileSync(command, args, { cwd: root });
  await writeFile(join(root, "governance", "record.json"), "hostile working tree\n");
  assert.equal(readAggregateV2Head(root, "governance/record.json"), "committed\n");
});

test("v2 runner defaults every evidence read to committed HEAD", async function () {
  const root = await mkdtemp(join(tmpdir(), "foundry-v2-runner-head-"));
  const { generated, values } = fixture();
  values.set(AGGREGATE_V2_CANARY_PATH, JSON.stringify(plan));
  for (const [path, bytes] of values) {
    await mkdir(join(root, dirname(path)), { recursive: true });
    await writeFile(join(root, path), bytes);
  }
  for (const [command, args] of [
    ["git", ["init", "-q"]],
    ["git", ["config", "user.email", "v2-test@example.invalid"]],
    ["git", ["config", "user.name", "v2 test"]],
    ["git", ["add", "governance"]],
    ["git", ["commit", "-qm", "v2 evidence"]],
  ]) execFileSync(command, args, { cwd: root });
  await writeFile(join(root, plan.selectedEvidence[0].path), "hostile working tree mutation");
  await assert.rejects(function () {
    return runAggregatePublicNpmCanaryV2({
      root,
      plan,
      closure: generated.closure,
      closurePath: generated.closurePath,
      environment: {},
      validationRoot: null,
      verifyArtifact: async function () { return { kind: "unreachable" }; },
    });
  }, function (error) { return error instanceof AggregateUnavailableError; });
});

test("v2 retained transcript refuses traversal and any symlinked parent", async function () {
  const root = await mkdtemp(join(tmpdir(), "foundry-v2-containment-"));
  await assert.rejects(function () {
    return containedRegularDirectory(root, "../outside");
  }, /escapes the repository root/);
  const outside = await mkdtemp(join(tmpdir(), "foundry-v2-outside-"));
  await symlink(outside, join(root, "governance"));
  await assert.rejects(function () {
    return retainAggregateV2Transcript({ root, transcript: { canonicalSha256: "b".repeat(64) } });
  }, /symlink/);
});

test("v2 rejects competing direct closure and transcript records", function () {
  const path = function (directory, char) { return directory + "/current-release-" + char.repeat(64) + ".json"; };
  const findings = validateAggregateV2RecordSets({
    closureRecords: {
      introduced: [path(AGGREGATE_V2_CLOSURE_DIRECTORY, "a"), path(AGGREGATE_V2_CLOSURE_DIRECTORY, "b")],
      current: [path(AGGREGATE_V2_CLOSURE_DIRECTORY, "a"), path(AGGREGATE_V2_CLOSURE_DIRECTORY, "b")],
    },
    transcriptRecords: {
      introduced: [path(AGGREGATE_V2_TRANSCRIPT_DIRECTORY, "c"), path(AGGREGATE_V2_TRANSCRIPT_DIRECTORY, "d")],
      current: [path(AGGREGATE_V2_TRANSCRIPT_DIRECTORY, "c"), path(AGGREGATE_V2_TRANSCRIPT_DIRECTORY, "d")],
    },
  });
  assert.ok(findings.some(function (finding) { return finding.rule === "closure-singularity"; }));
  assert.ok(findings.some(function (finding) { return finding.rule === "transcript-singularity"; }));
  assert.ok(findings.some(function (finding) { return finding.rule === "transcript-closure"; }));
});

test("registry unavailability remains an exit-2 indeterminate result", async function () {
  const { generated, readCommitted } = fixture();
  await assert.rejects(function () {
    return runAggregatePublicNpmCanaryV2({
      root: process.cwd(),
      plan,
      closure: generated.closure,
      closurePath: generated.closurePath,
      read: readCommitted,
      environment: {},
      validationRoot: null,
      verifyArtifact: async function () { return { kind: "unreachable" }; },
    });
  }, function (error) { return error instanceof AggregateUnavailableError; });
  assert.equal(aggregateV2ErrorExitCode(new AggregateUnavailableError("network")), 2);
  assert.equal(aggregateV2ErrorExitCode(new Error("contract")), 1);
  assert.equal(hash(canonicalJson(generated.closure)).length, 64);
});

test("v2 replays every selected later-publication contract from committed HEAD", function () {
  const path = "governance/release-publications/later/advisor-0.1.6.json";
  assert.deepEqual(validateCommittedV2LaterPublication({ root: process.cwd(), path, read }), []);
  const original = JSON.parse(read(path));
  const mutations = [
    ["source", function (value) { value.source.reviewedCommit = "0".repeat(40); }, "publication-replay-source-roots"],
    ["catalog", function (value) { value.catalog.sha256 = "0".repeat(64); }, "publication-catalog-join"],
    ["provenance", function (value) { value.publication.provenance.sourceSha = "0".repeat(40); }, "publication-publication-provenance"],
    ["tarball URL", function (value) { value.registryProof.evidence.tarballUrl = "https://registry.npmjs.org/@clossys/advisor/-/wrong.tgz"; }, "publication-registry-join"],
  ];
  for (const [, mutate, rule] of mutations) {
    const altered = clone(original); mutate(altered);
    const findings = validateCommittedV2LaterPublication({ root: process.cwd(), path, read: function (item) { return item === path ? JSON.stringify(altered) : read(item); } });
    assert.ok(findings.some(function (finding) { return finding.rule === rule; }), rule);
  }
});

test("v2 closure construction rejects an advisor replay whose reviewed commit is forged", function () {
  const path = "governance/release-publications/later/advisor-0.1.6.json";
  const altered = JSON.parse(read(path));
  altered.source.reviewedCommit = "0".repeat(40);
  const publicationPaths = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "governance/release-publications/later"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  assert.throws(function () {
    return buildAggregateV2Closure({
      root: process.cwd(),
      plan,
      publicationPaths,
      read: function (item) { return item === path ? JSON.stringify(altered) : read(item); },
    });
  }, /publication-replay-source-roots/);
});

test("v2 bounds hanging anonymous registry I/O as exit-2 unavailable", async function () {
  const { generated, readCommitted } = fixture();
  let aborted = false;
  await assert.rejects(function () {
    return runAggregatePublicNpmCanaryV2({
      root: process.cwd(),
      plan,
      closure: generated.closure,
      closurePath: generated.closurePath,
      read: readCommitted,
      validationRoot: null,
      environment: {},
      externalTimeoutMs: 5,
      verifyArtifact: async function ({ fetchImpl }) { return fetchImpl("https://registry.npmjs.org/", {}); },
      fetchImpl: async function (_url, { signal }) {
        return new Promise(function (_resolve, reject) {
          signal.addEventListener("abort", function () { aborted = true; reject(signal.reason); }, { once: true });
        });
      },
    });
  }, function (error) { return error instanceof AggregateUnavailableError; });
  assert.equal(aborted, true);
});

test("v2 transcript rejects a recanonicalized forged verification tuple", async function () {
  const { generated, readCommitted } = fixture();
  const verified = async function ({ name, version }) {
    const row = generated.closure.packages.find(function (entry) { return entry.name === name && entry.version === version; });
    const publication = JSON.parse(readCommitted(row.publication.path));
    const candidate = publication.candidate;
    const evidence = publication.registryProof.evidence;
    return { kind: "verified", evidence: { ...evidence, name, version, shasum: candidate.tarball.sha1, sha256: candidate.tarball.sha256, sha512: candidate.tarball.sha512, packedManifestSha256: candidate.packageManifestSha256 } };
  };
  const result = await runAggregatePublicNpmCanaryV2({ root: process.cwd(), plan, closure: generated.closure, closurePath: generated.closurePath, read: readCommitted, validationRoot: null, environment: {}, verifyArtifact: verified });
  assert.equal(result.verdict, "satisfied");
  assert.deepEqual(validateAggregateV2Transcript(result.transcript, plan, generated.closure, { read: readCommitted }), []);
  const forged = clone(result.transcript);
  forged.execution.packages[0].verification.sha256 = "a".repeat(64);
  const forgedPayload = clone(forged);
  delete forgedPayload.canonicalSha256;
  forged.canonicalSha256 = hash(JSON.stringify(stable(forgedPayload)));
  assert.ok(validateAggregateV2Transcript(forged, plan, generated.closure, { read: readCommitted }).some(function (finding) { return finding.rule === "transcript-verification"; }));
});

test("v2 CLI and dispatch workflow are bounded, pinned, and credential-free", function () {
  assert.throws(function () { return parseAggregateV2Cli(["--closure", "../../outside"]); }, /usage/);
  const workflow = read(".github/workflows/public-npm-aggregate-canary-v2.yml");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:|push:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /node-version: 24\.19\.0/);
  assert.match(workflow, /npm@11\.17\.0/);
  assert.match(workflow, /process\.versions\.zlib/);
  assert.equal((workflow.match(/env -u NODE_AUTH_TOKEN -u NPM_TOKEN -u GH_PACKAGES_TOKEN -u GITHUB_TOKEN -u GH_TOKEN/g) ?? []).length, 3);
  assert.doesNotMatch(workflow, /secrets\.|npm publish|git commit/);
});
