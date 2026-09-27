import { describe, expect, it } from "vitest";
import { verifyDeployRecord } from "./deploy-record.js";
import type { DeployRecordDefinition, DeployRecordObservation } from "./types.js";

const declared: DeployRecordDefinition = {
  productionBranch: "release",
  previewBranches: ["main"],
  previewUrl: "https://example-git-main-team.example.invalid",
  protection: "none",
  releaseRef: true,
  environmentNames: [
    { name: "CONTACT_TO", target: "preview", classification: "plain", scope: "project" },
    { name: "REGISTRY_TOKEN", target: "production", classification: "secret", scope: "shared" },
  ],
};

function matchingObservation(): DeployRecordObservation {
  return {
    productionBranch: "release",
    previewUrl: "https://example-git-main-team.example.invalid",
    protection: "none",
    deployEnabledBranches: ["main"],
    environmentNames: [
      { name: "CONTACT_TO", target: "preview", classification: "plain", scope: "project" },
      { name: "REGISTRY_TOKEN", target: "production", classification: "secret", scope: "shared" },
    ],
  };
}

describe("verifyDeployRecord", () => {
  it("is satisfied when the observation matches the declaration", () => {
    expect(verifyDeployRecord(declared, matchingObservation())).toMatchObject({ verdict: "satisfied" });
  });

  it("is violated when the observed production branch differs", () => {
    const result = verifyDeployRecord(declared, { ...matchingObservation(), productionBranch: "main" });
    expect(result.verdict).toBe("violated");
    if (result.verdict !== "violated") return;
    expect(result.findings.map((entry) => entry.rule)).toContain("deploy-record-production-branch");
  });

  it("is satisfied under release-ref when production is release and main is deploy-enabled", () => {
    expect(
      verifyDeployRecord(declared, {
        ...matchingObservation(),
        productionBranch: "release",
        deployEnabledBranches: ["main"],
      }),
    ).toMatchObject({ verdict: "satisfied" });
  });

  it.each([
    { deployEnabledBranches: ["develop"] as const },
    { deployEnabledBranches: [] as const },
    { deployEnabledBranches: undefined },
  ])(
    "is violated under release-ref when declared and observed production are main (deployEnabledBranches $deployEnabledBranches)",
    ({ deployEnabledBranches }) => {
      const releaseRefMainDeclared: DeployRecordDefinition = {
        ...declared,
        productionBranch: "main",
        previewBranches: deployEnabledBranches ?? [],
      };
      const result = verifyDeployRecord(releaseRefMainDeclared, {
        ...matchingObservation(),
        productionBranch: "main",
        ...(deployEnabledBranches === undefined ? {} : { deployEnabledBranches: [...deployEnabledBranches] }),
      });
      expect(result.verdict).toBe("violated");
      if (result.verdict !== "violated") return;
      expect(result.findings.map((entry) => entry.rule)).toContain("deploy-record-release-ref-main-deploy");
    },
  );

  it("is violated under release-ref when declared and observed production are staging", () => {
    const releaseRefStagingDeclared: DeployRecordDefinition = {
      ...declared,
      productionBranch: "staging",
      previewBranches: [],
    };
    const result = verifyDeployRecord(releaseRefStagingDeclared, {
      ...matchingObservation(),
      productionBranch: "staging",
      deployEnabledBranches: [],
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict !== "violated") return;
    expect(result.findings.map((entry) => entry.rule)).toContain("deploy-record-release-ref-main-deploy");
  });

  it("is violated when duplicate observed environment rows omit classification on a later row", () => {
    const result = verifyDeployRecord(declared, {
      ...matchingObservation(),
      environmentNames: [
        { name: "CONTACT_TO", target: "preview", classification: "plain", scope: "project" },
        { name: "CONTACT_TO", target: "preview", scope: "project" },
        matchingObservation().environmentNames[1]!,
      ],
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict !== "violated") return;
    expect(result.findings.map((entry) => entry.rule)).toContain("deploy-record-environment-classification");
  });

  it("is violated when deploy-enabled branches do not match declared preview branches", () => {
    const result = verifyDeployRecord(declared, {
      ...matchingObservation(),
      deployEnabledBranches: ["other-branch"],
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict !== "violated") return;
    expect(result.findings.map((entry) => entry.rule)).toContain("deploy-record-preview-branches");
  });

  it("is violated when a declared environment classification is absent from the observation", () => {
    const result = verifyDeployRecord(declared, {
      ...matchingObservation(),
      environmentNames: [
        { name: "CONTACT_TO", target: "preview", scope: "project" },
        {
          name: "REGISTRY_TOKEN",
          target: "production",
          scope: "shared",
        },
      ],
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict !== "violated") return;
    expect(result.findings.map((entry) => entry.rule)).toContain("deploy-record-environment-classification");
  });

  it("is violated when the observed preview URL differs", () => {
    const result = verifyDeployRecord(declared, {
      ...matchingObservation(),
      previewUrl: "https://other-preview.example.invalid",
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict !== "violated") return;
    expect(result.findings.map((entry) => entry.rule)).toContain("deploy-record-preview-url");
  });

  it("is violated when a declared environment name is missing or its scope differs", () => {
    const missing = verifyDeployRecord(declared, {
      ...matchingObservation(),
      environmentNames: [matchingObservation().environmentNames[1]!],
    });
    expect(missing.verdict).toBe("violated");
    if (missing.verdict !== "violated") return;
    expect(missing.findings.map((entry) => entry.rule)).toContain("deploy-record-environment-missing");

    const scopeDrift = verifyDeployRecord(declared, {
      ...matchingObservation(),
      environmentNames: [
        { name: "CONTACT_TO", target: "preview", classification: "plain", scope: "shared" },
        matchingObservation().environmentNames[1]!,
      ],
    });
    expect(scopeDrift.verdict).toBe("violated");
    if (scopeDrift.verdict !== "violated") return;
    expect(scopeDrift.findings.map((entry) => entry.rule)).toContain("deploy-record-environment-scope");
  });

  it("is violated when observed protection differs", () => {
    const result = verifyDeployRecord(declared, { ...matchingObservation(), protection: "sso" });
    expect(result.verdict).toBe("violated");
    if (result.verdict !== "violated") return;
    expect(result.findings.map((entry) => entry.rule)).toContain("deploy-record-protection");
  });

  it("is indeterminate when an environment observation carries a value field", () => {
    const result = verifyDeployRecord(declared, {
      ...matchingObservation(),
      environmentNames: [
        { name: "CONTACT_TO", target: "preview", scope: "project", value: "redacted" },
      ],
    } as DeployRecordObservation);
    expect(result.verdict).toBe("indeterminate");
    if (result.verdict !== "indeterminate") return;
    expect(result.reason).toBe("observation-carries-secret-value");
  });
});
