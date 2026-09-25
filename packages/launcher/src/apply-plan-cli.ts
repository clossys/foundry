#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isDirectInvocation } from "./cli.js";
import { ContractDocumentError, readContractDocument } from "./generated/contract-schema.generated.js";
import { createNodeHost } from "./host.js";
import { applyEngagementBrief, validateAdvisorPlan, validateEngagementBrief, type AdvisorPlan, type EngagementBrief } from "./apply-plan.js";
import {
  MAX_RESPONSE_BYTES,
  REGISTRY_SNAPSHOT_REL,
  RegistrySnapshotError,
  requestedPackageNames,
  takeRegistrySnapshot,
  writeRegistrySnapshot,
  type FetchSnapshotOptions,
} from "./registry-snapshot.js";

export const APPLY_PLAN_USAGE = `Usage: launcher-apply-plan --plan <plan.json> --brief <brief.json> --repo <directory>
       launcher-apply-plan snapshot --request <file> [--out <file>]

The snapshot subcommand is described by launcher-apply-plan snapshot --help.

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

export const SNAPSHOT_USAGE = `Usage: launcher-apply-plan snapshot --request <file> [--out <file>]

Takes the registry snapshot a plan's exact packages are resolved from
(#1178). <file> is the report advisor-package-request prints, saved to a
file: every name in it must be a package in this package's publishing scope,
named once. For each name, in name order, this fetches the package's full
registry document from the registry this package was built for, with no
credential, no .npmrc and no npm CLI, refusing any redirect, any response
over ${MAX_RESPONSE_BYTES / (1024 * 1024)} MiB and any request that takes too long. It records only what
the registry snapshot contract declares, validates the whole snapshot against
that contract, and writes it atomically to --out, by default
${REGISTRY_SNAPSHOT_REL} under the current directory (the hub).

This is the only step of applying a plan that reads the package registry. Messages
name packages and positions only, never a response's content.

Exit codes: 0 = the snapshot was written (or --help was shown), 2 = no snapshot was written
(a usage error, an unreadable or invalid request, or any registry answer
this step cannot record: a transport error, a timeout, a redirect, an
answer other than 200 or 404, an oversize or non-JSON body, or a snapshot
the contract refuses). A package the registry does not have (404) is
recorded as not-found, not refused. On exit 2 an earlier snapshot at the
output path is left untouched, and must not be used.`;

export interface SnapshotCommandOptions extends FetchSnapshotOptions {
  /** The hub root the default --out is relative to, and --request and --out resolve against; the process's cwd by default. */
  readonly cwd?: string;
}

function parseSnapshotArgs(argv: readonly string[]): { help: true } | { help: false; requestPath: string; outPath?: string } {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return { help: true };
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index] as string;
    const value = argv[index + 1];
    if ((name !== "--request" && name !== "--out") || value === undefined || flags.has(name)) {
      throw new RegistrySnapshotError("usage: launcher-apply-plan snapshot --request <file> [--out <file>]");
    }
    flags.set(name, value);
  }
  const requestPath = flags.get("--request");
  if (requestPath === undefined) throw new RegistrySnapshotError("--request is required");
  const outPath = flags.get("--out");
  return outPath === undefined ? { help: false, requestPath } : { help: false, requestPath, outPath };
}

/** Reads the request strictly; a refusal names the rule and a position, never the file's text. */
function readSnapshotRequest(path: string): unknown {
  let bytes: Uint8Array;
  try {
    if (!statSync(path).isFile()) throw new RegistrySnapshotError("the --request file is not a file");
    bytes = readFileSync(path);
  } catch (cause) {
    if (cause instanceof RegistrySnapshotError) throw cause;
    throw new RegistrySnapshotError("the --request file could not be read");
  }
  try {
    return readContractDocument(bytes);
  } catch (cause) {
    if (!(cause instanceof ContractDocumentError)) throw new RegistrySnapshotError("the --request file is not strict JSON");
    const where = cause.position === undefined ? "" : ` at position ${cause.position}`;
    const why = cause.reason === "encoding" ? "is not valid UTF-8" : cause.reason === "repeated-key" ? "repeats a key in one object" : "is not valid JSON";
    throw new RegistrySnapshotError(`the --request file ${why}${where}`);
  }
}

/**
 * The `snapshot` subcommand. Never throws: every refusal prints one line and
 * returns 2, and nothing is written unless the whole snapshot validates.
 */
export async function snapshotMain(argv: readonly string[], options: SnapshotCommandOptions = {}): Promise<number> {
  try {
    const parsed = parseSnapshotArgs(argv);
    if (parsed.help) {
      console.log(SNAPSHOT_USAGE);
      return 0;
    }
    const cwd = options.cwd ?? process.cwd();
    const names = requestedPackageNames(readSnapshotRequest(resolve(cwd, parsed.requestPath)));
    const snapshot = await takeRegistrySnapshot(names, options);
    const out = resolve(cwd, parsed.outPath ?? REGISTRY_SNAPSHOT_REL);
    try {
      writeRegistrySnapshot(out, snapshot);
    } catch (cause) {
      if (cause instanceof RegistrySnapshotError) throw cause;
      throw new RegistrySnapshotError(`the snapshot could not be written to ${out}`);
    }
    const notFound = snapshot.packages.filter((entry) => entry.status === "not-found").length;
    console.log(`wrote ${out}: ${snapshot.packages.length} package(s), ${snapshot.packages.length - notFound} found, ${notFound} not found`);
    return 0;
  } catch (cause) {
    const reason = cause instanceof RegistrySnapshotError ? cause.message : `failed unexpectedly (${cause instanceof Error ? cause.name : typeof cause})`;
    console.error(`launcher-apply-plan snapshot: ${reason}; no snapshot was written`);
    return 2;
  }
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "snapshot") {
    process.exitCode = await snapshotMain(argv.slice(1));
    return;
  }
  try {
    process.exitCode = main(argv, createNodeHost());
  } catch (cause) {
    console.error(`launcher-apply-plan: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 2;
  }
}
if (isDirectInvocation(import.meta.url, process.argv[1])) void run();
