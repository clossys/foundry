import { describe, expect, it } from "vitest";
import { defineDeploymentManifest, validateDeploymentManifest } from "./index.js";
import { checkDeploymentSurfaceDevPort } from "./dev-port.js";

const health = { kind: "http" as const, url: "https://example.test/health" };

function surface(extra: { localPort?: unknown; devScript?: unknown }) {
  return {
    schemaVersion: "1" as const,
    surfaces: [{
      id: "web",
      provider: "vercel",
      environment: "development" as const,
      health,
      ...extra,
    }],
  };
}

describe("deployment surface localPort", () => {
  it("accepts a dev script that passes the declared localPort", () => {
    const manifest = defineDeploymentManifest({
      schemaVersion: "1",
      surfaces: [{
        id: "web",
        provider: "vercel",
        environment: "development",
        localPort: 4321,
        devScript: "next dev --port 4321",
        health,
      }],
    });
    expect(manifest.surfaces[0]?.localPort).toBe(4321);
    expect(validateDeploymentManifest(manifest)).toEqual([]);
    expect(checkDeploymentSurfaceDevPort({ localPort: 4321, devScript: "next dev -p 4321" })).toEqual([]);
    expect(checkDeploymentSurfaceDevPort({ localPort: 4321, devScript: "next dev --port=4321" })).toEqual([]);
  });

  it("rejects a dev script that passes a different port", () => {
    const findings = validateDeploymentManifest(surface({ localPort: 4321, devScript: "next dev --port 3000" }));
    expect(findings.map((finding) => finding.rule)).toContain("dev-script-port");
  });

  it("rejects a dev script that does not pass a port", () => {
    const findings = validateDeploymentManifest(surface({ localPort: 4321, devScript: "next dev" }));
    expect(findings.map((finding) => finding.rule)).toEqual(["dev-script-port"]);
  });

  it("rejects a localPort outside 1 through 65535", () => {
    expect(validateDeploymentManifest(surface({ localPort: 0, devScript: "next dev --port 0" })).map((finding) => finding.rule)).toContain("local-port");
    expect(validateDeploymentManifest(surface({ localPort: 70000, devScript: "next dev --port 70000" })).map((finding) => finding.rule)).toContain("local-port");
  });

  it("keeps a surface without localPort valid", () => {
    expect(validateDeploymentManifest(surface({})).map((finding) => finding.rule)).not.toContain("dev-script-port");
  });
});
