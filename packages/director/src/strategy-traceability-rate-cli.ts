/**
 * The strategy traceability rate command. Director ships no executable: the clossys
 * CLI runs it as `clossys director rate-check`. The assessment file is caller-owned
 * evidence named on the command line, not the strategy store.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { assessStrategyTraceabilityRate } from "./strategy-traceability-rate.js";

const USAGE = `Usage: clossys director rate-check <assessment.json>\n\nAssess strategy traceability rate from consumer-supplied independent observations.\nExit codes: 0 = satisfied, 1 = violated, 2 = indeterminate or unreadable.\nclossys director check remains the multi-mode command and is not this assessment.`;

export class DirectorRateCliInputError extends Error {}

/** Reads caller-owned assessment evidence without treating it as validated. */
export function readDirectorAssessmentJson(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new DirectorRateCliInputError(`assessment file "${path}" does not exist`);
  try {
    if (!statSync(resolved).isFile()) throw new DirectorRateCliInputError(`assessment file "${path}" is not a file`);
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (cause) {
    if (cause instanceof DirectorRateCliInputError) throw cause;
    throw new DirectorRateCliInputError(`assessment file "${path}" is unreadable JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** Testable CLI dispatcher. Invalid arguments throw; the executable maps them to exit 2. */
export function main(argv: readonly string[]): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 1) throw new DirectorRateCliInputError("exactly one assessment.json file is required");
  const report = assessStrategyTraceabilityRate(readDirectorAssessmentJson(argv[0] as string));
  console.log(JSON.stringify(report, null, 2));
  return report.state === "satisfied" ? 0 : report.state === "violated" ? 1 : 2;
}

/** The argv-to-exit-code contract: argument and input errors print and map to 2. */
export function runDirectorRateCli(argv: readonly string[]): number {
  try {
    return main(argv);
  } catch (cause) {
    console.error(`clossys director rate-check: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 2;
  }
}
