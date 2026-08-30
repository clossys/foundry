import assert from "node:assert/strict";
import test from "node:test";

import { inspectPublicNpmProvenance } from "./check-public-npm-provenance.mjs";

const name = "@clossys/advisor";
const version = "0.1.4";
const sourceSha = "a".repeat(40);
const integrity = `sha512-${Buffer.from("b".repeat(128), "hex").toString("base64")}`;

function payload(overrides = {}) {
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: "pkg:npm/%40clossys/advisor@0.1.4", digest: { sha512: "b".repeat(128) } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: { ref: "refs/heads/main", repository: "https://github.com/clossys/platform", path: ".github/workflows/publish.yml" },
        },
        internalParameters: { github: { event_name: "workflow_dispatch" } },
        resolvedDependencies: [
          { uri: "git+https://github.com/clossys/platform@refs/heads/main", digest: { gitCommit: sourceSha } },
        ],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: { invocationId: "https://github.com/clossys/platform/actions/runs/123/attempts/1" },
      },
    },
    ...overrides,
  };
}

function fixture(statement = payload()) {
  return {
    audit: {
      invalid: [],
      missing: [],
      verified: [
        {
          name,
          version,
          registry: "https://registry.npmjs.org/",
          attestations: {
            url: "https://registry.npmjs.org/-/npm/v1/attestations/@clossys%2fadvisor@0.1.4",
            provenance: { predicateType: "https://slsa.dev/provenance/v1" },
          },
          attestationBundles: [
            {
              predicateType: "https://slsa.dev/provenance/v1",
              bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") } },
            },
          ],
        },
      ],
    },
    packument: { versions: { [version]: { name, version, dist: { integrity } } } },
  };
}

test("accepts one npm-verified exact public SLSA provenance statement", () => {
  const { audit, packument } = fixture();
  assert.deepEqual(inspectPublicNpmProvenance({ name, version, sourceSha, audit, packument }), { code: 0, failures: [] });
});

test("rejects malformed inputs as indeterminate rather than passing", () => {
  assert.equal(inspectPublicNpmProvenance({ name, version, sourceSha: "short", audit: null, packument: null }).code, 2);
});

test("rejects npm audit invalid or missing evidence", () => {
  for (const field of ["invalid", "missing"]) {
    const { audit, packument } = fixture();
    audit[field].push({ name, version });
    assert.equal(inspectPublicNpmProvenance({ name, version, sourceSha, audit, packument }).code, 1);
  }
});

test("rejects package, tarball digest, repository, workflow, source, event, builder, and invocation drift", () => {
  const mutations = [
    (value) => { value.subject[0].name = "pkg:npm/%40clossys/other@0.1.4"; },
    (value) => { value.subject[0].digest.sha512 = "c".repeat(128); },
    (value) => { value.predicate.buildDefinition.externalParameters.workflow.repository = "https://github.com/other/platform"; },
    (value) => { value.predicate.buildDefinition.externalParameters.workflow.path = ".github/workflows/other.yml"; },
    (value) => { value.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "d".repeat(40); },
    (value) => { value.predicate.buildDefinition.internalParameters.github.event_name = "push"; },
    (value) => { value.predicate.runDetails.builder.id = "https://example.invalid/runner"; },
    (value) => { value.predicate.runDetails.metadata.invocationId = "https://github.com/other/platform/actions/runs/123/attempts/1"; },
  ];
  for (const mutate of mutations) {
    const statement = structuredClone(payload());
    mutate(statement);
    const { audit, packument } = fixture(statement);
    assert.equal(inspectPublicNpmProvenance({ name, version, sourceSha, audit, packument }).code, 1);
  }
});

test("rejects a different attestation endpoint or non-unique provenance bundles", () => {
  const { audit, packument } = fixture();
  audit.verified[0].attestations.url = "https://registry.npmjs.org/-/npm/v1/attestations/other@0.1.4";
  audit.verified[0].attestationBundles.push(audit.verified[0].attestationBundles[0]);
  assert.equal(inspectPublicNpmProvenance({ name, version, sourceSha, audit, packument }).code, 1);
});

test("rejects a foreign resolved dependency beside the exact protected main source", () => {
  const statement = payload();
  statement.predicate.buildDefinition.resolvedDependencies.push({
    uri: "git+https://github.com/example/project@refs/heads/main",
    digest: { gitCommit: "c".repeat(40) },
  });
  const { audit, packument } = fixture(statement);
  assert.equal(inspectPublicNpmProvenance({ name, version, sourceSha, audit, packument }).code, 1);
});
