#!/usr/bin/env node
import { isDirectInvocation } from "./cli.js";
import { createNodeHost } from "./host.js";
import { renderDoctorReport, runDoctorChecks } from "./doctor.js";

export const DOCTOR_USAGE = `Usage: launcher-doctor

Read-only. Checks the prerequisites a client needs before the hub exists:
git, the GitHub command-line tool, whether you are signed in, Node.js, and
npm. Reports the first thing that is missing, in plain language, with the
next action to take -- never a dump of everything at once.

Exit codes: 0 = ready, 2 = at least one prerequisite is missing.`;

export function main(argv: readonly string[]): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(DOCTOR_USAGE);
    return 0;
  }
  if (argv.length !== 0) {
    console.error("launcher-doctor: takes no arguments");
    return 2;
  }
  const host = createNodeHost();
  const report = runDoctorChecks(host);
  console.log(renderDoctorReport(report));
  return report.allSatisfied ? 0 : 2;
}

function run(): void {
  process.exitCode = main(process.argv.slice(2));
}
if (isDirectInvocation(import.meta.url, process.argv[1])) run();
