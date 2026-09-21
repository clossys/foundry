#!/usr/bin/env node
/**
 * `designer-mark-check` — CLI for `checkBrandMark`. Same three-state exit
 * contract as `designer-brand-check` and `designer-type-check`.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBrandMark, type BrandMarkFinding } from "./check-brand-mark.js";

const USAGE = `Usage: designer-mark-check <brand-mark.tsx>

  brand-mark.tsx   Consumer mark module (copy of @clossys/designer/mark-template.tsx). Required.

Options:
  --help           Print this message and exit 0.

Exit codes: 0 = clean, 1 = at least one finding, 2 = could not run (bad input or unreadable file).
`;

export class CliInputError extends Error {}

function parseArgs(argv: string[]): { markFile?: string; help: boolean } {
  let markFile: string | undefined;
  let help = false;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) throw new CliInputError(`unknown flag "${arg}"`);
    if (markFile === undefined) markFile = arg;
    else throw new CliInputError("only one brand-mark.tsx path is allowed");
  }
  return { markFile, help };
}

function requireFile(path: string): void {
  if (!existsSync(path)) throw new CliInputError(`brand mark file "${path}" does not exist`);
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new CliInputError(
      `cannot read brand mark file "${path}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!stat.isFile()) throw new CliInputError(`brand mark file "${path}" is not a file`);
}

function printFindings(path: string, findings: BrandMarkFinding[]): void {
  console.log(`\n${findings.length} finding(s) in ${path}:`);
  for (const f of findings) console.log(`  [${f.rule}] ${f.message}`);
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.markFile) throw new CliInputError("brand-mark.tsx is required");

  const markPath = resolve(args.markFile);
  requireFile(markPath);

  let source: string;
  try {
    source = readFileSync(markPath, "utf8");
  } catch (error) {
    throw new CliInputError(
      `cannot read brand mark file "${markPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const report = checkBrandMark(markPath, source);
  console.log(`Brand mark file: ${report.path}`);
  console.log(`Lockup authored: ${report.lockupAuthored ? "yes" : "no"}`);

  if (report.findings.length > 0) {
    printFindings(report.path, report.findings);
    return 1;
  }

  console.log("No findings.");
  return 0;
}

const isMain =
  process.argv[1] !== undefined &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`designer-mark-check: ${error.message}`);
      console.error(USAGE);
      process.exitCode = 2;
    } else {
      console.error(
        `designer-mark-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      process.exitCode = 2;
    }
  }
}
