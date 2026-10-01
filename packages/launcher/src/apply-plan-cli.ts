#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
import { listStoredChangeSets } from "./apply-store.js";
import { planMain } from "./plan-command.js";
import { BODY_USAGE, BodyUsageError, bodyRepository, parseBodyArgs } from "./body-command.js";
import { materializeRepository, verifyRepository, type ApplyStepResult } from "./materialize.js";
import { formatStatus, statusRepository, type StatusPorts } from "./status.js";
import type { ReadinessRunner } from "./admission.js";
import type { RepositoryChangeSet } from "./change-set-contract.js";
import type { LockfileSpawn } from "./lockfile-regen.js";

export const APPLY_PLAN_USAGE = `Usage: launcher-apply-plan --plan <plan.json> --brief <brief.json> --repo <directory>
       launcher-apply-plan plan [--help]
       launcher-apply-plan materialize --repo <id>
       launcher-apply-plan verify --repo <id>
       launcher-apply-plan status --repo <id>
       launcher-apply-plan body --repo <id> --task-record <n> [--supersedes <n>]...
       launcher-apply-plan snapshot --request <file> [--out <file>]

The plan subcommand is described by launcher-apply-plan plan --help, and the
snapshot subcommand by launcher-apply-plan snapshot --help.

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
registry credential, no .npmrc and no npm CLI, refusing any redirect, any response
over ${MAX_RESPONSE_BYTES / (1024 * 1024)} MiB and any request that takes too long. It records only what
the registry snapshot contract declares, validates the whole snapshot against
that contract, and writes it atomically to --out, by default
${REGISTRY_SNAPSHOT_REL} under the current directory (the hub).

This is the only step of applying a plan that reads the package registry. A
message names a package by its position in the request, names[<n>], never by
its name, and never quotes the request or a response.

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

export interface ApplyCommandOptions {
  readonly cwd?: string;
  readonly clone?: string;
  readonly set?: RepositoryChangeSet;
  readonly texts?: Readonly<Record<string, string>>;
  readonly heldChangeSets?: readonly RepositoryChangeSet[];
  readonly spawn?: LockfileSpawn;
  /** The instant the execution authorization is judged at; the wall clock by default. */
  readonly now?: () => Date;
  readonly toolVersion?: string | null;
  /** Runs the hub's advisor-execution-readiness; the hub's own installed executable by default. */
  readonly runReadiness?: ReadinessRunner;
  /** The read-only GitHub questions `status` asks; read-only `gh api` calls by default. */
  readonly statusPorts?: StatusPorts;
}

const REPO_ID_SHAPE = /^[^/]+\/[^/]+$/u;

function parseRepoSubcommand(argv: readonly string[], label: string): { help: true } | { help: false; id: string } {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return { help: true };
  if (argv.length !== 2 || argv[0] !== "--repo") throw new ApplyPlanInputError(`usage: launcher-apply-plan ${label} --repo <id>`);
  const id = argv[1]!;
  const slash = id.indexOf("/");
  const name = slash === -1 ? "" : id.slice(slash + 1);
  if (!REPO_ID_SHAPE.test(id) || name === "." || name === "..") throw new ApplyPlanInputError(`usage: launcher-apply-plan ${label} --repo <id>`);
  return { help: false, id };
}

function spawnGit(cwd: string, args: string[]): string | null {
  const run = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if ((run.status ?? 1) !== 0) return null;
  return (run.stdout ?? "").trim();
}

function resolveApplyInputs(
  id: string,
  options: ApplyCommandOptions,
): { hub: string; clone: string; set: RepositoryChangeSet; held: RepositoryChangeSet[]; texts: Readonly<Record<string, string>> } | ApplyStepResult {
  const hub = options.cwd ?? process.cwd();
  if (options.set !== undefined && options.set.repository.id !== id) {
    return { exitCode: 2, verdict: "indeterminate", reason: "change-set-absent" };
  }
  let held: RepositoryChangeSet[] = [];
  try {
    held = listStoredChangeSets(realpathSync(hub));
  } catch {
    held = [];
  }
  if (options.heldChangeSets !== undefined) held = [...options.heldChangeSets];
  let set = options.set;
  if (set === undefined) {
    const matches = held.filter((entry) => entry.repository.id === id);
    if (matches.length === 0) return { exitCode: 2, verdict: "indeterminate", reason: "change-set-absent" };
    if (matches.length === 1) {
      set = matches[0]!;
    } else {
      const clonePath = options.clone ?? resolve(dirname(realpathSync(hub)), id.slice(id.indexOf("/") + 1));
      let root: string;
      try {
        root = realpathSync(clonePath);
      } catch {
        return { exitCode: 2, verdict: "indeterminate", reason: "change-set-absent" };
      }
      const branch = matches[0]!.repository.defaultBranch;
      const tip = spawnGit(root, ["rev-parse", `refs/heads/${branch}`]);
      if (tip === null) return { exitCode: 2, verdict: "indeterminate", reason: "change-set-absent" };
      const filtered = matches.filter((entry) => entry.repository.baseCommit === tip);
      if (filtered.length !== 1) return { exitCode: 2, verdict: "indeterminate", reason: "change-set-absent" };
      set = filtered[0]!;
    }
  }
  const clone = options.clone ?? resolve(dirname(realpathSync(hub)), id.slice(id.indexOf("/") + 1));
  const storedTexts =
    set.texts === undefined ? {} : Object.fromEntries(set.texts.map((row) => [row.path, row.text] as const));
  return { hub, clone, set, held, texts: options.texts ?? storedTexts };
}

const MATERIALIZE_HELP = `Usage: launcher-apply-plan materialize --repo <id>

