/**
 * `packages/integrator/src/provenance.ts` and `scripts/lib/provenance-
 * join.mjs` (this repository's own tooling, consumed by `scripts/check-
 * public-npm-provenance.mjs` because that script must run on Node 20 with no
 * TypeScript stripping -- see the docblocks on both files) are two files
 * implementing the SAME subject/digest/repository/workflow join. Nothing
 * mechanically forces them to agree; this test is that mechanism. It runs an
 * identical table of statements, npm-audit-shaped evidence, and installed-
 * package-shaped evidence through both implementations and asserts
 * byte-for-byte identical results.
 *
 * If this test fails, one of the two files was edited without the other.
 * Fix the drift; do not adjust this test to tolerate it.
 */
import { describe, expect, it } from "vitest";
import {
  EXPECTED_MAIN_REF as tsEXPECTED_MAIN_REF,
  EXPECTED_REPOSITORY as tsEXPECTED_REPOSITORY,
  EXPECTED_WORKFLOW as tsEXPECTED_WORKFLOW,
  GITHUB_HOSTED_BUILDER as tsGITHUB_HOSTED_BUILDER,
  PUBLIC_REGISTRY as tsPUBLIC_REGISTRY,
  SLSA_PROVENANCE as tsSLSA_PROVENANCE,
  SLSA_WORKFLOW_BUILD as tsSLSA_WORKFLOW_BUILD,
  inspectInstalledPackageProvenance as tsInspectInstalledPackageProvenance,
  inspectProvenanceStatement as tsInspectProvenanceStatement,
  inspectPublicNpmProvenance as tsInspectPublicNpmProvenance,
} from "./provenance.js";
// eslint-disable-next-line import/extensions -- deliberate cross-repo import; see the docblock above and on both files.
import {
  EXPECTED_MAIN_REF as mjsEXPECTED_MAIN_REF,
  EXPECTED_REPOSITORY as mjsEXPECTED_REPOSITORY,
  EXPECTED_WORKFLOW as mjsEXPECTED_WORKFLOW,
  GITHUB_HOSTED_BUILDER as mjsGITHUB_HOSTED_BUILDER,
  PUBLIC_REGISTRY as mjsPUBLIC_REGISTRY,
  SLSA_PROVENANCE as mjsSLSA_PROVENANCE,
  SLSA_WORKFLOW_BUILD as mjsSLSA_WORKFLOW_BUILD,
  inspectInstalledPackageProvenance as mjsInspectInstalledPackageProvenance,
  inspectProvenanceStatement as mjsInspectProvenanceStatement,
  inspectPublicNpmProvenance as mjsInspectPublicNpmProvenance,
} from "../../../scripts/lib/provenance-join.mjs";

const name = "@clossys/advisor";
const version = "0.1.4";
const sourceSha = "a".repeat(40);
const integrity = `sha512-${Buffer.from("b".repeat(128), "hex").toString("base64")}`;
const expectedDigest = "b".repeat(128);

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: "pkg:npm/%40clossys/advisor@0.1.4", digest: { sha512: expectedDigest } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: { ref: "refs/heads/main", repository: "https://github.com/clossys/foundry", path: ".github/workflows/publish.yml" },
        },
        internalParameters: { github: { event_name: "workflow_dispatch" } },
        resolvedDependencies: [{ uri: "git+https://github.com/clossys/foundry@refs/heads/main", digest: { gitCommit: sourceSha } }],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: { invocationId: "https://github.com/clossys/foundry/actions/runs/123/attempts/1" },
      },
    },
    ...overrides,
  };
}

