import { describe, expect, it } from "vitest";
import { defineWebSurfaceDeclaration } from "./define.js";
import { renderWebSurfaceSetupSteps } from "./setup-steps.js";

describe("renderWebSurfaceSetupSteps", () => {
  it("deterministically renders every record, the hosting project, build settings, and each environment binding", () => {
    const declaration = defineWebSurfaceDeclaration({
      schemaVersion: "1",
      domain: "example.com",
      dnsProvider: "cloudflare",
      records: [
        { type: "A", name: "@", value: "192.0.2.1" },
        { type: "CNAME", name: "www", value: "example.com", proxied: true },
        { type: "MX", name: "@", value: "mail.example.com", priority: 10 },
      ],
      hostingProvider: "vercel",
      hostingProject: "example-site",
      build: { command: "npm run build", outputDirectory: "dist", applicationRoot: "apps/site" },
      environments: [{ environment: "production", hostname: "example.com", branch: "main" }],
    });

    const steps = renderWebSurfaceSetupSteps(declaration);
    expect(steps[0]).toBe("Create 3 DNS record(s) for example.com with cloudflare:");
    expect(steps).toContain("  - A example.com -> 192.0.2.1");
    expect(steps).toContain("  - CNAME www.example.com -> example.com (proxied)");
    expect(steps).toContain("  - MX example.com -> mail.example.com (priority 10)");
    expect(steps).toContain('Create or link hosting project "example-site" on vercel, with its application root set to "apps/site".');
    expect(steps).toContain('Set the build command to "npm run build" and the output directory to "dist".');
    expect(steps).toContain('Bind the "production" environment to branch "main", serving example.com.');
    expect(steps.at(-1)).toBe("Review every value above before applying it; this function does not authenticate, call a provider API, or change anything live.");
  });

  it("performs no I/O -- calling it twice for the same declaration is byte-identical", () => {
    const declaration = defineWebSurfaceDeclaration({
      schemaVersion: "1",
      domain: "example.com",
      dnsProvider: "cloudflare",
      records: [{ type: "A", name: "@", value: "192.0.2.1" }],
      hostingProvider: "vercel",
      hostingProject: "example-site",
      build: { command: "npm run build", outputDirectory: "dist", applicationRoot: "apps/site" },
      environments: [{ environment: "production", hostname: "example.com", branch: "main" }],
    });
    expect(renderWebSurfaceSetupSteps(declaration)).toEqual(renderWebSurfaceSetupSteps(declaration));
  });
});
