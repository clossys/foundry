/** CLI for the first-day onboarding workflow. Presentation only: every decision lives in the pure modules. */
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runFirstDayOnboarding } from "./index.js";
import { onboardingExitCode } from "./join.js";
import { proposeInstalledPositionLedger } from "./ledger.js";
import { activeRolesFromContract } from "./index.js";

const USAGE = `Usage: foundry-onboarding-run <request.json> <install-root> <evidence-dir> [--report <path>] [--ledger <path>]

Discovers and invokes each selected role's OWN assessment surface and prints the join.
It authors no assessment. A selected role with no assessment surface is reported as a
gap and makes the run indeterminate; it is never silently skipped.

Exit codes: 0 = satisfied, 1 = a role's own assessment reported a violation,
            2 = indeterminate, unassessed, or could not run.`;

function readJson(path: string): unknown { return JSON.parse(readFileSync(resolve(path), "utf8")); }

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) { console.log(USAGE); return 0; }
  const positional = argv.filter((value, index) => !value.startsWith("--") && !(index > 0 && (argv[index - 1] === "--report" || argv[index - 1] === "--ledger")));
  if (positional.length !== 3) { console.error(USAGE); return 2; }
  try {
    const run = runFirstDayOnboarding(readJson(positional[0] as string), { installRoot: positional[1] as string, evidenceDirectory: positional[2] as string });
    const proposal = proposeInstalledPositionLedger(run, activeRolesFromContract());
    const reportPath = option(argv, "--report");
    if (reportPath !== undefined) writeFileSync(resolve(reportPath), `${JSON.stringify(run, null, 2)}\n`);
    const ledgerPath = option(argv, "--ledger");
    if (ledgerPath !== undefined && proposal.ledger !== null) writeFileSync(resolve(ledgerPath), `${JSON.stringify(proposal.ledger, null, 2)}\n`);
    console.log(JSON.stringify({ run, ledgerProposed: proposal.ledger !== null, ledgerFindings: proposal.findings }, null, 2));
    return onboardingExitCode(run.state);
  } catch (error) {
    console.error(`foundry-onboarding-run: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
