import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ALL_PACKAGE_RELEASE_ORDER, aggregatePlanSha256, assertAggregateRuntime, resolveAggregateClosure, runAggregatePublicNpmCanary, sealedHistoricalRepository, validateAggregateCanary, validateAggregateCanaryAppendOnly, validateSatisfiedAggregateTranscript, validateSatisfiedTranscriptHistory } from "./public-npm-aggregate-canary.mjs";

const root = new URL("../..", import.meta.url).pathname;
const record = JSON.parse(readFileSync(new URL("../../governance/public-npm-aggregate-canary.json", import.meta.url), "utf8"));
const read = (path) => readFileSync(`${root}/${path}`, "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sha1 = "1".repeat(40), sha512 = "2".repeat(128), sha = "3".repeat(64);
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;

function satisfiedFixture() {
  const plan = structuredClone(record);
  const selected = plan.sets[0];
  const closure = { schema: "foundry-public-npm-aggregate-closure-v1", version: 1, plan: { path: "governance/public-npm-aggregate-canary.json", sha256: aggregatePlanSha256(plan) }, set: selected.id, packages: selected.packages.map((entry) => ({ name: entry.name, version: entry.version, qualification: { path: `governance/release-qualifications/${entry.packageKey}-${entry.version}.json`, sha256: sha }, publication: { path: `governance/release-publications/later/${entry.packageKey}-${entry.version}.json`, sha256: sha, member: entry.packageKey } })) };
  closure.canonicalSha256 = sha256(JSON.stringify(stable(closure)));
  const resolved = resolveAggregateClosure(plan, selected.id, closure).selected;
  const transcript = {
    schema: "foundry-public-npm-aggregate-transcript-v1", version: 1,
    plan: { path: "governance/public-npm-aggregate-canary.json", setsSha256: aggregatePlanSha256(plan), closurePath: `governance/public-npm-aggregate-closures/baseline-${closure.canonicalSha256}.json`, closureSha256: closure.canonicalSha256 },
    set: selected.id,
    repositoryRedirects: [{ historicalRepository: "clossys/platform", repository: "clossys/foundry", repositoryId: 1325931929, kind: "verified" }],
    peerResolution: { requested: plan.peerResolution.requested, actual: plan.peerResolution.requested, disposition: plan.peerResolution.disposition },
    packages: resolved.packages.map((entry) => ({ name: entry.name, version: entry.version, qualification: entry.qualification, publication: entry.publication, served: { name: entry.name, version: entry.version, packageManifestSha256: sha, tarball: { sha1, sha256: sha, sha512 } }, installedManifestSha256: sha, run: { canonicalSha256: sha } })),
    consumer: { manifestSha256: sha, lockfileSha256: sha, controller: "@clossys/controller@0.8.23", singularController: true, identities: resolved.packages.map((entry) => `${entry.name}@${entry.version}`), rollback: { packageAbsenceProven: true, manifestRestored: true, lockfileRestored: true, identitiesRestored: true } },
    dimensions: ["exports", "framework", "bins", "cases", "optionalPeers", "rollback"].map((dimension) => ({ dimension, count: 1, ok: true })),
  };
  transcript.canonicalSha256 = sha256(JSON.stringify(stable(transcript)));
  return { plan, closure, transcript };
}

test("aggregate record closes both frozen 19-package version sets without claiming pending publication", () => {
  assert.deepEqual(validateAggregateCanary(record, { read }), []);
  assert.deepEqual(record.sets.map((set) => set.packages.map((entry) => entry.packageKey)), [ALL_PACKAGE_RELEASE_ORDER, ALL_PACKAGE_RELEASE_ORDER]);
  assert.deepEqual(record.sets.flatMap((set) => set.packages).find((entry) => entry.packageKey === "publisher" && entry.version === "0.1.8"), { packageKey: "publisher", name: "@clossys/publisher", version: "0.1.8" });
});

test("aggregate record fails closed on ordering and non-identity plan rows", () => {
  for (const mutate of [
    (copy) => { [copy.sets[0].packages[0], copy.sets[0].packages[1]] = [copy.sets[0].packages[1], copy.sets[0].packages[0]]; },
    (copy) => { copy.sets[1].packages[0].publication = { path: "fabricated" }; },
  ]) {
    const copy = structuredClone(record);
    mutate(copy);
    assert.ok(validateAggregateCanary(copy, { read }).length > 0);
  }
});

test("introduced aggregate plan is immutable", () => {
  const rewritten = structuredClone(record);
  rewritten.sets[0].packages[0].version = "9.9.9";
  assert.ok(validateAggregateCanaryAppendOnly(rewritten, { readHead: () => JSON.stringify(record) }).some((item) => item.rule === "plan-rewrite"));
  const matrixRewrite = structuredClone(record);
  const peerRow = matrixRewrite.optionalPeerMatrix.find((row) => row.peers.length > 0);
  peerRow.peers[0].outcomes = {};
  assert.ok(validateAggregateCanaryAppendOnly(matrixRewrite, { readHead: () => JSON.stringify(record) }).some((item) => item.rule === "plan-rewrite"));
});

test("live runner makes no registry request while any frozen member is held or pending", async () => {
  let calls = 0;
  const result = await runAggregatePublicNpmCanary({ root, record, environment: {}, fetchImpl: async () => { calls += 1; throw new Error("unexpected registry access"); } });
  assert.equal(result.verdict, "indeterminate");
  assert.equal(result.reason, "publication-records-pending");
  assert.equal(calls, 0);
  assert.ok(result.pending.length > 0);
});

test("credential-bearing parent environments are rejected before any live aggregate work", async () => {
  await assert.rejects(() => runAggregatePublicNpmCanary({ root, record, environment: { NPM_TOKEN: "test-only-credential" } }), /credential-bearing/);
});

test("aggregate runner pins the required Node/npm/zlib tuple", () => {
  assert.doesNotThrow(() => assertAggregateRuntime({ node: "v24.19.0", npm: "11.17.0", zlib: "1.3.2.1-motley-3246f1b" }));
  assert.throws(() => assertAggregateRuntime({ node: "v24.15.0", npm: "11.17.0", zlib: "1.3.2.1-motley-3246f1b" }), /requires Node/);
});

test("a later closure makes a frozen pending set runnable without rewriting its plan", () => {
  const selected = record.sets[0];
  const closure = {
    schema: "foundry-public-npm-aggregate-closure-v1", version: 1,
    plan: { path: "governance/public-npm-aggregate-canary.json", sha256: aggregatePlanSha256(record) }, set: "baseline",
    packages: selected.packages.map((entry) => ({ name: entry.name, version: entry.version, qualification: { path: `governance/release-qualifications/${entry.packageKey}-${entry.version}.json`, sha256: sha }, publication: { path: `governance/release-publications/later/${entry.packageKey}-${entry.version}.json`, sha256: sha, member: entry.packageKey } })),
  };
  closure.canonicalSha256 = sha256(JSON.stringify(stable(closure)));
  const resolved = resolveAggregateClosure(record, "baseline", closure);
  assert.equal(resolved.incomplete.length, 0);
  assert.ok(resolved.selected.packages.every((entry) => entry.qualification && entry.publication));
  const bad = structuredClone(closure); bad.packages.pop(); bad.canonicalSha256 = sha256(JSON.stringify(stable(Object.fromEntries(Object.entries(bad).filter(([key]) => key !== "canonicalSha256")))));
  assert.throws(() => resolveAggregateClosure(record, "baseline", bad), /closed immutable join/);
});

test("sealed historical Trio aliases require the exact allowed tuple", () => {
  const transition = JSON.parse(read("governance/package-identity-transition.json"));
  const entry = { name: "@clossys/advisor", version: "0.1.5" };
  assert.deepEqual(sealedHistoricalRepository({ entry, proof: { evidence: { repository: "clossys/platform" } }, transition }), { historicalRepository: "clossys/platform", repository: "clossys/foundry", repositoryId: 1325931929 });
  assert.throws(() => sealedHistoricalRepository({ entry: { ...entry, version: "9.9.9" }, proof: { evidence: { repository: "clossys/platform" } }, transition }), /exact sealed/);
  assert.throws(() => sealedHistoricalRepository({ entry, proof: { evidence: { repository: "foreign/repo" } }, transition }), /neither current/);
});

test("satisfied records bind the closed plan, closure, canonical payload, and one immutable introduction", () => {
  const { plan, closure, transcript } = satisfiedFixture();
  assert.deepEqual(validateSatisfiedAggregateTranscript(transcript, { plan, closure }), []);
  assert.deepEqual(validateSatisfiedTranscriptHistory({ path: `governance/public-npm-aggregate-transcripts/baseline-${transcript.canonicalSha256}.json`, history: [{ commit: "a".repeat(40), status: "A", sha256: sha }] }), []);
  const badDigest = structuredClone(transcript); badDigest.plan.setsSha256 = sha;
  assert.ok(validateSatisfiedAggregateTranscript(badDigest, { plan, closure }).some((item) => item.rule === "plan-join"));
  const rewritten = [{ commit: "b".repeat(40), status: "M", sha256: sha }, { commit: "a".repeat(40), status: "A", sha256: sha }];
  assert.ok(validateSatisfiedTranscriptHistory({ path: `governance/public-npm-aggregate-transcripts/baseline-${transcript.canonicalSha256}.json`, history: rewritten }).some((item) => item.rule === "transcript-rewrite"));
});
