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
  fetchPublishedAt,
  findQualifiedCandidateArtifact,
} from "./publication-evidence-run.mjs";
import { PUBLIC_NPM_REGISTRY } from "./public-npm-registry.mjs";

const sourceSha = "6".repeat(40);

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

test("fetchPublishedAt reads the exact packument publish instant and refuses a version with no measured time", async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, `${PUBLIC_NPM_REGISTRY}/%40clossys%2Fstrategist`);
    return { ok: true, status: 200, json: async () => ({ time: { "0.1.1": "2026-09-23T18:11:07.143Z" } }) };
  };
  const publishedAt = await fetchPublishedAt({ fetchImpl, name: "@clossys/strategist", version: "0.1.1" });
  assert.equal(publishedAt, "2026-09-23T18:11:07.143Z");

  const noTimeFetch = async () => ({ ok: true, status: 200, json: async () => ({ time: {} }) });
  await assert.rejects(fetchPublishedAt({ fetchImpl: noTimeFetch, name: "@clossys/strategist", version: "0.1.1" }), /no measured publish time/);

  const failedFetch = async () => ({ ok: false, status: 500 });
  await assert.rejects(fetchPublishedAt({ fetchImpl: failedFetch, name: "@clossys/strategist", version: "0.1.1" }), /unavailable/);
});

test("buildPublicationRecordWithFallback returns the direct join without ever touching the replay path", async () => {
  const calls = { createRecord: [], findArtifact: 0, downloadZip: 0 };
  const createRecord = async (options) => { calls.createRecord.push(options); return { path: "governance/release-publications/later/strategist-0.1.1.json", record: { schemaVersion: 2 } }; };
  const findArtifact = async () => { calls.findArtifact += 1; throw new Error("must not be called"); };
  const downloadZip = async () => { calls.downloadZip += 1; throw new Error("must not be called"); };

  const result = await buildPublicationRecordWithFallback({
    root: "/repo", packageKey: "strategist", qualificationPath: "q.json", publicationPath: "p.json", fetchImpl: async () => {}, env: {}, runId: 1, tempDir: "/tmp/x",
    findArtifact, downloadZip, createRecord,
  });
  assert.equal(result.record.schemaVersion, 2);
  assert.equal(calls.createRecord.length, 1);
  assert.equal(calls.createRecord[0].artifactArchivePath, undefined);
  assert.equal(calls.findArtifact, 0);
  assert.equal(calls.downloadZip, 0);
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
    const findArtifact = async ({ runId, packageKey }) => {
      assert.equal(runId, 999);
      assert.equal(packageKey, "strategist");
      return { id: 42, name: "qualified-candidate-strategist" };
    };
    const downloadZip = async ({ artifactId }) => {
      assert.equal(artifactId, 42);
      return Buffer.from("zip bytes");
    };

    const result = await buildPublicationRecordWithFallback({
      root: "/repo", packageKey: "strategist", qualificationPath: "q.json", publicationPath: "p.json", fetchImpl: async () => {}, env: {}, runId: 999, tempDir: root,
      findArtifact, downloadZip, createRecord,
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
      findArtifact, downloadZip: async () => { throw new Error("must not be called"); }, createRecord,
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
        findArtifact: findArtifactOk, downloadZip: downloadZipOk, createRecord: createRecordSecondFails,
      }),
      /direct publication evidence failed \(first failure\).*replay publication evidence also failed \(second failure\)/s,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
