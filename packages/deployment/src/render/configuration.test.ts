import { describe, expect, it } from "vitest";
import { defineDeploymentConfigurationPlan, defineDeploymentManifest } from "../index.js";
import { renderRenderConfiguration } from "./index.js";

describe("Render configuration renderer", () => {
  it("renders a deterministic static-site Blueprint artifact", () => {
    const artifact = renderRenderConfiguration(defineDeploymentConfigurationPlan({
      manifest: defineDeploymentManifest({
        schemaVersion: "1",
        surfaces: [{ id: "docs", provider: "render", environment: "production", health: { kind: "http", url: "https://docs.example.test/health" } }],
      }),
      requirements: [{
        surfaceId: "docs",
        build: { command: "pnpm build:docs", outputDirectory: "apps/docs/dist" },
        routing: [{ source: "/*", destination: "/index.html" }],
        requiredEnvironmentVariables: ["DOCS_API_URL"],
      }],
    }));
    expect(artifact).toEqual({
      provider: "render",
      path: "render.yaml",
      content: "services:\n  - type: web\n    runtime: static\n    name: \"docs\"\n    buildCommand: \"pnpm build:docs\"\n    staticPublishPath: \"./apps/docs/dist\"\n    routes:\n      - type: rewrite\n        source: \"/*\"\n        destination: \"/index.html\"\n",
      requiredEnvironmentVariables: ["DOCS_API_URL"],
      repositorySetup: [
        "Review the generated render.yaml and write it at the repository root.",
        "Create or link a Render Blueprint for the repository and select render.yaml as its Blueprint file.",
        "Set these names in the Render service settings without committing values: DOCS_API_URL.",
        "Review the Blueprint in Render before applying it; this artifact does not authenticate, apply configuration, or deploy.",
      ],
    });
  });

  it("refuses to render a plan without a Render surface", () => {
    const plan = defineDeploymentConfigurationPlan({
      manifest: defineDeploymentManifest({
        schemaVersion: "1",
        surfaces: [{ id: "web", provider: "vercel", environment: "production", health: { kind: "http", url: "https://example.test/health" } }],
      }),
      requirements: [{ surfaceId: "web", build: { command: "pnpm build", outputDirectory: "dist" } }],
    });
    expect(() => renderRenderConfiguration(plan)).toThrow("no render surface");
  });
});
