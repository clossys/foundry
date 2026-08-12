import { describe, expect, it } from "vitest";
import { defineDeploymentConfigurationPlan, defineDeploymentManifest } from "../index.js";
import { renderVercelConfiguration } from "./index.js";

describe("Vercel configuration renderer", () => {
  it("renders a deterministic repository-root vercel.json artifact", () => {
    const artifact = renderVercelConfiguration(defineDeploymentConfigurationPlan({
      manifest: defineDeploymentManifest({
        schemaVersion: "1",
        surfaces: [{ id: "web", provider: "vercel", environment: "production", health: { kind: "http", url: "https://example.test/health" } }],
      }),
      requirements: [{
        surfaceId: "web",
        build: { command: "pnpm build", outputDirectory: "dist" },
        routing: [{ source: "/*", destination: "/index.html" }],
        requiredEnvironmentVariables: ["PUBLIC_API_URL"],
      }],
    }));
    expect(artifact).toEqual({
      provider: "vercel",
      path: "vercel.json",
      content: "{\n  \"$schema\": \"https://openapi.vercel.sh/vercel.json\",\n  \"buildCommand\": \"pnpm build\",\n  \"outputDirectory\": \"dist\",\n  \"rewrites\": [\n    {\n      \"source\": \"/*\",\n      \"destination\": \"/index.html\"\n    }\n  ]\n}\n",
      requiredEnvironmentVariables: ["PUBLIC_API_URL"],
      repositorySetup: [
        "Review the generated vercel.json and write it at the repository root.",
        "Import the repository into one Vercel project with its Root Directory set to the repository root.",
        "Set these names in the Vercel project settings or CI without committing values: PUBLIC_API_URL.",
        "Keep deployment triggering in the repository and provider integration; this artifact does not deploy or change provider settings.",
      ],
    });
  });

  it("refuses to render a plan without a Vercel surface", () => {
    const plan = defineDeploymentConfigurationPlan({
      manifest: defineDeploymentManifest({
        schemaVersion: "1",
        surfaces: [{ id: "docs", provider: "render", environment: "production", health: { kind: "http", url: "https://docs.example.test/health" } }],
      }),
      requirements: [{ surfaceId: "docs", build: { command: "pnpm build", outputDirectory: "dist" } }],
    });
    expect(() => renderVercelConfiguration(plan)).toThrow("no vercel surface");
  });
});
