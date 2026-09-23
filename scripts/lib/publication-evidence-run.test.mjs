import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  attestationUrl,
  buildPublicationEvidenceInput,
  buildPublicationRecordWithFallback,
  downloadArtifactZip,
  fetchPackument,
  fetchPublishedAt,
  findQualifiedCandidateArtifact,
  verifyPublicationProvenance,
} from "./publication-evidence-run.mjs";
import { buildLaterPublicationRecord } from "../record-later-publication.mjs";
import { validateLaterPublication } from "./release-later-publication.mjs";
import { publicNpmVersionUrl, PUBLIC_NPM_REGISTRY } from "./public-npm-registry.mjs";
import { exactSubjectName } from "./provenance-join.mjs";

const sourceSha = "6".repeat(40);
const name = "@clossys/strategist";
const version = "0.1.1";
const runId = 999;
const runAttempt = 1;

/** A minimal, exactly-shaped npm audit + packument fixture that inspectPublicNpmProvenance() accepts — the same shape record-later-publication.test.mjs's replay e2e test builds by hand. */
function provenanceFixture({ name: pkgName = name, version: pkgVersion = version, sourceSha: sha = sourceSha, runId: run = runId, runAttempt: attempt = runAttempt, mutateStatement = (s) => s } = {}) {
  const sha512Hex = "1".repeat(128);
  const integrity = `sha512-${Buffer.from(sha512Hex, "hex").toString("base64")}`;
  const attestation = attestationUrl(pkgName, pkgVersion);
  const statement = mutateStatement({
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: exactSubjectName(pkgName, pkgVersion), digest: { sha512: sha512Hex } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: { workflow: { repository: "https://github.com/clossys/foundry", path: ".github/workflows/publish.yml", ref: "refs/heads/main" } },
        internalParameters: { github: { event_name: "workflow_dispatch" } },
        resolvedDependencies: [{ uri: "git+https://github.com/clossys/foundry@refs/heads/main", digest: { gitCommit: sha } }],
      },
      runDetails: { builder: { id: "https://github.com/actions/runner/github-hosted" }, metadata: { invocationId: `https://github.com/clossys/foundry/actions/runs/${run}/attempts/${attempt}` } },
    },
  });
  const bundle = { predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") } } };
  const packument = { versions: { [pkgVersion]: { name: pkgName, version: pkgVersion, dist: { integrity } } } };
  const audit = {
    invalid: [], missing: [],
    verified: [{ name: pkgName, version: pkgVersion, registry: `${PUBLIC_NPM_REGISTRY}/`, attestations: { url: attestation, provenance: { predicateType: "https://slsa.dev/provenance/v1" } }, attestationBundles: [bundle] }],
  };
  return { packument, audit };
}

test("attestationUrl exactly matches release-later-publication.mjs's exactAttestationUrl expectation", () => {
  assert.equal(
    attestationUrl("@clossys/strategist", "0.1.1"),
    `${PUBLIC_NPM_REGISTRY}/-/npm/v1/attestations/%40clossys%2Fstrategist@0.1.1`,
  );
});

test("buildPublicationEvidenceInput emits the closed trusted-publisher shape from measured inputs only", () => {
  const publication = buildPublicationEvidenceInput({
    runId: 123, runAttempt: 1, sourceSha, publishedAt: "2026-09-23T18:11:07.143Z", name: "@clossys/strategist", version: "0.1.1",
  });
  assert.deepEqual(publication, {
    mode: "trusted-publisher",
    publishedAt: "2026-09-23T18:11:07.143Z",
    reference: "https://github.com/clossys/foundry/actions/runs/123",
    provenance: {
      repository: "https://github.com/clossys/foundry",
      workflow: ".github/workflows/publish.yml",
      ref: "refs/heads/main",
      event: "workflow_dispatch",
      sourceSha,
      builder: "https://github.com/actions/runner/github-hosted",
      invocation: "https://github.com/clossys/foundry/actions/runs/123/attempts/1",
      attestationUrl: `${PUBLIC_NPM_REGISTRY}/-/npm/v1/attestations/%40clossys%2Fstrategist@0.1.1`,
    },
  });
});

