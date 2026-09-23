import assert from "node:assert/strict";
import test from "node:test";

import { argsFrom, githubAuthenticatedFetch, recordPublicationEvidence } from "./record-publication-evidence.mjs";

const sourceSha = "6".repeat(40);

test("argsFrom parses exactly the four required flags and rejects everything else", () => {
  assert.deepEqual(
    argsFrom(["node", "script", "--package", "strategist", "--run-id", "123", "--run-attempt", "1", "--source-sha", sourceSha]),
    { package: "strategist", "run-id": "123", "run-attempt": "1", "source-sha": sourceSha },
  );
  for (const argv of [
    ["node", "script", "--package", "strategist"],
    ["node", "script", "--package", "../strategist", "--run-id", "1", "--run-attempt", "1", "--source-sha", sourceSha],
    ["node", "script", "--package", "strategist", "--run-id", "1", "--run-attempt", "1", "--source-sha", "not-a-sha"],
    ["node", "script", "--package", "strategist", "--run-id", "1", "--run-attempt", "1", "--source-sha", sourceSha, "--otp", "1"],
  ]) assert.throws(() => argsFrom(argv), /Usage/);
});

test("githubAuthenticatedFetch adds bearer auth only to api.github.com requests, leaving every other host untouched", async () => {
  const calls = [];
  const inner = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
  const fetchImpl = githubAuthenticatedFetch("secret-token", inner);

  await fetchImpl("https://api.github.com/repos/clossys/foundry/actions/runs/1/artifacts?per_page=100");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-token");
  assert.equal(calls[0].init.headers.Accept, "application/vnd.github+json");

  await fetchImpl("https://registry.npmjs.org/%40clossys%2Fstrategist");
  assert.equal(calls[1].init.headers, undefined);
});

test("githubAuthenticatedFetch never sends an Authorization header when no token is configured", async () => {
  const calls = [];
  const inner = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
  const fetchImpl = githubAuthenticatedFetch(undefined, inner);
  await fetchImpl("https://api.github.com/repos/clossys/foundry/actions/runs/1/artifacts?per_page=100");
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test("recordPublicationEvidence wires the measured manifest, registry time, and run identity into one publication-evidence.json before delegating to the fallback builder", async () => {
  const writes = {};
  const writeOutput = (path, contents) => { writes[path] = contents; };
  const fetchImpl = async (url) => {
    if (url === "https://registry.npmjs.org/%40clossys%2Fstrategist") {
      return { ok: true, status: 200, json: async () => ({ time: { "0.1.1": "2026-09-23T18:11:07.143Z" } }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  let createRecordOptions;
  const createRecord = async (options) => {
    createRecordOptions = options;
    const publication = JSON.parse(writes[options.publicationPath]);
    assert.deepEqual(publication, {
      mode: "trusted-publisher",
      publishedAt: "2026-09-23T18:11:07.143Z",
      reference: "https://github.com/clossys/foundry/actions/runs/999",
      provenance: {
        repository: "https://github.com/clossys/foundry",
        workflow: ".github/workflows/publish.yml",
        ref: "refs/heads/main",
        event: "workflow_dispatch",
        sourceSha,
        builder: "https://github.com/actions/runner/github-hosted",
        invocation: "https://github.com/clossys/foundry/actions/runs/999/attempts/1",
        attestationUrl: "https://registry.npmjs.org/-/npm/v1/attestations/%40clossys%2Fstrategist@0.1.1",
      },
    });
    return { path: "governance/release-publications/later/strategist-0.1.1.json", record: { schemaVersion: 2 } };
  };

  const result = await recordPublicationEvidence({
    root: "/repo",
    packageKey: "strategist",
    runId: 999,
    runAttempt: 1,
    sourceSha,
    fetchImpl,
    githubToken: undefined,
    readManifest: () => ({ name: "@clossys/strategist", version: "0.1.1" }),
    writeOutput,
    makeTempDir: () => "/tmp/publication-evidence-test",
    createRecord,
  });

  assert.equal(result.path, "governance/release-publications/later/strategist-0.1.1.json");
  assert.equal(createRecordOptions.root, "/repo");
  assert.equal(createRecordOptions.packageKey, "strategist");
  assert.equal(createRecordOptions.qualificationPath, "governance/release-qualifications/clossys-strategist-0.1.1.json");
  assert.equal(createRecordOptions.fetch, true);
  assert.deepEqual(createRecordOptions.env, { PATH: process.env.PATH ?? "/usr/bin:/bin" });
});

test("recordPublicationEvidence refuses a manifest with no name/version before making any network call", async () => {
  await assert.rejects(
    recordPublicationEvidence({
      root: "/repo",
      packageKey: "strategist",
      runId: 1,
      runAttempt: 1,
      sourceSha,
      fetchImpl: async () => { throw new Error("must not be called"); },
      readManifest: () => ({}),
    }),
    /has no name\/version/,
  );
});
