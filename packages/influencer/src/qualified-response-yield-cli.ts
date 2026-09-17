#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessQualifiedResponseYieldPerThousand } from "./qualified-response-yield.js";

const USAGE = `Usage: influencer-rate-check <assessment.json>\n\nAssess qualified response yield per thousand from consumer-supplied independent observations.\nExit codes: 0 = satisfied, 1 = violated, 2 = indeterminate or unreadable.\ninfluencer-check remains the two-argument CLI and is not this assessment.`;

export class InfluencerRateCliInputError extends Error {}

/** Reads caller-owned assessment evidence without treating it as validated. */
export function readInfluencerAssessmentJson(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new InfluencerRateCliInputError(`assessment file "${path}" does not exist`);
  try {
    if (!statSync(resolved).isFile()) throw new InfluencerRateCliInputError(`assessment file "${path}" is not a file`);
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (cause) {
    if (cause instanceof InfluencerRateCliInputError) throw cause;
    throw new InfluencerRateCliInputError(`assessment file "${path}" is unreadable JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** Testable CLI dispatcher. Invalid arguments throw; the executable maps them to exit 2. */
export function main(argv: readonly string[]): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 1) throw new InfluencerRateCliInputError("exactly one assessment.json file is required");
  const report = assessQualifiedResponseYieldPerThousand(readInfluencerAssessmentJson(argv[0] as string));
  console.log(JSON.stringify(report, null, 2));
  return report.state === "satisfied" ? 0 : report.state === "violated" ? 1 : 2;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (cause) {
    console.error(`influencer-rate-check: ${cause instanceof Error ? cause.message : String(cause)}`);
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
