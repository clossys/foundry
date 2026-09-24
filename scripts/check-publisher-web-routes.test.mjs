// Regression tests for check-publisher-web-routes.mjs (issue #1103).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { makeTmpDirSync } from "./lib/tmp-fixture.mjs";

import {
  evaluateWebRouteManifest,
  evaluateWebRouteManifestWithSources,
  scanPublisherWebRoutes,
} from "./check-publisher-web-routes.mjs";

test("registered template passes", () => {
  const result = evaluateWebRouteManifest({
    registeredTemplates: ["DashboardView"],
    routes: [{ id: "/dashboard", template: "DashboardView" }],
  });
  assert.equal(result.exitCode, 0);
});

test("missing template fails", () => {
  const result = evaluateWebRouteManifest({
    registeredTemplates: ["DashboardView"],
    routes: [{ id: "/orphan" }],
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.findings[0].rule, "missing-template");
});

test("fixture manifest without template fails CLI scan", (t) => {
  const root = makeTmpDirSync(t, "publisher-web-routes-");
  const routesDir = join(root, "routes");
  mkdirSync(routesDir, { recursive: true });
  writeFileSync(join(routesDir, "orphan.tsx"), `export const x = 1;`);
  const manifestPath = join(root, "manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      registeredTemplates: ["DashboardView"],
      routes: [{ id: "/orphan", file: "routes/orphan.tsx" }],
    }),
  );
  const result = scanPublisherWebRoutes(manifestPath);
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((f) => f.rule === "missing-template"));
});

test("direct block composition in route source fails", () => {
  const result = evaluateWebRouteManifestWithSources(
    {
      registeredTemplates: ["MarketingView"],
      routes: [{ id: "/m", template: "MarketingView", file: "routes/m.tsx" }],
    },
    {
      "routes/m.tsx": `import { Hero } from "@clossys/designer/blocks/server";\nexport const Page = () => <Hero id="h" heading="Hi" />;`,
    },
  );
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((f) => f.rule === "direct-block-composition"));
});

test("live fixture passes", () => {
  const result = scanPublisherWebRoutes(join(import.meta.dirname, "fixtures", "publisher-web-routes", "pass.json"), {
    root: join(import.meta.dirname, "fixtures", "publisher-web-routes"),
  });
  assert.equal(result.exitCode, 0, result.findings.map((f) => f.message).join("\n"));
});
