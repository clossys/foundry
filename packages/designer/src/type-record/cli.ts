#!/usr/bin/env node
/**
 * `designer-type-check` — CLI for `checkTypeRecord`. Presentation only: argv,
 * read JSON (and optional brand CSS via `readBrandCss`), run the pure check,
 * print findings, exit 0/1/2 matching satisfied/violated/indeterminate.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readBrandCss } from "../tokens/read-brand-css.js";
import { checkTypeRecord, type TypeRecordCheckResult } from "./check-type-record.js";

const USAGE = `Usage: designer-type-check <record.json> [brand-css-file]

  record.json       Authored type-scale record (schemaVersion 1). Required.
  brand-css-file    Optional brand CSS file; when supplied, ${"--font-display"}
                    must include the record displayFace and ${"--text-display-l"}
                    must meet h1MinimumPx.

Options:
  --help            Print this message and exit 0.

Exit codes: 0 = satisfied, 1 = violated, 2 = indeterminate or could not run.
`;

/** Exported for tests — bad argv maps to exit 2. */
export class CliInputError extends Error {}

interface ParsedArgs {
  recordFile?: string;
  brandCssFile?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let recordFile: string | undefined;
  let brandCssFile: string | undefined;
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (recordFile === undefined) {
      recordFile = arg;
    } else if (brandCssFile === undefined) {
      brandCssFile = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { recordFile, brandCssFile, help };
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

export function readTypeRecordJson(path: string): unknown {
  const resolved = resolve(path);
  requireFile("record file", resolved);
  try {
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new CliInputError(
      `record file "${path}" is unreadable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function printReport(report: TypeRecordCheckResult): void {
  console.log(`State: ${report.state}`);
  if (report.findings.length === 0) {
    console.log("No findings.");
    return;
  }
  console.log(`${report.findings.length} finding(s):`);
  for (const f of report.findings) {
    const where = f.path ? ` (${f.path})` : "";
    console.log(`  [${f.rule}]${where} ${f.message}`);
  }
}

function exitCodeForState(state: TypeRecordCheckResult["state"]): number {
  return state === "satisfied" ? 0 : state === "violated" ? 1 : 2;
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.recordFile) {
    throw new CliInputError("record.json is required");
  }

  const record = readTypeRecordJson(args.recordFile);

  let brandDeclarations: Record<string, string> | undefined;
  if (args.brandCssFile) {
    const cssPath = resolve(args.brandCssFile);
    requireFile("brand-css-file", cssPath);
    const read = readBrandCss(cssPath);
    if (!read.complete) {
      console.error("Brand CSS file could not be read:");
      for (const issue of read.issues) console.error(`  [${issue.reason}] ${issue.detail}`);
      return 2;
    }
    if (read.unchecked.length > 0) {
      console.error(`${read.unchecked.length} region(s) of the brand CSS file could not be parsed.`);
      for (const u of read.unchecked) console.error(`  line ${u.line}: ${u.detail}`);
      return 2;
    }
    brandDeclarations = read.declarations;
  }

  const report = checkTypeRecord(record, { brandDeclarations });
  printReport(report);
  return exitCodeForState(report.state);
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`designer-type-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(
        `designer-type-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
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
