#!/usr/bin/env node
/**
 * check-publication-map — every declared host route must appear on the map,
 * and every map entry must name a registered template with a valid location.
 *
 *   node scripts/check-publication-map.mjs <fixture.json>
 *
 * Fixture shape: { routes: string[], templates: string[], map: PublicationMap }
 *
 * Exit 0 when the map is valid and covers every route. Exit 1 on findings.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

async function loadPublisherCore() {
  const distPath = resolve(repoRoot, "packages/publisher/dist/core/publication-map.js");
  return import(pathToFileURL(distPath).href);
}

/**
 * @param {{ routes: string[], templates: string[], map: import("@clossys/publisher/core").PublicationMap }} input
 */
export async function evaluatePublicationMapInput(input, { importer = loadPublisherCore } = {}) {
  const { validatePublicationMap, validatePublicationMapRoutes } = await importer();
  const findings = [...validatePublicationMap(input.map, input.templates), ...validatePublicationMapRoutes(input.routes ?? [], input.map)];
  return { exitCode: findings.length > 0 ? 1 : 0, findings };
}

export async function main(argv = process.argv.slice(2)) {
  const fixturePath = argv[0];
  if (!fixturePath) {
    console.error("usage: node scripts/check-publication-map.mjs <fixture.json>");
    process.exit(2);
  }
  const input = JSON.parse(readFileSync(fixturePath, "utf8"));
  const result = await evaluatePublicationMapInput(input);
  for (const finding of result.findings) {
    console.error(`${finding.rule}: ${finding.message}`);
  }
  process.exit(result.exitCode);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
}
