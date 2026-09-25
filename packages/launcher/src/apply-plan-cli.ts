#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isDirectInvocation } from "./cli.js";
import { readContractDocument } from "./generated/contract-schema.generated.js";
import { createNodeHost } from "./host.js";
import { applyEngagementBrief, validateAdvisorPlan, validateEngagementBrief, type AdvisorPlan, type EngagementBrief } from "./apply-plan.js";

export const APPLY_PLAN_USAGE = `Usage: launcher-apply-plan --plan <plan.json> --brief <brief.json> --repo <directory>

Writes clossys/brief.json into <directory> from the given brief, once the
given plan's most recent decision is "approved". Refuses, and writes
nothing, otherwise. This is the brief-only path: it does not check what an
approval binds, so it accepts an approval with or without a subjectDigest.

Deterministic mechanics only: this does not decide whether a plan should be
approved (that is Advisor's job) and does not compute the brief's content
(that is @clossys/advisor's EngagementBrief) -- it validates both files
against the same plan and brief contracts Advisor uses, refusing any field
those contracts do not declare, writes the one file, and prints the plan's
canonical digest.

Exit codes: 0 = applied, 1 = refused (not approved, or a shape does not
validate), 2 = a given file could not be read as strict JSON (unreadable,
not valid UTF-8, not valid JSON, or an object repeats a key).`;

export class ApplyPlanInputError extends Error {}

function parseArgs(argv: readonly string[]): { help: boolean; planPath?: string; briefPath?: string; repoDirectory?: string } {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return { help: true };
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if ((name !== "--plan" && name !== "--brief" && name !== "--repo") || value === undefined) {
      throw new ApplyPlanInputError("usage: launcher-apply-plan --plan <path> --brief <path> --repo <directory>");
    }
    flags.set(name, value);
  }
  const planPath = flags.get("--plan");
  const briefPath = flags.get("--brief");
  const repoDirectory = flags.get("--repo");
  if (planPath === undefined || briefPath === undefined || repoDirectory === undefined) {
    throw new ApplyPlanInputError("--plan, --brief, and --repo are all required");
  }
  return { help: false, planPath, briefPath, repoDirectory };
}

/**
 * Reads a plan or brief file as strict JSON (#1475): invalid UTF-8, a JSON
 * syntax error, or an object that repeats a key at any depth is refused, so
 * the value validated and digested is exactly the one a reader of the file
 * sees.
 */
function readJson(path: string, label: string): unknown {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new ApplyPlanInputError(`${label} could not be read: ${path}`);
  }
  try {
    return readContractDocument(bytes);
  } catch (cause) {
    throw new ApplyPlanInputError(`${label} ${cause instanceof Error ? cause.message : String(cause)}: ${path}`);
  }
}

export function main(argv: readonly string[], host: ReturnType<typeof createNodeHost>): number {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(APPLY_PLAN_USAGE);
    return 0;
  }
  let planRaw: unknown;
  let briefRaw: unknown;
  try {
    planRaw = readJson(parsed.planPath as string, "--plan");
    briefRaw = readJson(parsed.briefPath as string, "--brief");
  } catch (cause) {
    console.error(`launcher-apply-plan: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 2;
  }
  const planValidation = validateAdvisorPlan(planRaw);
  if (!planValidation.valid) {
    console.error(`launcher-apply-plan: --plan does not validate: ${planValidation.reason}`);
    return 1;
  }
  const briefValidation = validateEngagementBrief(briefRaw);
  if (!briefValidation.valid) {
    console.error(`launcher-apply-plan: --brief does not validate: ${briefValidation.reason}`);
    return 1;
  }
  const result = applyEngagementBrief(host, parsed.repoDirectory as string, planRaw as AdvisorPlan, briefRaw as EngagementBrief, "clossys/brief.json");
  if (result.state === "refused") {
    console.error(`launcher-apply-plan: refused -- ${result.reason}`);
    return 1;
  }
  console.log(`wrote ${result.path}`);
  console.log(`plan digest ${result.planDigest}`);
  return 0;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2), createNodeHost());
  } catch (cause) {
    console.error(`launcher-apply-plan: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 2;
  }
}
if (isDirectInvocation(import.meta.url, process.argv[1])) run();
