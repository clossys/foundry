import { describe, expect, it } from "vitest";
import {
  evaluateCiConventions,
  type CiConventionsDeclaration,
  type CiConventionsRuleset,
  type RunnerPricingData,
  type WorkflowFile,
} from "./ci-conventions.js";
import type { RunnerConventions } from "./runner.js";

const RULESET: CiConventionsRuleset = {
  requiredContexts: ["verify-build"],
  maxRetentionDays: 14,
  protectedRefWorkflows: ["publish.yml"],
};

const DECLARATION: CiConventionsDeclaration = {
  visibility: "public",
  requiredContextWorkflows: { "verify-build": ".github/workflows/ci.yml" },
};

function file(path: string, content: string): WorkflowFile {
  return { path, content };
}

const CONFORMING_CI = [
  "name: CI",
  "on:",
  "  pull_request:",
  "  merge_group:",
  "permissions:",
  "  contents: read",
  "concurrency:",
  "  group: ci-${{ github.ref }}",
  "  cancel-in-progress: true",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 10",
  "    steps:",
  "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
].join("\n");

describe("evaluateCiConventions", () => {
  it("is satisfied for a fully conforming workflow set", () => {
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", CONFORMING_CI)],
      ruleset: RULESET,
      declaration: DECLARATION,
      packageVersion: "0.9.15",
    });
    expect(result.verdict).toBe("satisfied");
    expect(result.package).toBe("@clossys/controller");
    expect(result.version).toBe("0.9.15");
    // No error-severity findings -- the one warning is "no runner
    // conventions declared", which DECLARATION deliberately omits.
    expect(result.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: "ci/no-runner-conventions-declared", severity: "warning" }),
    ]);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.nextAction).toBeUndefined();
  });

  it("reports indeterminate with no workflow files", () => {
    const result = evaluateCiConventions({
      workflowFiles: [],
      ruleset: RULESET,
      declaration: DECLARATION,
      packageVersion: "0.9.15",
    });
    expect(result.verdict).toBe("indeterminate");
    expect(result.nextAction).toBeDefined();
  });

  it("reports ci/unparsable-workflow as an error finding rather than throwing", () => {
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/bad.yml", "jobs:\n  build:\n    not a mapping entry at all\n")],
      ruleset: RULESET,
      declaration: { visibility: "public" },
      packageVersion: "0.9.15",
    });
    expect(result.verdict).toBe("violated");
    expect(result.findings.some((f) => f.rule === "ci/unparsable-workflow")).toBe(true);
  });

  it("flags cancel-in-progress: true on a push-to-main workflow", () => {
    const doc = [
      "on:",
      "  push:",
      "    branches: [main]",
      "concurrency:",
      "  group: ci-${{ github.ref }}",
      "  cancel-in-progress: true",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
    ].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", doc)],
      ruleset: { requiredContexts: [], maxRetentionDays: 14 },
      declaration: { visibility: "public" },
      packageVersion: "0.9.15",
    });
    expect(result.findings.map((f) => f.rule)).toContain("ci/cancel-in-progress-on-protected-ref");
  });

  it("does not flag cancel-in-progress: true on a PR-only workflow", () => {
    const doc = [
      "on:",
      "  pull_request:",
      "concurrency:",
      "  group: ci-${{ github.ref }}",
      "  cancel-in-progress: true",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
    ].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", doc)],
      ruleset: { requiredContexts: [], maxRetentionDays: 14 },
      declaration: { visibility: "public" },
      packageVersion: "0.9.15",
    });
    expect(result.findings.map((f) => f.rule)).not.toContain("ci/cancel-in-progress-on-protected-ref");
  });

  it("flags a declared protectedRefWorkflows basename even without a push trigger", () => {
    const doc = ["on:", "  workflow_dispatch:", "concurrency:", "  group: publish", "  cancel-in-progress: true", "jobs:", "  publish:", "    runs-on: ubuntu-latest", "    timeout-minutes: 5"].join(
      "\n",
    );
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/publish.yml", doc)],
      ruleset: RULESET,
      declaration: { visibility: "public" },
      packageVersion: "0.9.15",
    });
    expect(result.findings.map((f) => f.rule)).toContain("ci/cancel-in-progress-on-protected-ref");
  });

  it("flags a job with no timeout-minutes", () => {
    const doc = ["jobs:", "  build:", "    runs-on: ubuntu-latest"].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", doc)],
      ruleset: { requiredContexts: [], maxRetentionDays: 14 },
      declaration: { visibility: "public" },
      packageVersion: "0.9.15",
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: "ci/missing-timeout-minutes", severity: "error" }),
    );
  });

  it("flags an action pinned to a tag instead of a full SHA", () => {
    const doc = [
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
      "    steps:",
      "      - uses: actions/checkout@v4",
    ].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", doc)],
      ruleset: { requiredContexts: [], maxRetentionDays: 14 },
      declaration: { visibility: "public" },
      packageVersion: "0.9.15",
    });
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "ci/unpinned-action" }));
  });

  it("does not flag a local action or a docker:// reference", () => {
    const doc = [
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
      "    steps:",
      "      - uses: ./.github/actions/local",
      "      - uses: docker://alpine:3.19",
    ].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", doc)],
      ruleset: { requiredContexts: [], maxRetentionDays: 14 },
      declaration: { visibility: "public" },
      packageVersion: "0.9.15",
    });
    expect(result.findings.map((f) => f.rule)).not.toContain("ci/unpinned-action");
  });

  it("flags a workflow with no top-level permissions", () => {
    const doc = ["jobs:", "  build:", "    runs-on: ubuntu-latest", "    timeout-minutes: 5"].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", doc)],
      ruleset: { requiredContexts: [], maxRetentionDays: 14 },
      declaration: { visibility: "public" },
      packageVersion: "0.9.15",
    });
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "ci/missing-top-level-permissions" }));
  });

  it("flags a required context missing merge_group and warns when unmapped", () => {
    const prOnly = ["on:", "  pull_request:", "jobs:", "  build:", "    runs-on: ubuntu-latest", "    timeout-minutes: 5"].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", prOnly)],
      ruleset: { requiredContexts: ["verify-build", "scan-secrets"], maxRetentionDays: 14 },
      declaration: {
        visibility: "public",
        requiredContextWorkflows: { "verify-build": ".github/workflows/ci.yml" },
      },
      packageVersion: "0.9.15",
    });
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "ci/both-triggers" }));
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: "ci/unmapped-required-context", path: "scan-secrets" }),
    );
  });

  it("flags a required workflow that path-filters its pull_request trigger", () => {
    const doc = [
      "on:",
      "  pull_request:",
      "    paths:",
      "      - 'packages/**'",
      "  merge_group:",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
    ].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", doc)],
      ruleset: RULESET,
      declaration: DECLARATION,
      packageVersion: "0.9.15",
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: "ci/trigger-path-filter-on-required-workflow" }),
    );
  });

  it("flags a fan-in job with no if: always()", () => {
    const doc = [
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
      "  b:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
      "  fan-in:",
      "    needs: [a, b]",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
    ].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", doc)],
      ruleset: { requiredContexts: [], maxRetentionDays: 14 },
      declaration: { visibility: "public" },
      packageVersion: "0.9.15",
    });
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "ci/fan-in-missing-always" }));
  });

  it("warns (not errors) a fan-in job with if: always() but no explicit results check", () => {
    const doc = [
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
      "  b:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
      "  fan-in:",
      "    needs: [a, b]",
      "    if: always()",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
      "    steps:",
      "      - run: echo done",
    ].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", doc)],
      ruleset: { requiredContexts: [], maxRetentionDays: 14 },
      declaration: { visibility: "public" },
      packageVersion: "0.9.15",
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: "ci/fan-in-missing-results-check", severity: "warning" }),
    );
  });

  it("does not flag a fan-in job that checks needs.*.result explicitly under if: always()", () => {
    const doc = [
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
      "  b:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
      "  fan-in:",
      "    needs: [a, b]",
      "    if: always()",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
      "    steps:",
      "      - run: |",
      "          echo needs.a.result",
    ].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", doc)],
      ruleset: { requiredContexts: [], maxRetentionDays: 14 },
      declaration: { visibility: "public" },
      packageVersion: "0.9.15",
    });
    expect(result.findings.map((f) => f.rule)).not.toContain("ci/fan-in-missing-always");
    expect(result.findings.map((f) => f.rule)).not.toContain("ci/fan-in-missing-results-check");
  });

  it("runs validateGateName over the required contexts and maps severities", () => {
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", CONFORMING_CI)],
      ruleset: { requiredContexts: ["build and test", "verify-build"], maxRetentionDays: 14 },
      declaration: { visibility: "public" },
      packageVersion: "0.9.15",
    });
    const gateFindings = result.findings.filter((f) => f.rule.startsWith("gate/"));
    expect(gateFindings.length).toBeGreaterThan(0);
    expect(gateFindings.every((f) => f.severity === "error" || f.severity === "warning")).toBe(true);
  });

  it("warns when no runner conventions are declared", () => {
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", CONFORMING_CI)],
      ruleset: RULESET,
      declaration: DECLARATION,
      packageVersion: "0.9.15",
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: "ci/no-runner-conventions-declared", severity: "warning" }),
    );
  });

  it("flags a paid-provider label on a public repo via the runner-label rule", () => {
    const runnerConventions: RunnerConventions = {
      vocabulary: {
        labels: [{ label: "blacksmith-2vcpu-ubuntu-2204", capacity: "standard", intendedWorkload: "default" }],
        defaultLabel: "blacksmith-2vcpu-ubuntu-2204",
        highCapacityJustifiedJobs: [],
      },
      publicRepos: [],
    };
    const doc = [
      "permissions:",
      "  contents: read",
      "jobs:",
      "  build:",
      "    runs-on: blacksmith-2vcpu-ubuntu-2204",
      "    timeout-minutes: 5",
    ].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", doc)],
      ruleset: { requiredContexts: [], maxRetentionDays: 14 },
      declaration: { visibility: "public", repositoryIdentifier: "foundry", runnerConventions },
      packageVersion: "0.9.15",
    });
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "runner/visibility-mismatch" }));
  });

  it("flags a missing retention-days on actions/upload-artifact as a warning", () => {
    const doc = [
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
      "    steps:",
      "      - uses: actions/upload-artifact@11d5960a326750d5838078e36cf38b85af677262",
      "        with:",
      "          name: report",
    ].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", doc)],
      ruleset: { requiredContexts: [], maxRetentionDays: 14 },
      declaration: { visibility: "public" },
      packageVersion: "0.9.15",
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: "ci/missing-retention-days", severity: "warning" }),
    );
  });

  it("computes a projected-minutes metric and warns over the free allowance or declared budget, only for private repos with run history", () => {
    const pricing: RunnerPricingData = {
      asOf: "2026-09-23",
      githubHosted: { privateRepos: { freeMinutesAllowance: { free: 2000, team: 3000, enterpriseCloud: 50000 } } },
      blacksmith: { freeMinutesAllowance: { allPlans: 3000 } },
    };
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", CONFORMING_CI)],
      ruleset: RULESET,
      declaration: { visibility: "private", plan: "free", monthlyMinutesBudget: 4000, runHistoryMinutes: 6000 },
      pricing,
      packageVersion: "0.9.15",
    });
    expect(result.metric).toEqual({ name: "projectedMonthlyMinutes", value: 6000, direction: "decrease" });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: "ci/projected-minutes-over-free-allowance" }),
    );
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "ci/projected-minutes-over-budget" }));
  });

  it("skips the projected-minutes rule when no run history is supplied, and for public repos", () => {
    const pricing: RunnerPricingData = {
      asOf: "2026-09-23",
      githubHosted: { privateRepos: { freeMinutesAllowance: { free: 2000, team: 3000, enterpriseCloud: 50000 } } },
      blacksmith: { freeMinutesAllowance: { allPlans: 3000 } },
    };
    const withoutHistory = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", CONFORMING_CI)],
      ruleset: RULESET,
      declaration: { visibility: "private", monthlyMinutesBudget: 100 },
      pricing,
      packageVersion: "0.9.15",
    });
    expect(withoutHistory.metric).toBeUndefined();
    expect(withoutHistory.findings.map((f) => f.rule)).not.toContain("ci/projected-minutes-over-budget");

    const publicRepo = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", CONFORMING_CI)],
      ruleset: RULESET,
      declaration: { visibility: "public", runHistoryMinutes: 999999 },
      pricing,
      packageVersion: "0.9.15",
    });
    expect(publicRepo.metric).toBeUndefined();
  });

  it("suppresses a finding covered by a justified exception, and leaves others alone", () => {
    const doc = ["jobs:", "  build:", "    runs-on: ubuntu-latest"].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", doc)],
      ruleset: { requiredContexts: [], maxRetentionDays: 14 },
      declaration: {
        visibility: "public",
        justifiedExceptions: [
          { rule: "ci/missing-timeout-minutes", scope: "ci.yml#build", reason: "single fast job", issue: 1 },
        ],
      },
      packageVersion: "0.9.15",
    });
    expect(result.findings.map((f) => f.rule)).not.toContain("ci/missing-timeout-minutes");
    // Top-level permissions is still missing and NOT exempted.
    expect(result.findings.map((f) => f.rule)).toContain("ci/missing-top-level-permissions");
  });

  it("verdict is violated whenever any error-severity finding exists, regardless of warning count", () => {
    const doc = ["jobs:", "  build:", "    runs-on: ubuntu-latest", "    timeout-minutes: 5"].join("\n");
    const result = evaluateCiConventions({
      workflowFiles: [file(".github/workflows/ci.yml", doc)],
      ruleset: { requiredContexts: [], maxRetentionDays: 14 },
      declaration: { visibility: "public" },
      packageVersion: "0.9.15",
    });
    expect(result.verdict).toBe("violated");
    expect(result.findings.some((f) => f.severity === "error")).toBe(true);
  });

  describe("declaration.weeklyAdoption (#1187/#1259 cadence rule)", () => {
    it("is skipped entirely when weeklyAdoption is omitted -- e.g. this repository, a producer not a consumer", () => {
      const result = evaluateCiConventions({
        workflowFiles: [file(".github/workflows/ci.yml", CONFORMING_CI)],
        ruleset: RULESET,
        declaration: DECLARATION,
        packageVersion: "0.9.15",
      });
      expect(result.findings.map((f) => f.rule)).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^ci\/weekly-adoption-/)]),
      );
    });

    it("is skipped entirely when weeklyAdoption.applies is false", () => {
      const result = evaluateCiConventions({
        workflowFiles: [file(".github/workflows/ci.yml", CONFORMING_CI)],
        ruleset: RULESET,
        declaration: { ...DECLARATION, weeklyAdoption: { applies: false } },
        packageVersion: "0.9.15",
      });
      expect(result.findings.map((f) => f.rule)).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^ci\/weekly-adoption-/)]),
      );
    });

    it("reports findings for a consuming repository with no updater configured and no provenance check required", () => {
      const result = evaluateCiConventions({
        workflowFiles: [file(".github/workflows/ci.yml", CONFORMING_CI)],
        ruleset: RULESET,
        declaration: {
          ...DECLARATION,
          weeklyAdoption: { applies: true, timezone: "America/Los_Angeles" },
        },
        packageVersion: "0.9.15",
      });
      expect(result.findings.map((f) => f.rule)).toEqual(
        expect.arrayContaining(["ci/weekly-adoption-no-updater-configured", "ci/weekly-adoption-provenance-check-required"]),
      );
      expect(result.verdict).toBe("violated");
    });

    it("is satisfied for a conforming Renovate config plus integrator-provenance-check in required contexts", () => {
      const renovateConfig = JSON.stringify({
        packageRules: [{ matchPackagePatterns: ["^@clossys/"], groupName: "clossys", schedule: ["on sunday"] }],
      });
      const result = evaluateCiConventions({
        workflowFiles: [file(".github/workflows/ci.yml", CONFORMING_CI)],
        ruleset: RULESET,
        declaration: {
          ...DECLARATION,
          weeklyAdoption: {
            applies: true,
            timezone: "America/Los_Angeles",
            adoptionPrRequiredContexts: ["verify-build", "integrator-provenance-check"],
            updaterConfig: { path: ".github/renovate.json", kind: "renovate", content: renovateConfig },
          },
        },
        packageVersion: "0.9.15",
      });
      expect(result.findings.map((f) => f.rule)).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^ci\/weekly-adoption-/)]),
      );
    });
  });
});
