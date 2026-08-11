import { describe, expect, it } from "vitest";
import { defineDeploymentManifest, evaluateDeploymentHealth, isValidDeploymentManifest, normalizeDeploymentManifest, serializeDeploymentManifest, validateDeploymentManifest } from "./index.js";

describe("deployment contract", () => {
  it("detaches authored surfaces and serializes deterministically", () => {
    const definition = {
      schemaVersion: "1" as const,
      surfaces: [{ id: "web", provider: "vercel", environment: "production" as const, health: { kind: "http" as const, url: "https://example.test/health" } }],
    };
    const manifest = defineDeploymentManifest(definition);
    definition.surfaces[0]!.id = "changed";
    definition.surfaces[0]!.health.url = "https://changed.test/health";
    expect(manifest.surfaces[0]!.id).toBe("web");
    expect(manifest.surfaces[0]!.health.url).toBe("https://example.test/health");
    expect(serializeDeploymentManifest(manifest)).toContain('"expectedStatus": 200');
  });

  it("sorts normalized surfaces with a stable identifier ordering", () => {
    const manifest = defineDeploymentManifest({
      schemaVersion: "1",
      surfaces: [
        { id: "zebra", provider: "vercel", environment: "production", health: { kind: "http", url: "https://zebra.test/health" } },
        { id: "alpha", provider: "render", environment: "preview", health: { kind: "http", url: "https://alpha.test/health" } },
      ],
    });
    expect(normalizeDeploymentManifest(manifest).surfaces.map((surface) => surface.id)).toEqual(["alpha", "zebra"]);
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

  it("rejects health URLs with surrounding whitespace", () => {
    const findings = validateDeploymentManifest({
      schemaVersion: "1",
      surfaces: [{ id: "web", provider: "vercel", environment: "production", health: { kind: "http", url: " https://example.test/health " } }],
    });
    expect(findings.map((finding) => finding.rule)).toContain("health-url");
  });

  it("does not throw when untyped input contains a throwing accessor", () => {
    const manifest = {
      schemaVersion: "1",
      get surfaces(): never {
        throw new Error("untrusted accessor");
      },
    };
    expect(() => validateDeploymentManifest(manifest)).not.toThrow();
    expect(validateDeploymentManifest(manifest).map((finding) => finding.rule)).toContain("manifest-unreadable");
    expect(isValidDeploymentManifest(manifest)).toBe(false);
  });

  it("prioritizes unhealthy states in health summaries", () => {
    expect(evaluateDeploymentHealth([{ surfaceId: "a", status: "healthy" }, { surfaceId: "b", status: "unhealthy" }])).toMatchObject({ status: "unhealthy", healthy: 1, unhealthy: 1 });
  });

  it("reports unknown when runtime observations contain no recognized state", () => {
    const observations = [{ surfaceId: "a", status: "not-a-status" }] as unknown as Parameters<typeof evaluateDeploymentHealth>[0];
    expect(evaluateDeploymentHealth(observations)).toEqual({ status: "unknown", healthy: 0, degraded: 0, unhealthy: 0, unknown: 0 });
  });
});