Writes a stored repository change set into the repository's local clone.

Refuses, and writes nothing, unless the plan committed at the hub's HEAD
approves a bundle that holds the change set, or the change set is an apply set
admitted under the one-approval rule: it follows the approved setup set and
changes nothing that approval did not already cover. When the change set has
package acts, the execution authorization in the hub's committed assessment
must also be current at the time of the run. The approval a change set's
ledger records is decided from the hub alone; it is never taken from an
option or defaulted.`;
const VERIFY_HELP = `Usage: launcher-apply-plan verify --repo <id>

Reports whether the repository's local clone matches its stored change set.
Verify re-checks everything materialize checks before writing, including the
committed approval and, for a change set with package acts, that the execution
authorization is still current at the time of the run: a clone whose approval
was withdrawn or whose authorization expired no longer verifies.`;

const STATUS_HELP = `Usage: launcher-apply-plan status --repo <id>

Reports what the pull request for the repository's stored change set is doing,
from read-only evidence: the open pull requests, the default branch's tip, and
the commits already in the local clone. It needs a full clone: a partial clone
is refused as indeterminate (partial-clone) before any object is read. It
changes nothing but the fetch of the default branch into its remote-tracking ref
that verify also makes: it does not fetch a pull request's head, check anything
out, or write a file or an index.

