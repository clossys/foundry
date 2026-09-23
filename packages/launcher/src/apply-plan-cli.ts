#!/usr/bin/env node
import { isDirectInvocation } from "./cli.js";
import { createNodeHost } from "./host.js";
import { applyEngagementBrief, validateAdvisorPlan, validateEngagementBrief, type AdvisorPlan, type EngagementBrief } from "./apply-plan.js";

export const APPLY_PLAN_USAGE = `Usage: launcher-apply-plan --plan <plan.json> --brief <brief.json> --repo <directory>

Writes clossys/brief.json into <directory> from the given brief, once the
given plan's most recent decision is "approved". Refuses, and writes
nothing, otherwise.

Deterministic mechanics only: this does not decide whether a plan should be
approved (that is Advisor's job) and does not compute the brief's content
(that is @clossys/advisor's EngagementBrief, #1193) -- it validates the
exact shapes recorded on issue #1175 and writes the one file.

Exit codes: 0 = applied, 1 = refused (not approved, or a shape does not
validate), 2 = a given file could not be read as JSON.`;

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

function readJson(readText: (path: string) => string | null, path: string, label: string): unknown {
  const raw = readText(path);
  if (raw === null) throw new ApplyPlanInputError(`${label} could not be read: ${path}`);
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApplyPlanInputError(`${label} is not valid JSON: ${path}`);
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
    planRaw = readJson(host.readText, parsed.planPath as string, "--plan");
    briefRaw = readJson(host.readText, parsed.briefPath as string, "--brief");
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