test("buildPublicationEvidenceInput refuses every unmeasured or malformed field", () => {
  const base = { runId: 123, runAttempt: 1, sourceSha, publishedAt: "2026-09-23T18:11:07.143Z", name: "@clossys/strategist", version: "0.1.1" };
  assert.throws(() => buildPublicationEvidenceInput({ ...base, runId: 0 }), /runId/);
  assert.throws(() => buildPublicationEvidenceInput({ ...base, runId: 1.5 }), /runId/);
  assert.throws(() => buildPublicationEvidenceInput({ ...base, runAttempt: 0 }), /runAttempt/);
  assert.throws(() => buildPublicationEvidenceInput({ ...base, sourceSha: "not-a-sha" }), /sourceSha/);
  assert.throws(() => buildPublicationEvidenceInput({ ...base, publishedAt: "" }), /publishedAt/);
  assert.throws(() => buildPublicationEvidenceInput({ ...base, publishedAt: undefined }), /publishedAt/);
  assert.throws(() => buildPublicationEvidenceInput({ ...base, name: undefined }), /name and version/);
});

test("findQualifiedCandidateArtifact selects the exact package-named artifact and fails closed when absent", async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, "https://api.github.com/repos/clossys/foundry/actions/runs/456/artifacts?per_page=100");
    return { ok: true, status: 200, json: async () => ({ artifacts: [
      { id: 1, name: "qualified-candidate-other" },
      { id: 2, name: "qualified-candidate-strategist" },
    ] }) };
  };
  const artifact = await findQualifiedCandidateArtifact({ fetchImpl, runId: 456, packageKey: "strategist" });
  assert.equal(artifact.id, 2);

  const emptyFetch = async () => ({ ok: true, status: 200, json: async () => ({ artifacts: [] }) });
  await assert.rejects(findQualifiedCandidateArtifact({ fetchImpl: emptyFetch, runId: 456, packageKey: "strategist" }), /no qualified-candidate-strategist artifact/);

  const failedFetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(findQualifiedCandidateArtifact({ fetchImpl: failedFetch, runId: 456, packageKey: "strategist" }), /404/);
});

test("downloadArtifactZip returns the exact raw bytes and fails closed on a bad response", async () => {
  const bytes = Buffer.from("pkzip bytes");
  const fetchImpl = async (url) => {
    assert.equal(url, "https://api.github.com/repos/clossys/foundry/actions/artifacts/9/zip");
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  const result = await downloadArtifactZip({ fetchImpl, artifactId: 9 });
  assert.deepEqual(result, bytes);

  const failedFetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(downloadArtifactZip({ fetchImpl: failedFetch, artifactId: 9 }), /503/);
});

test("fetchPackument and fetchPublishedAt read the exact packument and its measured publish instant, refusing a version with no measured time", async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, `${PUBLIC_NPM_REGISTRY}/%40clossys%2Fstrategist`);
    return { ok: true, status: 200, json: async () => ({ time: { "0.1.1": "2026-09-23T18:11:07.143Z" } }) };
  };
  const packument = await fetchPackument({ fetchImpl, name: "@clossys/strategist" });
  assert.deepEqual(packument, { time: { "0.1.1": "2026-09-23T18:11:07.143Z" } });

  const publishedAt = await fetchPublishedAt({ fetchImpl, name: "@clossys/strategist", version: "0.1.1" });
  assert.equal(publishedAt, "2026-09-23T18:11:07.143Z");

  // A caller that already fetched the packument (verifyPublicationProvenance
  // and the CLI both do) must be able to pass it straight through with no
  // second fetch.
  const publishedAtFromPackument = await fetchPublishedAt({ fetchImpl: async () => { throw new Error("must not be called"); }, name: "@clossys/strategist", version: "0.1.1", packument });
  assert.equal(publishedAtFromPackument, "2026-09-23T18:11:07.143Z");

  const noTimeFetch = async () => ({ ok: true, status: 200, json: async () => ({ time: {} }) });
  await assert.rejects(fetchPublishedAt({ fetchImpl: noTimeFetch, name: "@clossys/strategist", version: "0.1.1" }), /no measured publish time/);

  const failedFetch = async () => ({ ok: false, status: 500 });
  await assert.rejects(fetchPublishedAt({ fetchImpl: failedFetch, name: "@clossys/strategist", version: "0.1.1" }), /unavailable/);
});

