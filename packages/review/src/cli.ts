#!/usr/bin/env node
/** A small CLI around the pure review-evidence validator. */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateReviewEvidence } from "./validate.js";
import type { ReviewFinding } from "./types.js";

const USAGE = `Usage: review-check <evidence-file> <policy-file>

  evidence-file  Path to one JSON file containing review evidence. Required.
  policy-file    Path to one JSON file containing review requirements. Required.

Options:
  --help         Print this message and exit 0.

Exit codes: 0 = valid evidence, 1 = validation findings, 2 = could not run (bad arguments, unreadable input, or malformed JSON).
`;

/** An argument or input-read failure, mapped to exit code 2 by the installed CLI. */
export class CliInputError extends Error {}

export interface ReviewCheckReport {
  readonly ok: boolean;
  readonly findings: readonly ReviewFinding[];
}

function parseArgs(argv: readonly string[]): { evidenceFile?: string; policyFile?: string; help: boolean } {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  if (argv.length !== 2) throw new CliInputError("expected an evidence-file and a policy-file");
  const [evidenceFile, policyFile] = argv;
  if (evidenceFile === undefined || policyFile === undefined || evidenceFile.startsWith("-") || policyFile.startsWith("-")) {
    throw new CliInputError("unknown option or missing file path");
  }
  return { evidenceFile, policyFile, help: false };
}

function readJson(path: string, label: string): unknown {
  if (!existsSync(path)) throw new CliInputError(`${label} ${JSON.stringify(path)} does not exist`);
  try {
    if (!statSync(path).isFile()) throw new CliInputError(`${label} ${JSON.stringify(path)} is not a file`);
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof CliInputError) throw error;
    throw new CliInputError(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Runs without global arguments so the full exit-code contract is testable. */
export function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const evidence = readJson(resolve(args.evidenceFile as string), "evidence-file");
  const policy = readJson(resolve(args.policyFile as string), "policy-file");
  const findings = validateReviewEvidence(evidence, policy);
  console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2));
  return findings.length === 0 ? 0 : 1;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`review-check: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

/** Avoid running while this module is imported by a test or another program. */
function detectMainModule(): boolean {
  const argvPath = process.argv[1];
  if (argvPath === undefined) return false;
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (detectMainModule()) run();
