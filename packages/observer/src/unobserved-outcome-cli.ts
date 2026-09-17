#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessUnobservedOutcomeRate } from "./unobserved-outcome-rate.js";

const USAGE = `Usage: observer-check <assessment.json>\n\nAssess unobserved outcome rate from consumer-supplied independent observations.\nExit codes: 0 = satisfied, 1 = violated, 2 = indeterminate or unreadable.`;

export class ObserverCliInputError extends Error {}

/** Reads caller-owned assessment evidence without treating it as validated. */
export function readObserverAssessmentJson(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new ObserverCliInputError(`assessment file "${path}" does not exist`);
  try {
    if (!statSync(resolved).isFile()) throw new ObserverCliInputError(`assessment file "${path}" is not a file`);
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (cause) {
    if (cause instanceof ObserverCliInputError) throw cause;
    throw new ObserverCliInputError(`assessment file "${path}" is unreadable JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** Testable CLI dispatcher. Invalid arguments throw; the executable maps them to exit 2. */
export function main(argv: readonly string[]): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 1) throw new ObserverCliInputError("exactly one assessment.json file is required");
  const report = assessUnobservedOutcomeRate(readObserverAssessmentJson(argv[0] as string));
  console.log(JSON.stringify(report, null, 2));
  return report.state === "satisfied" ? 0 : report.state === "violated" ? 1 : 2;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (cause) {
    console.error(`observer-check: ${cause instanceof Error ? cause.message : String(cause)}`);
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
