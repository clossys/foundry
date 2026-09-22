import { describe, expect, it } from "vitest";
import {
  evaluateWebRouteManifest,
  evaluateWebRouteManifestWithSources,
  extractTemplateNameFromSource,
  scanRouteSourceForDirectComposition,
} from "./checkWebRoutes.js";

describe("publisher-web-route-check manifest evaluation", () => {
  const registered = ["MarketingView", "DashboardView"];

  it("passes when every route names a registered template", () => {
    const result = evaluateWebRouteManifest({
      registeredTemplates: registered,
      routes: [{ id: "/dashboard", template: "DashboardView" }],
    });
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("fails when a route omits template", () => {
    const result = evaluateWebRouteManifest({
      registeredTemplates: registered,
      routes: [{ id: "/orphan", file: "app/routes/orphan.tsx" }],
    });
    expect(result.exitCode).toBe(1);
    expect(result.findings[0]?.rule).toBe("missing-template");
  });

  it("fails when a route names an unregistered template", () => {
    const result = evaluateWebRouteManifest({
      registeredTemplates: registered,
      routes: [{ id: "/custom", template: "MysteryView" }],
    });
    expect(result.exitCode).toBe(1);
    expect(result.findings[0]?.rule).toBe("unknown-template");
  });
});

describe("publisher-web-route-check route source scan", () => {
  it("extracts template literals from route sources", () => {
    expect(extractTemplateNameFromSource(`export const doc = { template: "DashboardView" };`)).toBe("DashboardView");
  });

  it("refuses direct Designer block composition in a route file", () => {
    const source = `import { Hero } from "@clossys/designer/blocks/server";\nexport default () => <Hero id="x" heading="Hi" />;`;
    const findings = scanRouteSourceForDirectComposition(source, "/marketing");
    expect(findings[0]?.rule).toBe("direct-block-composition");
  });

  it("combines manifest and source findings", () => {
    const result = evaluateWebRouteManifestWithSources(
      {
        registeredTemplates: ["DashboardView"],
        routes: [{ id: "/bad", file: "routes/bad.tsx" }],
      },
      {
        "routes/bad.tsx": `import { PageHeader } from "@clossys/designer/blocks/server";\nexport const Page = () => <PageHeader title="x" />;`,
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.findings.some((f) => f.rule === "missing-template")).toBe(true);
    expect(result.findings.some((f) => f.rule === "direct-block-composition")).toBe(true);
  });
});
