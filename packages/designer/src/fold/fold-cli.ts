#!/usr/bin/env node
/**
 * `designer-fold-check` — fails when a fold measurement JSON violates the
 * pre-auth fold contract. Same three-state exit contract as
 * `designer-hero-css-check` / `designer-token-check`.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkFoldMeasurement,
  formatParseFailure,
  type FoldFinding,
  HERO_MEDIA_KINDS,
  parseFoldMeasurement,
} from "./check-fold.js";

const USAGE = `Usage: designer-fold-check <fold-measurement.json> [--also <fold-measurement.json>]

  fold-measurement.json   JSON evidence from the consumer (or a browser script).

Options:
  --also <file>   Additional viewport measurement, checked independently.
  --help          Print this message and exit 0.

Required fields: viewport { width, height }, h1Clipped (boolean),
overlayIntersectingFold (string[]), primaryCtaCount (number),
heroMediaKind (${HERO_MEDIA_KINDS.join(" | ")}).

Exit codes: 0 = contract satisfied, 1 = at least one finding, 2 = could not run (bad input, missing file, or invalid JSON/schema).
`;

export class CliInputError extends Error {}

interface ParsedArgs {
  measurementFiles: string[];
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const measurementFiles: string[] = [];
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--also") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) {
        throw new CliInputError("--also requires a fold measurement file path");
      }
      measurementFiles.push(value);
      continue;
    }
    if (arg.startsWith("-")) throw new CliInputError(`unknown flag "${arg}"`);
    measurementFiles.push(arg);
  }
  return { measurementFiles, help };
}

function requireFile(label: string, path: string): void {
  if (!existsSync(path)) throw new CliInputError(`${label} "${path}" does not exist`);
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new CliInputError(`cannot read ${label} "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile()) throw new CliInputError(`${label} "${path}" is not a file`);
}

type FileRunResult = { path: string; exitCode: 2 } | { path: string; findings: FoldFinding[] };

function runFile(path: string): FileRunResult {
  const resolved = resolve(path);
  try {
    requireFile("fold-measurement", resolved);
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`designer-fold-check: ${error.message}`);
      return { path: resolved, exitCode: 2 };
    }
    throw error;
  }

  let text: string;
  try {
    text = readFileSync(resolved, "utf8");
  } catch (error) {
    console.error(`Could not read "${resolved}": ${error instanceof Error ? error.message : String(error)}`);
    return { path: resolved, exitCode: 2 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.error(`Could not parse JSON in "${resolved}": ${error instanceof Error ? error.message : String(error)}`);
    return { path: resolved, exitCode: 2 };
  }

  const result = parseFoldMeasurement(parsed);
  if (!result.ok) {
    console.error(`${resolved}: ${formatParseFailure(result.failure)}`);
    return { path: resolved, exitCode: 2 };
  }

  console.log(
    `Fold measurement: ${resolved} (${result.measurement.viewport.width}×${result.measurement.viewport.height}, heroMediaKind=${result.measurement.heroMediaKind})`,
  );
  const findings = checkFoldMeasurement(result.measurement);
  return { path: resolved, findings };
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.measurementFiles.length === 0) {
    throw new CliInputError("fold-measurement.json is required");
  }

  let sawIndeterminate = false;
  const allFindings: { path: string; findings: FoldFinding[] }[] = [];

  for (const file of args.measurementFiles) {
    const result = runFile(file);
    if ("exitCode" in result) {
      sawIndeterminate = true;
      continue;
    }
    if (result.findings.length > 0) {
      allFindings.push(result);
    }
  }

  if (sawIndeterminate) return 2;

  if (allFindings.length === 0) {
    console.log("Fold contract: satisfied.");
    return 0;
  }

  let total = 0;
  for (const { path, findings } of allFindings) {
    total += findings.length;
    console.log(`\n${findings.length} finding(s) in ${path}:`);
    for (const f of findings) console.log(`  [${f.rule}] ${f.message}`);
  }
  console.log(`\n${total} finding(s) total.`);
  return 1;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`designer-fold-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(
        `designer-fold-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
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
