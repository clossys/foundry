#!/usr/bin/env node
// check-publisher-web-routes — every publishing web route names a registered template (issue #1103).
//
//   node scripts/check-publisher-web-routes.mjs <manifest.json> [--root <dir>]
//
// Exit 0 = satisfied, 1 = findings, 2 = could not run.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_LITERAL_RE = /\btemplate\s*:\s*["']([^"']+)["']/g;
const DESIGNER_BLOCKS_IMPORT_RE = /@clossys\/designer\/blocks(?:\/|$)/;
const DIRECT_BLOCK_JSX_RE = /<(?:Hero|FeatureGrid|Faq|OrderedStepSequence|StatusList|Stat|PageHeader|SectionHeader|MarketingChapter)\b/;

export function evaluateWebRouteManifest(manifest) {
  const findings = [];
  const known = new Set(manifest.registeredTemplates ?? []);

  for (const route of manifest.routes ?? []) {
    const template = route.template?.trim();
    if (!template) {
      findings.push({
        rule: "missing-template",
        routeId: route.id,
        file: route.file,
        message: `Route "${route.id}" does not name a registered web template.`,
      });
      continue;
    }
    if (!known.has(template)) {
      findings.push({
        rule: "unknown-template",
        routeId: route.id,
        file: route.file,
        message: `Route "${route.id}" names template "${template}", which is not registered.`,
      });
    }
  }

  return { exitCode: findings.length === 0 ? 0 : 1, findings };
}

export function scanRouteSourceForDirectComposition(source, routeId, file) {
  const findings = [];
  if (DESIGNER_BLOCKS_IMPORT_RE.test(source) && DIRECT_BLOCK_JSX_RE.test(source)) {
    findings.push({
      rule: "direct-block-composition",
      routeId,
      file,
      message: `Route "${routeId}" composes Designer blocks directly in a route file.`,
    });
  }
  return findings;
}

export function evaluateWebRouteManifestWithSources(manifest, sources) {
  const base = evaluateWebRouteManifest(manifest);
  const findings = [...base.findings];
  for (const route of manifest.routes ?? []) {
    if (!route.file) continue;
    const source = sources[route.file];
    if (source === undefined) continue;
    findings.push(...scanRouteSourceForDirectComposition(source, route.id, route.file));
  }
  return { exitCode: findings.length === 0 ? 0 : 1, findings };
}

export function scanPublisherWebRoutes(manifestPath, options = {}) {
  const absManifest = resolve(manifestPath);
  if (!existsSync(absManifest)) {
    return { exitCode: 2, findings: [{ rule: "manifest-missing", routeId: manifestPath, message: `Manifest not found: ${absManifest}` }] };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(absManifest, "utf8"));
  } catch (cause) {
    return {
      exitCode: 2,
      findings: [{ rule: "manifest-unreadable", routeId: manifestPath, message: `Could not parse manifest: ${cause instanceof Error ? cause.message : String(cause)}` }],
    };
  }
  const root = resolve(options.root ?? dirname(absManifest));
  const sources = {};
  for (const route of manifest.routes ?? []) {
    if (!route.file) continue;
    const abs = resolve(root, route.file);
    if (!existsSync(abs)) continue;
    sources[route.file] = readFileSync(abs, "utf8");
  }
  return evaluateWebRouteManifestWithSources(manifest, sources);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`Usage: node scripts/check-publisher-web-routes.mjs <manifest.json> [--root <dir>]`);
    process.exit(0);
  }
  let manifestPath;
  let root;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = argv[++i];
    else if (!manifestPath) manifestPath = argv[i];
  }
  if (!manifestPath) {
    console.error("check-publisher-web-routes: manifest path is required.");
    process.exit(2);
  }
  const result = scanPublisherWebRoutes(manifestPath, { root });
  for (const finding of result.findings) console.error(finding.message);
  process.exit(result.exitCode);
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invoked) main();
