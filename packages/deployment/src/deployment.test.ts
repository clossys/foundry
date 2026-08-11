import { describe, expect, it } from "vitest";
import { defineDeploymentManifest, evaluateDeploymentHealth, serializeDeploymentManifest, validateDeploymentManifest } from "./index.js";

describe("deployment contract", () => {
  it("detaches authored surfaces and serializes deterministically", () => {
    const definition = {
      schemaVersion: "1" as const,
      surfaces: [{ id: "web", provider: "vercel", environment: "production" as const, health: { kind: "http" as const, url: "https://example.test/health" } }],
    };
    const manifest = defineDeploymentManifest(definition);
    definition.surfaces[0]!.id = "changed";
    expect(manifest.surfaces[0]!.id).toBe("web");
    expect(serializeDeploymentManifest(manifest)).toContain('"expectedStatus": 200');
  });

  it("rejects unsafe health targets and duplicate ids", () => {
    const findings = validateDeploymentManifest({
      schemaVersion: "1",
      surfaces: [
        { id: "web", provider: "vercel", environment: "production", health: { kind: "http", url: "https://user:pass@example.test/?x=1" } },
        { id: "web", provider: "render", environment: "preview", health: { kind: "http", url: "https://example.test" } },
      ],
    });
    expect(findings.map((finding) => finding.rule)).toEqual(expect.arrayContaining(["health-url", "duplicate-surface-id"]));
  });

  it("prioritizes unhealthy states in health summaries", () => {
    expect(evaluateDeploymentHealth([{ surfaceId: "a", status: "healthy" }, { surfaceId: "b", status: "unhealthy" }])).toMatchObject({ status: "unhealthy", healthy: 1, unhealthy: 1 });
  });
});
