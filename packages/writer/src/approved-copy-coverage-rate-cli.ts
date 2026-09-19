#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessApprovedCopyCoverageRate } from "./approved-copy-coverage-rate.js";

const USAGE = `Usage: writer-rate-check <assessment.json>\n\nAssess approved copy coverage rate from consumer-supplied independent observations.\nExit codes: 0 = satisfied, 1 = violated, 2 = indeterminate or unreadable.\nwriter-check remains the multi-mode CLI and is not this assessment.`;

export class WriterRateCliInputError extends Error {}

/** Reads caller-owned assessment evidence without treating it as validated. */
export function readWriterAssessmentJson(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new WriterRateCliInputError(`assessment file "${path}" does not exist`);
  try {
    if (!statSync(resolved).isFile()) throw new WriterRateCliInputError(`assessment file "${path}" is not a file`);
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (cause) {
    if (cause instanceof WriterRateCliInputError) throw cause;
    throw new WriterRateCliInputError(`assessment file "${path}" is unreadable JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** Testable CLI dispatcher. Invalid arguments throw; the executable maps them to exit 2. */
export function main(argv: readonly string[]): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 1) throw new WriterRateCliInputError("exactly one assessment.json file is required");
  const report = assessApprovedCopyCoverageRate(readWriterAssessmentJson(argv[0] as string));
  console.log(JSON.stringify(report, null, 2));
  return report.state === "satisfied" ? 0 : report.state === "violated" ? 1 : 2;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (cause) {
    console.error(`writer-rate-check: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 2;
  }
}

/** Resolves an npm/POSIX bin symlink before deciding whether this module is the entrypoint. */
export function isDirectInvocation(moduleUrl: string, argvPath: string | undefined): boolean {
  if (argvPath === undefined) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argvPath));
  } catch {
    return false;
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) run();