test("verifyPublicationProvenance accepts an exactly-matching SLSA attestation and rejects malformed identity fields before any network call", async () => {
  const { packument, audit } = provenanceFixture();
  const auditRun = () => JSON.stringify(audit);
  const result = await verifyPublicationProvenance({ fetchImpl: async () => { throw new Error("must not be called — packument was already supplied"); }, name, version, sourceSha, runId, runAttempt, auditRun, env: {}, packument });
  assert.deepEqual(result.audit, audit);

  await assert.rejects(
    verifyPublicationProvenance({ fetchImpl: async () => { throw new Error("must not be called"); }, name, version, sourceSha: "not-a-sha", runId, runAttempt, auditRun, env: {} }),
    /sourceSha must be a full 40-character commit hash/,
  );
  await assert.rejects(
    verifyPublicationProvenance({ fetchImpl: async () => { throw new Error("must not be called"); }, name, version, sourceSha, runId: 0, runAttempt, auditRun, env: {} }),
    /runId must be a positive integer/,
  );
  await assert.rejects(
    verifyPublicationProvenance({ fetchImpl: async () => { throw new Error("must not be called"); }, name, version, sourceSha, runId, runAttempt: 0, auditRun, env: {} }),
    /runAttempt must be a positive integer/,
  );
});

test("verifyPublicationProvenance refuses a record whose claimed run or commit the attestation does not corroborate", async () => {
  const wrongCommit = "7".repeat(40);
  const { packument, audit } = provenanceFixture({ sourceSha: wrongCommit }); // attestation names a DIFFERENT commit than the one we claim
  const auditRun = () => JSON.stringify(audit);
  await assert.rejects(
    verifyPublicationProvenance({ fetchImpl: async () => { throw new Error("must not be called"); }, name, version, sourceSha, runId, runAttempt, auditRun, env: {}, packument }),
    /measured npm SLSA provenance attestation does not corroborate this run/,
  );
});

test("verifyPublicationProvenance refuses a mismatched workflow path or event in the attestation", async () => {
  const auditRunFor = (fixture) => () => JSON.stringify(fixture.audit);

  const wrongWorkflow = provenanceFixture({
    mutateStatement: (statement) => ({ ...structuredClone(statement), predicate: { ...structuredClone(statement.predicate), buildDefinition: { ...structuredClone(statement.predicate.buildDefinition), externalParameters: { workflow: { repository: "https://github.com/clossys/foundry", path: ".github/workflows/some-other-workflow.yml", ref: "refs/heads/main" } } } } }),
  });
  await assert.rejects(
    verifyPublicationProvenance({ fetchImpl: async () => { throw new Error("must not be called"); }, name, version, sourceSha, runId, runAttempt, auditRun: auditRunFor(wrongWorkflow), env: {}, packument: wrongWorkflow.packument }),
    /does not corroborate this run/,
  );

  const wrongEvent = provenanceFixture({
    mutateStatement: (statement) => ({ ...structuredClone(statement), predicate: { ...structuredClone(statement.predicate), buildDefinition: { ...structuredClone(statement.predicate.buildDefinition), internalParameters: { github: { event_name: "push" } } } } }),
  });
  await assert.rejects(
    verifyPublicationProvenance({ fetchImpl: async () => { throw new Error("must not be called"); }, name, version, sourceSha, runId, runAttempt, auditRun: auditRunFor(wrongEvent), env: {}, packument: wrongEvent.packument }),
    /does not corroborate this run/,
  );
});

