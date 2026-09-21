#!/usr/bin/env node
/**
 * `publisher-preview` — render every shipped web view against a consumer
 * `brand.css` after Designer’s brand-file coverage check passes. Fixture
 * copy lives in this package; Writer and Strategist are unchanged.
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PREVIEW_GALLERY_FILENAME, validateBrandForPreview, writePreviewGallery } from "./render-preview-gallery.js";

const USAGE = `Usage: publisher-preview <brand.css> <output-directory>

  brand.css            Path to the consumer brand stylesheet. Required.
  output-directory     Directory where gallery.html and copied styles are written. Required.

Options:
  --help         Print this message and exit 0.

Exit codes: 0 = gallery written, 1 = brand file unreadable or coverage findings (no HTML written), 2 = bad arguments or could not run.
`;

export class CliInputError extends Error {}

interface ParsedArgs {
  brandCssFile?: string;
  outputDir?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let brandCssFile: string | undefined;
  let outputDir: string | undefined;
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (brandCssFile === undefined) {
      brandCssFile = arg;
      continue;
    }
    if (outputDir === undefined) {
      outputDir = arg;
      continue;
    }
    throw new CliInputError("too many positional arguments");
  }

  return { brandCssFile, outputDir, help };
}

function requireFile(label: string, path: string): void {
  if (!existsSync(path)) {
    throw new CliInputError(`${label} "${path}" does not exist`);
  }
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new CliInputError(`cannot read ${label} "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile()) {
    throw new CliInputError(`${label} "${path}" is not a file`);
  }
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.brandCssFile || !args.outputDir) {
    throw new CliInputError("brand.css path and output directory are both required");
  }

  const brandPath = resolve(args.brandCssFile);
  requireFile("brand.css", brandPath);

  const validation = validateBrandForPreview(brandPath);
  if (!validation.ok) {
    console.error(`publisher-preview: ${validation.message}`);
    console.error("Refusing to write preview HTML until brand coverage is clean.");
    return 1;
  }

  try {
    const result = writePreviewGallery({ brandCssPath: brandPath, outputDir: resolve(args.outputDir) });
    console.log(`Wrote ${PREVIEW_GALLERY_FILENAME} (${result.entryCount} views) to ${resolve(args.outputDir)}`);
    console.log(`Brand file: ${result.brandCssPath}`);
    return 0;
  } catch (error) {
    console.error(`publisher-preview: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`publisher-preview: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`publisher-preview: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exitCode = 2;
    }
  }
}

function detectMainModule(): boolean {
  const argvPath = process.argv[1];
  if (argvPath === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(modulePath);
  } catch {
    return resolve(argvPath) === modulePath;
  }
}

if (detectMainModule()) {
  run();
}
