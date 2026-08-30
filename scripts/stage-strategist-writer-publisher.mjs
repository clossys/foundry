#!/usr/bin/env node
/**
 * Reproducible author-side staging evidence for the expression quartet:
 * strategist, writer, designer, and publisher.
 *
 * Each case invokes the package's compiled CLI through its dist path, first
 * on a genuine consumer-shaped violation (exit 1), then on a clean control
 * (exit 0). Fixtures are temporary: they prove the executable artifacts
 * discriminate without adding product claims to Foundry's documentation.
 *
 * This is fixture evidence only. It does not wire strategist or writer to a
 * real Foundry subject (#500 and #501), and it does not make publisher's
 * hand-authored ledger independent of the publish path (#502). Those remain
 * separate programme work; consumer adoption remains #503.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stageDir = mkdtempSync(join(tmpdir(), "foundry-expression-role-stage-"));

function fixtureDir(name) {
  const path = join(stageDir, name);
  mkdirSync(path, { recursive: true });
  return path;
}

function writeJson(directory, name, value) {
  const path = join(directory, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function writeText(directory, name, value) {
  const path = join(directory, name);
  writeFileSync(path, value);
  return path;
}

function run(label, cli, args, expectedStatus, requiredOutput) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error) throw result.error;
  if (result.status !== expectedStatus) throw new Error(`${label}: expected exit ${expectedStatus}, got ${result.status}\n${output}`);
  if (!output.includes(requiredOutput)) throw new Error(`${label}: expected output containing ${JSON.stringify(requiredOutput)}\n${output}`);
  console.log(`${label}: exit ${result.status} (${requiredOutput})`);
}

try {
  const strategistCli = join(repoRoot, "packages/strategist/dist/cli.js");
  const strategistStrategy = fixtureDir("strategist-strategy");
  writeJson(strategistStrategy, "facts.json", [{ key: "active-customers", label: "Active customers", value: 3, source: "catalogue", lastUpdatedAt: "2026-08-22", aliases: ["3 customers"] }]);
  const strategistRed = fixtureDir("strategist-red");
  const strategistControl = fixtureDir("strategist-control");
  writeText(strategistRed, "announcement.md", "We serve 9 customers.\n");
  writeText(strategistControl, "announcement.md", "We serve 3 customers.\n");
  run("strategist red", strategistCli, [strategistStrategy, strategistRed], 1, "finding(s)");
  run("strategist control", strategistCli, [strategistStrategy, strategistControl], 0, "No findings.");

  const writerCli = join(repoRoot, "packages/writer/dist/cli.js");
  const writerRecord = writeJson(fixtureDir("writer-record"), "copy.json", { id: "writer-stage", entries: [{ id: "empty.no-results", text: "No results", context: "Empty result state" }] });
  const writerRed = fixtureDir("writer-red");
  const writerControl = fixtureDir("writer-control");
  writeText(writerRed, "View.ts", 'export const message = "Unregistered result";\n');
  writeText(writerControl, "View.ts", 'export const message = "No results";\n');
  run("writer red", writerCli, [writerRecord, writerRed], 1, "finding(s)");
  run("writer control", writerCli, [writerRecord, writerControl], 0, "No findings.");

  const designerCli = join(repoRoot, "packages/designer/dist/tokens/contrast-cli.js");
  const designerTokens = readFileSync(join(repoRoot, "packages/designer/styles/tokens.css"), "utf8");
  const designerDir = fixtureDir("designer-contrast");
  const designerRed = writeText(
    designerDir,
    "tokens-red.css",
    designerTokens.replace(/--color-ink-primary:\s*oklch\([^;]+;/, "--color-ink-primary: oklch(0.9702 0 0);"),
  );
  const designerIndeterminate = writeText(designerDir, "tokens-indeterminate.css", ":root { --color-ink-primary: invalid; }\n");
  run("designer red", designerCli, [designerRed], 1, "finding(s)");
  run("designer control", designerCli, [], 0, "[dark] No findings.");
  run("designer indeterminate", designerCli, [designerIndeterminate], 2, "could NOT be evaluated");

  const publisherMediaCli = join(repoRoot, "packages/publisher/dist/media/cli.js");
  const mediaDir = fixtureDir("publisher-media");
  const assetRecord = writeJson(mediaDir, "assets.json", { id: "publisher-stage", entries: [{ id: "marketing.hero-image", type: "image", src: "/assets/hero.png", width: 1600, height: 900, alt: "Abstract illustration", licence: "CC-BY-4.0" }] });
  const mediaRed = writeJson(mediaDir, "referenced-red.json", ["marketing.missing-image"]);
  const mediaControl = writeJson(mediaDir, "referenced-control.json", ["marketing.hero-image"]);
  run("publisher media red", publisherMediaCli, [assetRecord, mediaRed], 1, "finding(s)");
  run("publisher media control", publisherMediaCli, [assetRecord, mediaControl], 0, "No findings.");

  const publisherRecordCli = join(repoRoot, "packages/publisher/dist/record/cli.js");
  const recordDir = fixtureDir("publisher-record");
  const ledger = writeJson(recordDir, "ledger.json", [{ id: "publisher-stage-entry", publishedAt: "2026-08-22T00:00:00.000Z", channel: "web", strategyRevision: "stage-1", factCitations: [{ factRef: "published-items", valueBinding: { policyId: "published-items", digestAlgorithm: "sha256", digest: "4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce" } }] }]);
  const recordRed = writeJson(recordDir, "current-red.json", { "published-items": 4 });
  const recordControl = writeJson(recordDir, "current-control.json", { "published-items": 3 });
  run("publisher record red", publisherRecordCli, [ledger, recordRed], 1, "finding(s)");
  run("publisher record control", publisherRecordCli, [ledger, recordControl], 0, "No findings.");

  console.log("Expression quartet fixture evidence: all deliberate reds and controls behaved as expected, and Designer's incomplete registry stayed indeterminate.");
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