// Correctness review B2: the whole record-later-publication.mjs join only
// ever checks the invocation URL's SHAPE, never its value, so a record
// naming the correct commit but the WRONG run or attempt (e.g. because a
// downstream job like verify-published was individually re-run — see
// publish.yml's own "Re-run failed jobs" path) previously still passed.
// Measured: re-running launcher@0.3.0's real build with `--run-attempt 2`
// produced a self-validated schema-2 record naming attempt 2 while the real
// attestation says attempt 1. This proves the fix actually closes that gap.
test("verifyPublicationProvenance refuses a record that names the right commit but the wrong run or attempt (2026-09-23 correctness review, B2)", async () => {
  const { packument, audit } = provenanceFixture({ runId: 35850983604, runAttempt: 1 }); // the real launcher@0.3.0 attestation's actual run/attempt
  const auditRun = () => JSON.stringify(audit);

  await assert.rejects(
    verifyPublicationProvenance({ fetchImpl: async () => { throw new Error("must not be called"); }, name, version, sourceSha, runId: 35850983604, runAttempt: 2, auditRun, env: {}, packument }),
    /measured npm SLSA provenance attestation names a different run\/attempt than this record claims \(attested .*attempts\/1, claimed .*attempts\/2\)/,
  );
  await assert.rejects(
    verifyPublicationProvenance({ fetchImpl: async () => { throw new Error("must not be called"); }, name, version, sourceSha, runId: 999999, runAttempt: 1, auditRun, env: {}, packument }),
    /measured npm SLSA provenance attestation names a different run\/attempt than this record claims/,
  );
  // The one exactly-correct claim still passes.
  await verifyPublicationProvenance({ fetchImpl: async () => { throw new Error("must not be called"); }, name, version, sourceSha, runId: 35850983604, runAttempt: 1, auditRun, env: {}, packument });
});

test("verifyPublicationProvenance fetches the packument itself when the caller does not already have one", async () => {
  const { packument, audit } = provenanceFixture();
  const auditRun = () => JSON.stringify(audit);
  let fetchCount = 0;
  const fetchImpl = async (url) => {
    fetchCount += 1;
    assert.equal(url, `${PUBLIC_NPM_REGISTRY}/${encodeURIComponent(name)}`);
    return { ok: true, status: 200, json: async () => packument };
  };
  await verifyPublicationProvenance({ fetchImpl, name, version, sourceSha, runId, runAttempt, auditRun, env: {} });
  assert.equal(fetchCount, 1);
});

// Correctness review, Tests(7): every existing fallback test mocks
// createRecord, so nothing ever fed buildPublicationEvidenceInput's output
// into the REAL validateLaterPublication(). These two tests close that gap.
test("buildPublicationEvidenceInput exactly reproduces a real retained record's publication block", () => {
  // governance/release-publications/later/integrator-0.6.10.json, retained
  // on this branch already — a real schema-2 (direct join) record.
  const rebuilt = buildPublicationEvidenceInput({
    runId: 35463996575,
    runAttempt: 1,
    sourceSha: "9f35bc2ed7f8f69bd32771ae4d56a5d29e86580b",
    publishedAt: "2026-09-19T19:32:23.500Z",
    name: "@clossys/integrator",
    version: "0.6.10",
  });
  assert.deepEqual(rebuilt, {
    mode: "trusted-publisher",
    publishedAt: "2026-09-19T19:32:23.500Z",
    reference: "https://github.com/clossys/foundry/actions/runs/35463996575",
    provenance: {
      repository: "https://github.com/clossys/foundry",
      workflow: ".github/workflows/publish.yml",
      ref: "refs/heads/main",
      event: "workflow_dispatch",
      sourceSha: "9f35bc2ed7f8f69bd32771ae4d56a5d29e86580b",
      builder: "https://github.com/actions/runner/github-hosted",
      invocation: "https://github.com/clossys/foundry/actions/runs/35463996575/attempts/1",
      attestationUrl: "https://registry.npmjs.org/-/npm/v1/attestations/%40clossys%2Fintegrator@0.6.10",
    },
  });
});

