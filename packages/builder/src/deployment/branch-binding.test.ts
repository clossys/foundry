import { describe, expect, it } from "vitest";
import {
  REQUIRED_BOUND_DEPLOYMENT_ENVIRONMENT,
  checkDeploymentBranchBindings,
  defineDeploymentBranchBindings,
  isValidDeploymentBranchBindings,
  validateDeploymentBranchBindings,
} from "./branch-binding.js";
import type { DeploymentManifest } from "./types.js";

const manifest: DeploymentManifest = {
  schemaVersion: "1",
  surfaces: [
    {
      id: "web",
      provider: "vercel",
      environment: "production",
      health: { kind: "http", url: "https://example.invalid/health", expectedStatus: 200 },
    },
    {
      id: "web-preview",
      provider: "vercel",
      environment: "preview",
      health: { kind: "http", url: "https://preview.example.invalid/health", expectedStatus: 200 },
    },
  ],
};

const bindings = [
  { environment: "production", branch: "release" },
  { environment: "preview", branch: "main" },
] as const;

describe("deployment branch bindings — shape", () => {
  it("accepts a binding list that names an environment and the branch feeding it", () => {
    expect(validateDeploymentBranchBindings(bindings)).toEqual([]);
    expect(isValidDeploymentBranchBindings(bindings)).toBe(true);
  });

  it("refuses anything that is not an array", () => {
    for (const value of [undefined, null, {}, "release", 3]) {
      expect(validateDeploymentBranchBindings(value).map((f) => f.rule), String(value)).toEqual(["branch-bindings-shape"]);
    }
  });

  it("refuses an unsupported environment", () => {
    const findings = validateDeploymentBranchBindings([{ environment: "qa", branch: "release" }]);
    expect(findings.map((f) => f.rule)).toEqual(["branch-binding-environment"]);
  });

  it("refuses a branch that is not a valid Git branch name", () => {
    for (const branch of ["", " release", "bad branch", "HEAD", "-leading", "a//b", "x.lock", 7, null]) {
      const findings = validateDeploymentBranchBindings([{ environment: "production", branch }]);
      expect(findings.map((f) => f.rule), String(branch)).toEqual(["branch-binding-branch"]);
    }
  });

  it("refuses an unsupported property and a second binding for the same environment", () => {
    expect(
      validateDeploymentBranchBindings([
        { environment: "production", branch: "release", provider: "vercel" },
        { environment: "production", branch: "main" },
      ]).map((f) => f.rule),
    ).toEqual(["branch-binding-unknown-property", "duplicate-branch-binding-environment"]);
  });

  it("treats an input with a throwing accessor as unreadable rather than failing validation itself", () => {
    const hostile = [
      new Proxy(
        { environment: "production", branch: "release" },
        {
          ownKeys: () => {
            throw new Error("hostile trap");
          },
        },
      ),
    ];
    expect(() => validateDeploymentBranchBindings(hostile)).not.toThrow();
    expect(validateDeploymentBranchBindings(hostile).map((f) => f.rule)).toEqual(["branch-bindings-unreadable"]);
  });

  it("produces a detached, explicit binding list", () => {
    const defined = defineDeploymentBranchBindings([{ environment: "production", branch: "release" }]);
    expect(defined).toEqual([{ environment: "production", branch: "release" }]);
    expect(defined[0]).not.toBe(bindings[0]);
  });
});

describe("deployment branch bindings — the seam", () => {
  it("binds production to its branch and reports what it actually compared", () => {
    const result = checkDeploymentBranchBindings({ manifest, branchBindings: bindings });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.productionBranch).toBe("release");
    expect([result.surfacesChecked, result.bindingsChecked]).toEqual([2, 2]);
  });

  it("reports a declared surface whose environment nothing binds", () => {
    const result = checkDeploymentBranchBindings({
      manifest,
      branchBindings: [{ environment: "preview", branch: "main" }],
    });
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.rule)).toEqual(["surface-environment-unbound", "required-environment-unbound"]);
    expect(result.productionBranch).toBeUndefined();
  });

  // A checker handed nothing to check must never report the same shape as one
  // that checked everything and agreed.
  it("fails closed on an empty binding list rather than passing vacuously", () => {
    const result = checkDeploymentBranchBindings({ manifest, branchBindings: [] });
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.rule)).toContain("branch-bindings-empty");
    expect(result.bindingsChecked).toBe(0);
  });

  it("fails closed on a manifest with no surfaces rather than passing vacuously", () => {
    const result = checkDeploymentBranchBindings({
      manifest: { schemaVersion: "1", surfaces: [] },
      branchBindings: bindings,
    });
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.rule)).toContain("manifest-surfaces-empty");
    expect(result.surfacesChecked).toBe(0);
  });

  it("never reports a production branch alongside findings", () => {
    const result = checkDeploymentBranchBindings({
      manifest,
      branchBindings: [{ environment: "production", branch: "release" }],
    });
    expect(result.ok).toBe(false);
    expect(result.productionBranch).toBeUndefined();
  });

  it("names production as the environment a repository cannot leave unbound", () => {
    expect(REQUIRED_BOUND_DEPLOYMENT_ENVIRONMENT).toBe("production");
  });
});