The state is one of: proposed (an open pull request of this change set, made
by the person running this, whose body is the one the body command recorded and whose
head passes every check verify makes),
applied (the default branch already holds the change set), planned (neither),
diverged (its pull request or its body does not match), superseded (an older change set of
this repository has a pull request, even beside this one's) or indeterminate
(something could not be read or trusted, including a partial clone, a change set
the body command never recorded a body for, any open pull request whose body names the
marker word but is not the person's own, and a listing of 100 or more open pull
requests). It prints the state, a fixed reason
and #<number> for each pull request it is about, and nothing else. proposed
does not check the head's ancestry to the base, and nothing in this unit does.

Exit codes: 0 = proposed or applied, 1 = diverged, 2 = anything else.`;

function printApplyOutcome(label: string, outcome: ApplyStepResult): number {
  const suffix = outcome.exitCode === 0 ? outcome.verdict : `${outcome.verdict} (${outcome.reason})`;
  const detail = outcome.detail === undefined ? "" : `; ${outcome.detail}`;
  if (outcome.exitCode === 0) console.log(`launcher-apply-plan ${label}: ${suffix}${detail}`);
  else console.error(`launcher-apply-plan ${label}: ${suffix}${detail}`);
  return outcome.exitCode;
}

export async function materializeMain(argv: readonly string[], options: ApplyCommandOptions = {}): Promise<number> {
  try {
    const parsed = parseRepoSubcommand(argv, "materialize");
    if (parsed.help) {
      console.log(MATERIALIZE_HELP);
      return 0;
    }
    const resolved = resolveApplyInputs(parsed.id, options);
    if ("exitCode" in resolved) return printApplyOutcome("materialize", resolved);
    const outcome = await materializeRepository({
      clone: resolved.clone,
      hub: resolved.hub,
      set: resolved.set,
      texts: resolved.texts,
      heldChangeSets: resolved.held,
      spawn: options.spawn,
      now: options.now,
      toolVersion: options.toolVersion,
      runReadiness: options.runReadiness,
    });
    return printApplyOutcome("materialize", outcome);
  } catch (cause) {
    console.error(`launcher-apply-plan materialize: ${cause instanceof ApplyPlanInputError ? cause.message : "usage: launcher-apply-plan materialize --repo <id>"}`);
    return 2;
  }
}

export async function verifyMain(argv: readonly string[], options: ApplyCommandOptions = {}): Promise<number> {
  try {
    const parsed = parseRepoSubcommand(argv, "verify");
    if (parsed.help) {
      console.log(VERIFY_HELP);
      return 0;
    }
    const resolved = resolveApplyInputs(parsed.id, options);
    if ("exitCode" in resolved) return printApplyOutcome("verify", resolved);
    const outcome = await verifyRepository({
      clone: resolved.clone,
      hub: resolved.hub,
      set: resolved.set,
      heldChangeSets: resolved.held,
      now: options.now,
      runReadiness: options.runReadiness,
    });
    return printApplyOutcome("verify", outcome);
  } catch (cause) {
    console.error(`launcher-apply-plan verify: ${cause instanceof ApplyPlanInputError ? cause.message : "usage: launcher-apply-plan verify --repo <id>"}`);
    return 2;
  }
}

export async function statusMain(argv: readonly string[], options: ApplyCommandOptions = {}): Promise<number> {
  try {
    const parsed = parseRepoSubcommand(argv, "status");
    if (parsed.help) {
      console.log(STATUS_HELP);
      return 0;
    }
    const resolved = resolveApplyInputs(parsed.id, options);
    if ("exitCode" in resolved) {
      console.log(formatStatus({ state: "indeterminate", reason: resolved.reason }));
      return 2;
    }
    const outcome = await statusRepository({
      clone: resolved.clone,
      hub: resolved.hub,
      set: resolved.set,
      heldChangeSets: resolved.held,
      now: options.now,
      runReadiness: options.runReadiness,
      ports: options.statusPorts,
    });
    console.log(formatStatus(outcome));
    return outcome.exitCode;
  } catch (cause) {
    console.error(`launcher-apply-plan status: ${cause instanceof ApplyPlanInputError ? cause.message : "usage: launcher-apply-plan status --repo <id>"}`);
    return 2;
  }
}

const BODY_HELP = `Usage: ${BODY_USAGE}

Prints the body of the pull request for the repository's stored change set, and
nothing else, and records the SHA-256 of exactly those bytes as the change set's
pullRequest.bodySha256. The approval the body shows is decided from the hub at
the time of the run, as materialize decides it; it is never taken from an
option. A planned bundle the hub stored for the change set must hold that same
approval. --task-record is the number of the task-record issue in the
repository; each --supersedes is the number of the pull request of an older
change set of this repository that this one replaces, and needs another stored
change set of the repository. A change set already bound to another body is
refused, and one already bound to this body prints it again.

Exit codes: 0 = the body was printed, 1 = refused (a fixed token on standard
error, nothing on standard output), 2 = indeterminate or a usage error.`;

/**
 * The `body` subcommand. Standard output is the body and only the body, after it is recorded; a refusal prints one line of fixed
 * tokens to standard error and never an argument.
 */
export async function bodyMain(argv: readonly string[], options: ApplyCommandOptions = {}): Promise<number> {
  try {
    const parsed = parseBodyArgs(argv);
    if (parsed.help) {
      console.log(BODY_HELP);
      return 0;
    }
    const resolved = resolveApplyInputs(parsed.id, options);
    if ("exitCode" in resolved) {
      console.error(`launcher-apply-plan body: indeterminate (${resolved.reason ?? "refused"})`);
      return 2;
    }
    const outcome = await bodyRepository({
      clone: resolved.clone,
      hub: resolved.hub,
      set: resolved.set,
      heldChangeSets: resolved.held,
      taskRecord: parsed.taskRecord,
      supersedes: parsed.supersedes,
      now: options.now,
      runReadiness: options.runReadiness,
    });
    if (outcome.exitCode !== 0) {
      console.error(`launcher-apply-plan body: ${outcome.exitCode === 1 ? "refused" : "indeterminate"} (${outcome.reason})`);
      return outcome.exitCode;
    }
    process.stdout.write(outcome.body);
    return 0;
  } catch (cause) {
    console.error(cause instanceof BodyUsageError ? `launcher-apply-plan body: usage: ${BODY_USAGE}` : "launcher-apply-plan body: indeterminate (body-failed)");
    return 2;
  }
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
  if (argv[0] === "plan") {
    process.exitCode = await planMain(argv.slice(1));
    return;
  }
  if (argv[0] === "materialize") {
    process.exitCode = await materializeMain(argv.slice(1));
    return;
  }
  if (argv[0] === "verify") {
    process.exitCode = await verifyMain(argv.slice(1));
    return;
  }
  if (argv[0] === "status") {
    process.exitCode = await statusMain(argv.slice(1));
    return;
  }
  if (argv[0] === "body") {
    process.exitCode = await bodyMain(argv.slice(1));
    return;
  }
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
