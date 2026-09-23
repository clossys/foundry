import { describe, expect, it } from "vitest";
import { defineWebSurfaceDeclaration } from "./define.js";
import { normalizeWebSurfaceDeclaration, serializeWebSurfaceDeclaration } from "./normalize.js";

function definition() {
  return {
    schemaVersion: "1" as const,
    domain: "EXAMPLE.com.",
    dnsProvider: "cloudflare",
    records: [
      { type: "CNAME" as const, name: "www", value: "example.com" },
      { type: "A" as const, name: "@", value: "192.0.2.1" },
    ],
    hostingProvider: "vercel",
    hostingProject: "example-site",
    build: { command: "npm run build", outputDirectory: "dist", applicationRoot: "apps/site" },
    environments: [
      { environment: "preview" as const, hostname: "preview.example.com.", branch: "develop" },
      { environment: "production" as const, hostname: "example.com", branch: "main" },
    ],
    routes: ["/about", "/"],
  };
}

describe("defineWebSurfaceDeclaration", () => {
  it("normalizes the domain and hostnames and defaults proxied to false", () => {
    const declaration = defineWebSurfaceDeclaration(definition());
    expect(declaration.domain).toBe("example.com");
    expect(declaration.environments.find((entry) => entry.environment === "production")?.hostname).toBe("example.com");
    expect(declaration.records.every((record) => record.proxied === false)).toBe(true);
  });

  it("always includes the root route exactly once", () => {
    const declaration = defineWebSurfaceDeclaration(definition());
    expect(declaration.routes.filter((route) => route === "/")).toHaveLength(1);
    expect(declaration.routes).toContain("/about");
  });

  it("refuses an invalid definition", () => {
    expect(() => defineWebSurfaceDeclaration({ ...definition(), domain: "not a domain" })).toThrow("Invalid web surface declaration.");
  });
});

describe("normalizeWebSurfaceDeclaration / serializeWebSurfaceDeclaration", () => {
  it("sorts records, environments, and routes deterministically regardless of input order", () => {
    const declaration = defineWebSurfaceDeclaration(definition());
    const reordered = defineWebSurfaceDeclaration({
      ...definition(),
      records: [...definition().records].reverse(),
      environments: [...definition().environments].reverse(),
    });
    expect(normalizeWebSurfaceDeclaration(declaration)).toEqual(normalizeWebSurfaceDeclaration(reordered));
  });

  it("serializes as stable, trailing-newline-terminated JSON", () => {
    const declaration = defineWebSurfaceDeclaration(definition());
    const first = serializeWebSurfaceDeclaration(declaration);
    const second = serializeWebSurfaceDeclaration(declaration);
    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(JSON.parse(first)).toEqual(normalizeWebSurfaceDeclaration(declaration));
  });
});
