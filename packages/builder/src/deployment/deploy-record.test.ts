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

  it("is violated under release-ref when main is deploy-enabled while production is not release", () => {
    const result = verifyDeployRecord(declared, {
      ...matchingObservation(),
      productionBranch: "main",
      deployEnabledBranches: ["main"],
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict !== "violated") return;
    expect(result.findings.map((entry) => entry.rule)).toContain("deploy-record-release-ref-main-deploy");
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
