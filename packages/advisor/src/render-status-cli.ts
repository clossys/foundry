#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readContractDocument } from "./contract-schema.js";
import { renderAdvisorStatus, validateAdvisorPlan, type AdvisorPlan } from "./status.js";

const USAGE = `Usage: advisor-render-status <plan.json>\n\nRenders clossys/advisor/STATUS.md from an Advisor plan record.\nPrints the rendered markdown to stdout; the caller writes it verbatim.\nExit codes: 0 = rendered, 2 = unreadable or invalid input.`;

export class AdvisorRenderStatusCliInputError extends Error {}

/**
 * Reads caller-owned plan data as strict JSON (#1475) -- invalid UTF-8, a
 * syntax error, or a key repeated in any object is refused -- without
 * treating it as validated against the plan contract.
 */
export function readAdvisorPlanJson(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new AdvisorRenderStatusCliInputError(`plan file "${path}" does not exist`);
  try {
    if (!statSync(resolved).isFile()) throw new AdvisorRenderStatusCliInputError(`plan file "${path}" is not a file`);
    return readContractDocument(readFileSync(resolved));
  } catch (cause) {
    if (cause instanceof AdvisorRenderStatusCliInputError) throw cause;
    throw new AdvisorRenderStatusCliInputError(`plan file "${path}" is unreadable as strict JSON: it ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** Testable CLI dispatcher. Invalid arguments or plan shape throw; the executable maps them to exit 2. */
export function main(argv: readonly string[]): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 1) throw new AdvisorRenderStatusCliInputError("exactly one plan.json file is required");
  const value = readAdvisorPlanJson(argv[0] as string);
  const findings = validateAdvisorPlan(value);
  if (findings.length > 0) {
    throw new AdvisorRenderStatusCliInputError(`plan.json does not match the AdvisorPlan shape: ${findings.map((finding) => finding.message).join("; ")}`);
  }
  console.log(renderAdvisorStatus(value as AdvisorPlan));
  return 0;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (cause) {
    console.error(`advisor-render-status: ${cause instanceof Error ? cause.message : String(cause)}`);
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
