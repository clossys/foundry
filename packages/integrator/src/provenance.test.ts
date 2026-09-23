import { describe, expect, it } from "vitest";
import {
  inspectInstalledPackageProvenance,
  inspectProvenanceStatement,
  inspectPublicNpmProvenance,
} from "./provenance.js";

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

function subjectNameMismatch(statement: Record<string, unknown>): void {
  (statement.subject as Array<Record<string, unknown>>)[0]!.name = "pkg:npm/%40clossys/other@0.1.4";
}

function workflowOf(statement: Record<string, unknown>): Record<string, unknown> {
  const predicate = statement.predicate as Record<string, unknown>;
  const buildDefinition = predicate.buildDefinition as Record<string, unknown>;
  const externalParameters = buildDefinition.externalParameters as Record<string, unknown>;
  return externalParameters.workflow as Record<string, unknown>;
}

function repositoryMismatch(statement: Record<string, unknown>): void {
  workflowOf(statement).repository = "https://github.com/other/platform";
}

function workflowPathMismatch(statement: Record<string, unknown>): void {
  workflowOf(statement).path = ".github/workflows/other.yml";
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

describe("inspectPublicNpmProvenance — producer path (npm audit signatures shaped)", () => {
  it("accepts one npm-verified exact public SLSA provenance statement", () => {
    const { audit, packument } = auditFixture();
    expect(inspectPublicNpmProvenance({ name, version, sourceSha, audit, packument })).toEqual({ code: 0, failures: [] });
  });

  it("rejects malformed inputs as indeterminate rather than passing", () => {
    expect(inspectPublicNpmProvenance({ name, version, sourceSha: "short", audit: null, packument: null }).code).toBe(2);
  });

  it("rejects npm audit invalid or missing evidence", () => {
    for (const field of ["invalid", "missing"] as const) {
      const { audit, packument } = auditFixture();
      (audit[field] as unknown[]).push({ name, version });
      expect(inspectPublicNpmProvenance({ name, version, sourceSha, audit, packument }).code).toBe(1);
    }
  });

  it("rejects a package/version or repository mismatch", () => {
    for (const mutate of [subjectNameMismatch, repositoryMismatch]) {
      const statement = payload();
      mutate(statement);
      const { audit, packument } = auditFixture(statement);
      expect(inspectPublicNpmProvenance({ name, version, sourceSha, audit, packument }).code).toBe(1);
    }
  });

  it("rejects a different attestation endpoint or non-unique provenance bundles", () => {
    const { audit, packument } = auditFixture();
    audit.verified[0]!.attestations.url = "https://registry.npmjs.org/-/npm/v1/attestations/other@0.1.4";
    audit.verified[0]!.attestationBundles.push(audit.verified[0]!.attestationBundles[0]!);
    expect(inspectPublicNpmProvenance({ name, version, sourceSha, audit, packument }).code).toBe(1);
  });
});

describe("inspectProvenanceStatement — the shared join", () => {
  it("verifies with an exact sourceSha pin", () => {
    expect(inspectProvenanceStatement({ name, version, expectedDigest, statement: payload(), sourceSha })).toEqual({ code: 0, failures: [] });
  });

  it("verifies WITHOUT a sourceSha, structurally, when the statement names one protected-main commit", () => {
    expect(inspectProvenanceStatement({ name, version, expectedDigest, statement: payload() })).toEqual({ code: 0, failures: [] });
  });

  it("rejects a foreign repository even with no sourceSha supplied", () => {
    const statement = payload();
    repositoryMismatch(statement);
    expect(inspectProvenanceStatement({ name, version, expectedDigest, statement }).code).toBe(1);
  });

  it("rejects a statement pinned to a DIFFERENT commit than the one requested", () => {
    expect(inspectProvenanceStatement({ name, version, expectedDigest, statement: payload(), sourceSha: "c".repeat(40) }).code).toBe(1);
  });

  it("is never fooled by an undecodable statement", () => {
    expect(inspectProvenanceStatement({ name, version, expectedDigest, statement: null }).code).toBe(1);
  });
});

describe("inspectInstalledPackageProvenance — consumer path (public attestations endpoint shaped)", () => {
  it("verifies an installed package straight from the attestations endpoint, with no sourceSha", () => {
    const { packument, attestationsResponse } = attestationsFixture();
    expect(inspectInstalledPackageProvenance({ name, version, packument, attestationsResponse })).toEqual({ state: "verified", failures: [] });
  });

  it("is violated when the attestations endpoint returns no attestations array (missing attestation)", () => {
    const { packument } = attestationsFixture();
    const result = inspectInstalledPackageProvenance({ name, version, packument, attestationsResponse: {} });
    expect(result.state).toBe("violated");
    expect(result.failures.join(" ")).toMatch(/attestations array/);
  });

  it("is violated when the attestations endpoint carries no SLSA provenance entry", () => {
    const { packument } = attestationsFixture();
    const result = inspectInstalledPackageProvenance({ name, version, packument, attestationsResponse: { attestations: [] } });
    expect(result.state).toBe("violated");
  });

  it("is violated on a tarball digest mismatch", () => {
    const { attestationsResponse } = attestationsFixture();
    const mismatchedPackument = { versions: { [version]: { name, version, dist: { integrity: `sha512-${Buffer.from("c".repeat(128), "hex").toString("base64")}` } } } };
    const result = inspectInstalledPackageProvenance({ name, version, packument: mismatchedPackument, attestationsResponse });
    expect(result.state).toBe("violated");
  });

  it("is violated when the statement names a foreign repository or workflow", () => {
    const statement = payload();
    workflowPathMismatch(statement);
    const { packument, attestationsResponse } = attestationsFixture(statement);
    const result = inspectInstalledPackageProvenance({ name, version, packument, attestationsResponse });
    expect(result.state).toBe("violated");
    expect(result.failures.join(" ")).toMatch(/publish workflow/);
  });

  it("does not require or reject any particular source commit, unlike the producer path", () => {
    const { packument, attestationsResponse } = attestationsFixture();
    // A consumer was not present for the publish; a DIFFERENT valid main commit than the
    // producer test's sourceSha still verifies, because no sourceSha was ever supplied.
    expect(inspectInstalledPackageProvenance({ name, version, packument, attestationsResponse }).state).toBe("verified");
  });
});
