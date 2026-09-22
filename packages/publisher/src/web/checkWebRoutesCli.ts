#!/usr/bin/env node
/**
 * `publisher-web-route-check` — fails when a publishing web route does not
 * name a template from the consumer's registered set, or when a route file
 * composes Designer blocks directly (issue #1103).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { evaluateWebRouteManifestWithSources, type WebRouteManifest } from "./checkWebRoutes.js";

const USAGE = `Usage: publisher-web-route-check <manifest.json> [options]

  manifest.json   JSON manifest listing registeredTemplates and routes (see @clossys/publisher/web).

Options:
  --root <dir>    Root for resolving route file paths in the manifest. Defaults to the manifest's directory.
  --help          Print this message and exit 0.

Exit codes: 0 = satisfied, 1 = at least one finding, 2 = could not run.
`;

class CliInputError extends Error {}

function parseArgs(argv: string[]): { manifestPath: string; root?: string; help: boolean } {
  let manifestPath: string | undefined;
  let root: string | undefined;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--root") {
      root = argv[++i];
      if (!root) throw new CliInputError("--root requires a directory path.");
    } else if (!manifestPath) manifestPath = arg;
    else throw new CliInputError(`Unexpected argument: ${arg}`);
  }
  if (!help && !manifestPath) throw new CliInputError("manifest.json path is required.");
  return { manifestPath: manifestPath ?? "", root, help };
}

function loadManifest(path: string): WebRouteManifest {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new CliInputError(`Manifest not found: ${abs}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(abs, "utf8"));
  } catch (cause) {
    throw new CliInputError(`Could not parse manifest JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (typeof parsed !== "object" || parsed === null) throw new CliInputError("Manifest must be a JSON object.");
  return parsed as WebRouteManifest;
}

function loadSources(root: string, manifest: WebRouteManifest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const route of manifest.routes ?? []) {
    if (!route.file) continue;
    const abs = resolve(root, route.file);
    if (!existsSync(abs)) continue;
    out[route.file] = readFileSync(abs, "utf8");
  }
  return out;
}

function main(): void {
  try {
    const { manifestPath, root, help } = parseArgs(process.argv.slice(2));
    if (help) {
      console.log(USAGE);
      process.exit(0);
    }
    const absManifest = resolve(manifestPath);
    const manifest = loadManifest(absManifest);
    const scanRoot = resolve(root ?? dirname(absManifest));
    const sources = loadSources(scanRoot, manifest);
    const result = evaluateWebRouteManifestWithSources(manifest, sources);
    for (const finding of result.findings) {
      const where = finding.file ? `${finding.file}: ` : "";
      console.error(`${where}${finding.message}`);
    }
    process.exit(result.exitCode);
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`publisher-web-route-check: ${error.message}`);
      console.error(USAGE);
      process.exit(2);
    }
    console.error(`publisher-web-route-check: unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

main();