function auditFixture(statement: unknown = payload()) {
  return {
    audit: {
      invalid: [] as unknown[],
      missing: [] as unknown[],
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

function attestationsFixture(statement: unknown = payload()) {
  return {
    packument: { versions: { [version]: { name, version, dist: { integrity } } } },
    attestationsResponse: {
      attestations: [
        {
          predicateType: "https://slsa.dev/provenance/v1",
          bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") } },
        },
      ],
    },
  };
}

const statementMutations: Array<[string, (value: Record<string, unknown>) => void]> = [
  ["no mutation (valid)", () => {}],
  ["subject name mismatch", (value) => { (value.subject as Array<Record<string, unknown>>)[0]!.name = "pkg:npm/%40clossys/other@0.1.4"; }],
  ["subject digest mismatch", (value) => { ((value.subject as Array<Record<string, unknown>>)[0]!.digest as Record<string, unknown>).sha512 = "c".repeat(128); }],
  ["repository mismatch", (value) => {
    const predicate = value.predicate as Record<string, unknown>;
    const build = predicate.buildDefinition as Record<string, unknown>;
    const external = build.externalParameters as Record<string, unknown>;
    (external.workflow as Record<string, unknown>).repository = "https://github.com/other/platform";
  }],
  ["workflow path mismatch", (value) => {
    const predicate = value.predicate as Record<string, unknown>;
    const build = predicate.buildDefinition as Record<string, unknown>;
    const external = build.externalParameters as Record<string, unknown>;
    (external.workflow as Record<string, unknown>).path = ".github/workflows/other.yml";
  }],
  ["source commit mismatch", (value) => {
    const predicate = value.predicate as Record<string, unknown>;
    const build = predicate.buildDefinition as Record<string, unknown>;
    const dependencies = build.resolvedDependencies as Array<Record<string, unknown>>;
    (dependencies[0]!.digest as Record<string, unknown>).gitCommit = "d".repeat(40);
  }],
  ["non-workflow-dispatch event", (value) => {
    const predicate = value.predicate as Record<string, unknown>;
    const build = predicate.buildDefinition as Record<string, unknown>;
    const internal = build.internalParameters as Record<string, unknown>;
    (internal.github as Record<string, unknown>).event_name = "push";
  }],
  ["foreign builder", (value) => {
    const predicate = value.predicate as Record<string, unknown>;
    const runDetails = predicate.runDetails as Record<string, unknown>;
    (runDetails.builder as Record<string, unknown>).id = "https://example.invalid/runner";
  }],
  ["malformed invocation", (value) => {
    const predicate = value.predicate as Record<string, unknown>;
    const runDetails = predicate.runDetails as Record<string, unknown>;
    (runDetails.metadata as Record<string, unknown>).invocationId = "https://github.com/other/platform/actions/runs/123/attempts/1";
  }],
  ["undecodable / non-object statement", () => {}],
];

describe("provenance.ts and scripts/lib/provenance-join.mjs stay in lockstep", () => {
  it.each(statementMutations)("inspectProvenanceStatement: %s", (label, mutate) => {
    const statement = label === "undecodable / non-object statement" ? null : payload();
    if (statement !== null) mutate(statement as Record<string, unknown>);

    for (const withSourceSha of [true, false]) {
      const input = { name, version, expectedDigest, statement, sourceSha: withSourceSha ? sourceSha : undefined };
      expect(tsInspectProvenanceStatement(input)).toEqual(mjsInspectProvenanceStatement(input));
    }
  });

  it.each(statementMutations)("inspectPublicNpmProvenance: %s", (_label, mutate) => {
    const statement = payload();
    mutate(statement);
    const { audit, packument } = auditFixture(statement);
    const input = { name, version, sourceSha, audit, packument };
    expect(tsInspectPublicNpmProvenance(input)).toEqual(mjsInspectPublicNpmProvenance(input));
  });

  it("inspectPublicNpmProvenance: malformed input (indeterminate)", () => {
    const input = { name, version, sourceSha: "short", audit: null, packument: null };
    expect(tsInspectPublicNpmProvenance(input)).toEqual(mjsInspectPublicNpmProvenance(input));
  });

  it("inspectPublicNpmProvenance: npm audit invalid/missing evidence", () => {
    for (const field of ["invalid", "missing"] as const) {
      const { audit, packument } = auditFixture();
      (audit[field] as unknown[]).push({ name, version });
      const input = { name, version, sourceSha, audit, packument };
      expect(tsInspectPublicNpmProvenance(input)).toEqual(mjsInspectPublicNpmProvenance(input));
    }
  });

  it.each(statementMutations)("inspectInstalledPackageProvenance: %s", (_label, mutate) => {
    const statement = payload();
    mutate(statement);
    const { packument, attestationsResponse } = attestationsFixture(statement);
    const input = { name, version, packument, attestationsResponse };
    expect(tsInspectInstalledPackageProvenance(input)).toEqual(mjsInspectInstalledPackageProvenance(input));
  });

  it("inspectInstalledPackageProvenance: no attestations array at all", () => {
    const { packument } = attestationsFixture();
    const input = { name, version, packument, attestationsResponse: {} };
    expect(tsInspectInstalledPackageProvenance(input)).toEqual(mjsInspectInstalledPackageProvenance(input));
  });

  it("inspectInstalledPackageProvenance: tarball digest mismatch", () => {
    const { attestationsResponse } = attestationsFixture();
    const mismatchedPackument = { versions: { [version]: { name, version, dist: { integrity: `sha512-${Buffer.from("c".repeat(128), "hex").toString("base64")}` } } } };
    const input = { name, version, packument: mismatchedPackument, attestationsResponse };
    expect(tsInspectInstalledPackageProvenance(input)).toEqual(mjsInspectInstalledPackageProvenance(input));
  });

  it("exported constants are identical", () => {
    expect(mjsPUBLIC_REGISTRY).toBe(tsPUBLIC_REGISTRY);
    expect(mjsEXPECTED_REPOSITORY).toBe(tsEXPECTED_REPOSITORY);
    expect(mjsEXPECTED_WORKFLOW).toBe(tsEXPECTED_WORKFLOW);
    expect(mjsEXPECTED_MAIN_REF).toBe(tsEXPECTED_MAIN_REF);
    expect(mjsSLSA_PROVENANCE).toBe(tsSLSA_PROVENANCE);
    expect(mjsSLSA_WORKFLOW_BUILD).toBe(tsSLSA_WORKFLOW_BUILD);
    expect(mjsGITHUB_HOSTED_BUILDER).toBe(tsGITHUB_HOSTED_BUILDER);
  });
});
