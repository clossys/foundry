#!/usr/bin/env node
/**
 * `designer-type-check` — fails when a brand-type JSON record violates the
 * pre-auth type brief. Same three-state exit contract as
 * `designer-fold-check` / `designer-brand-check`.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readBrandCss } from "../tokens/read-brand-css.js";
import {
  checkTypeRecord,
  checkTypeRecordOverlay,
  formatParseFailure,
  parseTypeRecord,
  type TypeRecordFinding,
} from "./check-type-record.js";

const USAGE = `Usage: designer-type-check <brand-type.json> [--overlay <brand.css>]

  brand-type.json   JSON type brief the page must execute (not invent ad hoc).

Options:
  --overlay <file>   Overlay brand CSS; requires a non-empty --font-display declaration.
  --help             Print this message and exit 0.

Exit codes: 0 = contract satisfied, 1 = at least one finding, 2 = could not run (bad input, missing file, invalid JSON/schema, or unparsed overlay CSS).
`;

export class CliInputError extends Error {}

interface ParsedArgs {
  typeRecordFile?: string;
  overlayFile?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let typeRecordFile: string | undefined;
  let overlayFile: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--overlay") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) {
        throw new CliInputError("--overlay requires a brand CSS file path");
      }
      overlayFile = value;
      continue;
    }
    if (arg.startsWith("-")) throw new CliInputError(`unknown flag "${arg}"`);
    if (typeRecordFile === undefined) {
      typeRecordFile = arg;
    } else {
      throw new CliInputError("only one brand-type.json path is allowed");
    }
  }

  return { typeRecordFile, overlayFile, help };
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

function printFindings(path: string, findings: TypeRecordFinding[]): void {
  console.log(`\n${findings.length} finding(s) in ${path}:`);
  for (const f of findings) console.log(`  [${f.rule}] ${f.message}`);
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.typeRecordFile) {
    throw new CliInputError("brand-type.json is required");
  }

  const recordPath = resolve(args.typeRecordFile);
  requireFile("brand-type record", recordPath);

  let text: string;
  try {
    text = readFileSync(recordPath, "utf8");
  } catch (error) {
    console.error(`Could not read "${recordPath}": ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.error(`Could not parse JSON in "${recordPath}": ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const parseResult = parseTypeRecord(parsed);
  if (!parseResult.ok) {
    console.error(`${recordPath}: ${formatParseFailure(parseResult.failure)}`);
    return 2;
  }

  console.log(`Brand-type record: ${recordPath}`);

  const findings = checkTypeRecord(parseResult.raw);

  if (args.overlayFile) {
    const overlayPath = resolve(args.overlayFile);
    requireFile("overlay brand CSS", overlayPath);
    const read = readBrandCss(overlayPath);
    if (!read.complete) {
      console.error(`\nOverlay brand CSS "${overlayPath}" could not be read:`);
      for (const issue of read.issues) console.error(`  [${issue.reason}] ${issue.detail}`);
      return 2;
    }
    if (read.unchecked.length > 0) {
      console.error(`Overlay brand CSS "${overlayPath}" has unparsed regions — refusing to check overlay.`);
      for (const u of read.unchecked) console.error(`  line ${u.line}: ${u.detail}`);
      return 2;
    }
    console.log(`Overlay brand CSS: ${overlayPath}`);
    findings.push(...checkTypeRecordOverlay(read.declarations));
  }

  if (findings.length === 0) {
    console.log("Type record contract: satisfied.");
    return 0;
  }

  printFindings(recordPath, findings);
  console.log(`\n${findings.length} finding(s) total.`);
  return 1;
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
