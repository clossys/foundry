#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { AdvisorCliInputError, isDirectInvocation, readAdvisorAssessmentJson } from "./cli.js";
import { assessAdvisorExecutionReadiness } from "./execution-readiness.js";

const USAGE = `Usage: advisor-execution-readiness <assessment.json> <current-as-of>\n\nRe-derive whether execution is authorized at the runner-supplied instant.\nExit codes: 0 = ready, 1 = violated authorization or readiness, 2 = indeterminate, malformed, or unreadable.`;

/** Testable execution-readiness CLI dispatcher. Invalid arguments throw; the executable maps them to exit 2. */
export function main(argv: readonly string[]): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) { console.log(USAGE); return 0; }
  if (argv.length !== 2) throw new AdvisorCliInputError("assessment.json and current-as-of are required");
  const report = assessAdvisorExecutionReadiness(readAdvisorAssessmentJson(argv[0] as string), argv[1] as string);
  console.log(JSON.stringify(report, null, 2));
  return report.state === "satisfied" ? 0 : report.state === "violated" ? 1 : 2;
}

function run(): void { try { process.exitCode = main(process.argv.slice(2)); } catch (cause) { console.error(`advisor-execution-readiness: ${cause instanceof Error ? cause.message : String(cause)}`); process.exitCode = 2; } }
if (isDirectInvocation(import.meta.url, process.argv[1])) run();