test("a publication block buildPublicationEvidenceInput builds is accepted by the real validateLaterPublication()", () => {
  const hex = (value, length) => value.repeat(length);
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
  const catalog = { defaultTarget: "clossys-npmjs", targets: [{ id: "clossys-npmjs", status: "active", packages: ["strategist"] }] };
  const catalogBytes = Buffer.from("catalog bytes\n");
  const candidateBytes = Buffer.from("candidate bytes");
  const proof = {
    schemaVersion: 2, kind: "public-npm-anonymous-registry-proof-v2", evidence: {
      registry: PUBLIC_NPM_REGISTRY, access: "anonymous", name: candidate.name, version: candidate.version,
      metadataUrl: publicNpmVersionUrl(PUBLIC_NPM_REGISTRY, candidate.name, candidate.version), repository: "clossys/foundry",
      tarballUrl: `${PUBLIC_NPM_REGISTRY}/@clossys/strategist/-/strategist-0.1.1.tgz`, integrity: `sha512-${Buffer.from(candidate.tarball.sha512, "hex").toString("base64")}`,
      shasum: candidate.tarball.sha1, sha256: candidate.tarball.sha256, sha512: candidate.tarball.sha512, packedManifestSha256: candidate.packageManifestSha256, size: candidateBytes.length,
    },
  };

  // buildPublicationEvidenceInput's own output — no hand-written provenance object.
  const publication = buildPublicationEvidenceInput({
    runId: 123, runAttempt: 1, sourceSha: hex("6", 40), publishedAt: "2026-08-31T00:00:00.000Z", name: candidate.name, version: candidate.version,
  });

  const built = buildLaterPublicationRecord({
    packageKey: "strategist", qualificationPath: "governance/release-qualifications/clossys-strategist-0.1.1.json", qualification,
    qualificationBytes, candidateBytes, proof, catalog, catalogBytes, publication,
    recordPath: "governance/release-publications/later/strategist-0.1.1.json", provenanceSourceValid: true,
  });
  assert.equal(built.record.schemaVersion, 2);
  assert.deepEqual(built.record.publication, publication);

  // The real validator, called directly and independently of the fixture
  // buildLaterPublicationRecord itself already runs.
  const findings = validateLaterPublication(built.record, {
    recordPath: "governance/release-publications/later/strategist-0.1.1.json",
    recordBytes: built.recordBytes.toString("utf8"),
    qualification, qualificationBytes: qualificationBytes.toString("utf8"),
    qualificationPath: "governance/release-qualifications/clossys-strategist-0.1.1.json",
    catalogBytes: catalogBytes.toString("utf8"), catalog, provenanceSourceValid: true,
  });
  assert.deepEqual(findings, []);
});

test("buildPublicationRecordWithFallback returns the direct join once verifyProvenance passes, without ever touching the replay path", async () => {
  const calls = { createRecord: [], findArtifact: 0, downloadZip: 0, verifyProvenance: 0 };
  const createRecord = async (options) => { calls.createRecord.push(options); return { path: "governance/release-publications/later/strategist-0.1.1.json", record: { schemaVersion: 2 } }; };
  const findArtifact = async () => { calls.findArtifact += 1; throw new Error("must not be called"); };
  const downloadZip = async () => { calls.downloadZip += 1; throw new Error("must not be called"); };
  const verifyProvenance = async (options) => { calls.verifyProvenance += 1; assert.equal(options.name, "strategist-name"); assert.equal(options.sourceSha, sourceSha); };

  const result = await buildPublicationRecordWithFallback({
    root: "/repo", packageKey: "strategist", qualificationPath: "q.json", publicationPath: "p.json", fetchImpl: async () => {}, env: {}, runId: 1, tempDir: "/tmp/x",
    name: "strategist-name", version: "0.1.1", sourceSha,
    findArtifact, downloadZip, createRecord, verifyProvenance,
  });
  assert.equal(result.record.schemaVersion, 2);
  assert.equal(calls.createRecord.length, 1);
  assert.equal(calls.createRecord[0].artifactArchivePath, undefined);
  assert.equal(calls.verifyProvenance, 1);
  assert.equal(calls.findArtifact, 0);
  assert.equal(calls.downloadZip, 0);
});

