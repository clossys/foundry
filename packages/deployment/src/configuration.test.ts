import { describe, expect, it } from "vitest";
import { defineDeploymentConfigurationPlan, defineDeploymentManifest, validateDeploymentConfigurationPlan } from "./index.js";

const manifest = defineDeploymentManifest({
  schemaVersion: "1",
  surfaces: [
    { id: "web", provider: "vercel", environment: "production", health: { kind: "http", url: "https://example.test/health" } },
    { id: "docs", provider: "render", environment: "production", health: { kind: "http", url: "https://docs.example.test/health" } },
  ],
});

describe("deployment configuration plan", () => {
  it("normalizes requirements while preserving route order and exposing only variable names", () => {
    const plan = defineDeploymentConfigurationPlan({
      manifest,
      requirements: [
        {
          surfaceId: "web",
          build: { command: "pnpm build:web", outputDirectory: "apps/web/dist" },
          routing: [{ source: "/*", destination: "/index.html" }, { source: "/health", destination: "/health.html" }],
          requiredEnvironmentVariables: ["PUBLIC_API_URL", "ANALYTICS_KEY"],
        },
        {
          surfaceId: "docs",
          build: { command: "pnpm build:docs", outputDirectory: "apps/docs/dist" },
        },
      ],
    });
    expect(plan.requirements.map((requirement) => requirement.surfaceId)).toEqual(["docs", "web"]);
    expect(plan.requirements[1]!.routing.map((route) => route.source)).toEqual(["/*", "/health"]);
    expect(plan.requirements[1]!.requiredEnvironmentVariables).toEqual(["ANALYTICS_KEY", "PUBLIC_API_URL"]);
  });

  it("reports invalid routes, paths, variable names, and incomplete manifest coverage", () => {
    const findings = validateDeploymentConfigurationPlan({
      manifest,
      requirements: [{
        surfaceId: "web",
        build: { command: "", outputDirectory: "../dist" },
        routing: [{ source: "https://example.test", destination: "/index.html" }],
        requiredEnvironmentVariables: ["lowercase", "VALID_NAME", "VALID_NAME"],
      }],
    });
    expect(findings.map((finding) => finding.rule)).toEqual(expect.arrayContaining([
      "configuration-build-command",
      "configuration-output-directory",
      "configuration-route-source",
      "configuration-environment-variable-name",
      "configuration-duplicate-environment-variable",
      "configuration-missing-requirement",
    ]));
  });

  it("does not throw when a plan contains an unreadable accessor", () => {
    const plan = {
      manifest,
      get requirements(): never {
        throw new Error("untrusted accessor");
      },
    };
    expect(() => validateDeploymentConfigurationPlan(plan)).not.toThrow();
    expect(validateDeploymentConfigurationPlan(plan).map((finding) => finding.rule)).toContain("configuration-plan-unreadable");
  });
});
