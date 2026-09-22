import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluatePublicationMapInput } from "./check-publication-map.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const passingFixture = {
  routes: ["/marketing"],
  templates: ["MarketingView", "PitchDeck"],
  map: {
    entries: [
      {
        id: "marketing-home",
        template: "MarketingView",
        documentId: "doc-marketing-home",
        location: { kind: "path", path: "/marketing" },
      },
      {
        id: "pitch-opening",
        template: "PitchDeck",
        documentId: "doc-pitch-0",
        location: { kind: "slide", index: 0 },
      },
    ],
  },
};

const failingFixtureUnknownTemplate = {
  routes: ["/marketing"],
  templates: ["MarketingView"],
  map: {
    entries: [
      {
        id: "pitch-opening",
        template: "PitchDeck",
        documentId: "doc-pitch-0",
        location: { kind: "path", path: "/marketing" },
      },
    ],
  },
};

const failingFixtureMissingRoute = {
  routes: ["/marketing", "/pricing"],
  templates: ["MarketingView"],
  map: {
    entries: [
      {
        id: "marketing-home",
        template: "MarketingView",
        documentId: "doc-marketing-home",
        location: { kind: "path", path: "/marketing" },
      },
    ],
  },
};

test("passing fixture: one marketing path and one slide deck entry", async () => {
  const build = spawnSync("npm", ["run", "build", "--workspace=packages/publisher"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const result = await evaluatePublicationMapInput(passingFixture);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.findings, []);
});

test("failing fixture: path names a template that is not registered", async () => {
  const result = await evaluatePublicationMapInput(failingFixtureUnknownTemplate);
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((finding) => finding.rule === "entry-template-unknown"));
});

test("failing fixture: route is absent from the publication map", async () => {
  const result = await evaluatePublicationMapInput(failingFixtureMissingRoute);
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((finding) => finding.rule === "route-missing-from-map"));
});

test("CLI exits 1 on a failing fixture file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "publication-map-"));
  const fixturePath = join(dir, "fixture.json");
  writeFileSync(fixturePath, JSON.stringify(failingFixtureMissingRoute));
  const run = spawnSync(process.execPath, [join(scriptDir, "check-publication-map.mjs"), fixturePath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
});