test("buildPublicationRecordWithFallback never calls createRecord's direct join when verifyProvenance itself rejects, and falls back to replay", async () => {
  const attempts = [];
  const verifyProvenance = async () => { throw new Error("attestation does not corroborate this run"); };
  const root = mkdtempSync(join(tmpdir(), "publication-evidence-verify-fallback-"));
  const createRecord = async (options) => {
    attempts.push(options);
    assert.equal(options.artifactArchivePath, join(root, "qualified-candidate.zip"));
    return { path: "governance/release-publications/later/strategist-0.1.1.json", record: { schemaVersion: 3 } };
  };
  const findArtifact = async () => ({ id: 42, name: "qualified-candidate-strategist" });
  const downloadZip = async () => Buffer.from("zip bytes");
  try {
    const result = await buildPublicationRecordWithFallback({
      root: "/repo", packageKey: "strategist", qualificationPath: "q.json", publicationPath: "p.json", fetchImpl: async () => {}, env: {}, runId: 1, tempDir: root,
      name: "strategist-name", version: "0.1.1", sourceSha,
      findArtifact, downloadZip, createRecord, verifyProvenance,
    });
    assert.equal(result.record.schemaVersion, 3);
    // createRecord is only ever called once here — the direct attempt never
    // reached it, because verifyProvenance rejected before createRecord ran.
    assert.equal(attempts.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildPublicationRecordWithFallback falls back to a replay build using this exact run's own qualify artifact when the direct join fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "publication-evidence-fallback-"));
  try {
    const attempts = [];
    const createRecord = async (options) => {
      attempts.push(options);
      if (attempts.length === 1) throw new Error("source drifted");
      assert.equal(options.artifactArchivePath, join(root, "qualified-candidate.zip"));
      assert.equal(options.replayEvidencePath, join(root, "replay-evidence.json"));
      const replayEvidence = JSON.parse(readFileSync(options.replayEvidencePath, "utf8"));
      assert.deepEqual(replayEvidence, { schemaVersion: 1, kind: "foundry-trusted-publication-replay-input-v1", runId: 999, artifactId: 42 });
      assert.equal(readFileSync(options.artifactArchivePath, "utf8"), "zip bytes");
      return { path: "governance/release-publications/later/strategist-0.1.1.json", record: { schemaVersion: 3 } };
    };
    const findArtifact = async ({ runId: gotRunId, packageKey }) => {
      assert.equal(gotRunId, 999);
      assert.equal(packageKey, "strategist");
      return { id: 42, name: "qualified-candidate-strategist" };
    };
    const downloadZip = async ({ artifactId }) => {
      assert.equal(artifactId, 42);
      return Buffer.from("zip bytes");
    };

    const result = await buildPublicationRecordWithFallback({
      root: "/repo", packageKey: "strategist", qualificationPath: "q.json", publicationPath: "p.json", fetchImpl: async () => {}, env: {}, runId: 999, tempDir: root,
      name: "strategist-name", version: "0.1.1", sourceSha,
      findArtifact, downloadZip, createRecord, verifyProvenance: async () => {},
    });
    assert.equal(result.record.schemaVersion, 3);
    assert.equal(attempts.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildPublicationRecordWithFallback throws a combined error and writes nothing when both attempts fail", async () => {
  const createRecord = async () => { throw new Error("first failure"); };
  const findArtifact = async () => { throw new Error("no artifact"); };
  await assert.rejects(
    buildPublicationRecordWithFallback({
      root: "/repo", packageKey: "strategist", qualificationPath: "q.json", publicationPath: "p.json", fetchImpl: async () => {}, env: {}, runId: 1, tempDir: "/tmp/x",
      name: "strategist-name", version: "0.1.1", sourceSha,
      findArtifact, downloadZip: async () => { throw new Error("must not be called"); }, createRecord, verifyProvenance: async () => {},
    }),
    /direct publication evidence failed \(first failure\).*replay fallback could not locate the qualified-candidate artifact \(no artifact\)/s,
  );

  const findArtifactOk = async () => ({ id: 1, name: "qualified-candidate-strategist" });
  const downloadZipOk = async () => Buffer.from("zip bytes");
  const root = mkdtempSync(join(tmpdir(), "publication-evidence-fallback-both-fail-"));
  try {
    let calls = 0;
    const createRecordSecondFails = async () => {
      calls += 1;
      throw new Error(calls === 1 ? "first failure" : "second failure");
    };
    await assert.rejects(
      buildPublicationRecordWithFallback({
        root: "/repo", packageKey: "strategist", qualificationPath: "q.json", publicationPath: "p.json", fetchImpl: async () => {}, env: {}, runId: 1, tempDir: root,
        name: "strategist-name", version: "0.1.1", sourceSha,
        findArtifact: findArtifactOk, downloadZip: downloadZipOk, createRecord: createRecordSecondFails, verifyProvenance: async () => {},
      }),
      /direct publication evidence failed \(first failure\).*replay publication evidence also failed \(second failure\)/s,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
