#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { StarterInputError, decide, decisionExitCode, headInstallExitCode, proveHeadInstall } from "./node-runtime.js";

const USAGE = `Usage: foundry-starter decide <request.json> <snapshot-directory> <trusted-event.json> <install-receipt.json> [--report <report.json>]
       foundry-starter prove-head <request.json> <head-directory> <trusted-event.json> <staging-directory> [--report <report.json>]

Runs only from a protected base after the caller's fixed npm or pnpm install.
The request has no command, shell fragment, arbitrary arguments, or CLI path:
Advisor is invoked at a runner-supplied current instant and the target is one
manifest-derived bin with one captured JSON input.

Exit codes after Starter begins: 0 = satisfied, 1 = a known readiness/target
violation, 2 = malformed, missing, stale, untrusted, skipped, or indeterminate
evidence. A failed initial native install is a pre-runtime workflow failure.

prove-head reads the pull-request head's request, package.json, and
package-lock.json as data from a trusted checkout of the authenticated head
commit, runs the fixed npm ci --ignore-scripts in a fresh staging directory
under a hardened environment, and checks the head's exact identities without
executing anything it installed. Its report is separate from decide's.`;

export function main(argv: readonly string[]): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) { console.log(USAGE); return 0; }
  if (argv.length !== 5 && argv.length !== 7) throw new StarterInputError("decide requires request, snapshot directory, trusted event, install receipt, and optional --report path; prove-head requires request, head directory, trusted event, staging directory, and optional --report path");
  if (argv[0] !== "decide" && argv[0] !== "prove-head") throw new StarterInputError("the only subcommands are decide and prove-head");
  let reportPath: string | undefined;
  if (argv.length === 7) { if (argv[5] !== "--report" || !argv[6]) throw new StarterInputError("optional report form is --report <report.json>"); reportPath = argv[6]; }
  if (argv[0] === "prove-head") {
    const headReport = proveHeadInstall(argv[1] as string, argv[2] as string, argv[3] as string, argv[4] as string, reportPath, { invokedPath: process.argv[1] });
    console.log(JSON.stringify(headReport, null, 2));
    return headInstallExitCode(headReport);
  }
  const report = decide(argv[1] as string, argv[2] as string, argv[3] as string, argv[4] as string, reportPath, process.argv[1]);
  console.log(JSON.stringify(report, null, 2));
  return decisionExitCode(report);
}

function run(): void { try { process.exitCode = main(process.argv.slice(2)); } catch (cause) { console.error(`starter: ${cause instanceof Error ? cause.message : String(cause)}`); process.exitCode = 2; } }
/** Resolves an npm/POSIX bin symlink before deciding whether this module is the entrypoint. */
export function isDirectInvocation(moduleUrl: string, argvPath: string | undefined): boolean { if (argvPath === undefined) return false; try { return realpathSync(new URL(moduleUrl)) === realpathSync(resolve(argvPath)); } catch { return false; } }
if (isDirectInvocation(import.meta.url, process.argv[1])) run();
