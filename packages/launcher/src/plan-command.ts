// `launcher-apply-plan plan` (issue #1178, step 2): the command that runs the
// pure planner. It reads the hub -- the plan, the brief, the composed skills,
// the change-set store, the inventory, the engine pins and the execution
// authorization -- and observes each staffed clone's committed default
// branch, hands all of it to planApplyBundle(), stores the change sets and
// then the bundle, and prints the approval sheet.
//
// It writes only under clossys/.state/apply/ in the hub, through the store
// (which refuses a symbolic link in that path), and writes nothing in any
// clone. It computes and records no approval: no option carries one. The
// bundle is a report unless the hub's committed plan is approved for this plan
// digest; then it is planned, and each set's binding is decided from the hub,
// by admission (planned-bundle.ts). Every refusal is a fixed token that echoes
// no plan, brief, skill or repository text.

import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { ReadinessRunner } from "./admission.js";
import { renderApprovalSheet, ApprovalSheetError } from "./approval-sheet.js";
import { listStoredChangeSets, storeApplyBundle, storeChangeSet } from "./apply-store.js";
import type { ApplyBundle, PinnedPackage, RepositoryChangeSet, RepositoryVisibility } from "./change-set-contract.js";
import { ID_TOKEN, skillPath } from "./change-set-contract.js";
import { ADVISOR_PACKAGE, INTEGRATOR_PACKAGE, WORKSPACE_INVENTORY_REL, readInventoryRepositories } from "./core.js";
import { readContractDocument } from "./generated/contract-schema.generated.js";
import { dryMaterializeBundle } from "./dry-materialize.js";
import type { DryMaterializePorts } from "./dry-materialize.js";
import { createNodeHost } from "./host.js";
import { sameRepository } from "./identity.js";
import { isUnreadable, readLockfile } from "./lockfile-readers.js";
import type { LockfileFormat } from "./lockfile-readers.js";
import { observeRepository } from "./observe-repository.js";
import { plannedBundle } from "./planned-bundle.js";
import type { RepositoryObservationPorts } from "./observe-repository.js";
import { planApplyBundle } from "./plan-bundle.js";
import type { PlanApplyBundleResult, RepositoryObservation, SkippedRepositoryObservation } from "./plan-bundle.js";
import { validateAdvisorPlan, validateEngagementBrief } from "./plan-contract.js";
import type { AdvisorPlan, EngagementBrief } from "./plan-contract.js";

export const PLAN_USAGE = `Usage: launcher-apply-plan plan [--agent codex|claude|cursor] [--adopt-existing <consent.json>] [--help]

--agent selects the authoring agent namespace for generated apply branches.
The choice is covered by the change-set and approval digests. Omitting it
preserves legacy clossys/apply branches and stored change sets. Use the same
choice when recomputing an approved bundle.

--adopt-existing reads an explicit repository-to-proof-row mapping for setup.
It supplies scope, not approval, and requires Starter 0.3.x. Omit it for apply;
the protected setup ledger supplies the frozen scope automatically.

Run in the hub. Computes the apply bundle for the plan file in the working
tree, reports whether that file is the one committed at HEAD, and prints the
approval sheet: the bundle and plan digests, whether the plan is committed, the
mode, the execution authorization, the line to approve, one row for each item of each
repository's change set, and every item deferred, refused or skipped.

Reads, in the hub: clossys/advisor/plan.json and brief.json, the composed
.agents/skills/clossys-<role>/SKILL.md of each staffed role and of the Advisor
voice, the stored change sets, the inventory, the exact @clossys/advisor and
@clossys/integrator versions in package.json with their lockfile integrity,
and the execution authorization committed in
clossys/advisor/assessment-input.json. Observes the committed default branch
of each staffed repository's clone, a sibling directory of the hub, and
never writes in a clone.

A repository whose change set changes a lockfile and is otherwise satisfied is
dry-materialized: its committed tree and its change set are written into a
temporary directory (never the clone), the lockfile is regenerated there with
install scripts off (V6), and, only when that passes, the hub's installed
@clossys/integrator provenance check runs on that same tree (V9). The
temporary directory is removed before the command ends. A tool that changes
anything but the lockfile, a submodule, a link that leaves the tree, or an
oversized tree is refused, and no rule names a path, an id or tool output.

When the plan file is the one committed at an attached HEAD and that committed
plan carries an approval for this plan digest, the mode is planned: for each
repository the hub decides the binding from what it holds (the approved
bundle, the stored change sets, the base ledger and tree), and runs its own
advisor-execution-readiness for a set that installs packages. A repository is
planned only when every check V1 to V9 is satisfied and an approval binds its
change set; one the hub refuses is violated (V3, exit 1) or indeterminate
(exit 2), with a fixed rule, and is never bound. With no such approval the mode
is report, the checks are as above, and nothing is run for readiness. A
report never replaces the stored planned bundle of the same digest: that
refusal is "store-failed".

Writes only under clossys/.state/apply/: each change set, then the bundle.
The sheet holds ids and digests only, never plan or brief text. This
computes and records no approval: the approval is the plan's decision, made
in the hub, for the subject digest the sheet names. The digests and the change
sets do not depend on the mode. Nor does the sheet, except its Mode line and,
under "Checks not satisfied", the V3 row of a repository the hub refuses (and
the V9 row of a set that changes a lockfile, when the dry tree ran no
provenance check), which only planned mode adds.

Every refusal is a fixed word and names nothing from the files it read. A
refusal before anything is stored ends "; nothing was stored"; "store-failed"
and an unexpected failure do not, because some sets may already be stored.

Exit codes: 0 = every repository is satisfied, 1 = a repository is violated,
2 = an input could not be read, the planner refused, or a repository is
indeterminate. A bundle that was computed is stored and printed whatever the
exit code.`;

export interface PlanCommandOptions {
  /** The hub root; the process's cwd by default. */
  readonly cwd?: string;
  /** The instant the bundle is computed at; the wall clock by default. */
  readonly now?: () => Date;
  /** How a repository's node id and visibility are read; read-only `gh api` by default. */
  readonly ports?: RepositoryObservationPorts;
  /** This package's version, the producer of every set; read from this package's manifest by default. */
  readonly producerVersion?: string;
  /** Where the sheet goes; standard output by default. */
  readonly stdout?: (text: string) => void;
  /** Where a refusal goes, one line; standard error by default. */
  readonly stderr?: (line: string) => void;
  /** How the package manager and the hub's provenance check are launched for the dry tree; the real runners by default. Not reachable from a CLI. */
  readonly spawn?: Pick<DryMaterializePorts, "lockfileSpawn" | "provenanceSpawn">;
  /** How advisor-execution-readiness is run for a set that installs packages in planned mode; the hub's own bin by default. Not reachable from a CLI. */
  readonly runReadiness?: ReadinessRunner;
}

/** The fixed reasons a plan run stops before any bundle is stored. */
type PlanRefusal =
  | "usage"
  | "hub-unreadable"
  | "plan-unreadable"
  | "plan-invalid"
  | "brief-unreadable"
  | "brief-invalid"
  | "skill-unreadable"
  | "store-unreadable"
  | "inventory-unreadable"
  | "engine-pin-unreadable"
  | "authorization-malformed"
  | "producer-unreadable"
  | "planner-refused"
  | "sheet-refused"
  | "store-failed";

class PlanRefused extends Error {
  constructor(readonly token: PlanRefusal) {
    super(token);
  }
}

function refuse(token: PlanRefusal): never {
  throw new PlanRefused(token);
}

const PLAN_REL = "clossys/advisor/plan.json";
const BRIEF_REL = "clossys/advisor/brief.json";
const ASSESSMENT_REL = "clossys/advisor/assessment-input.json";
const ADVISOR_VOICE = "advisor";
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/u;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const VISIBILITIES: readonly string[] = ["private", "internal", "public"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------------------
// reading the hub

/** Reads a regular file below the hub, never through a symbolic link; the bytes, or null. */
function readHubFile(hub: string, rel: string): Buffer | null {
  try {
    const path = join(hub, rel);
    if (!lstatSync(path).isFile()) return null;
    const real = realpathSync(path);
    if (!real.startsWith(`${hub}${sep}`)) return null;
    return readFileSync(path);
  } catch {
    return null;
  }
}

function readStrictJson(bytes: Uint8Array): unknown {
  return readContractDocument(bytes);
}

const DROPPED_GIT_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_GRAFT_FILE",
];

function runGit(cwd: string, args: readonly string[]): { status: number | null; stdout: Buffer } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of DROPPED_GIT_ENV) delete env[name];
  env.GIT_LITERAL_PATHSPECS = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  const run = spawnSync("git", ["--no-replace-objects", ...args], { cwd, env, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  if (run.error !== undefined || run.stdout === null || run.stdout === undefined) return { status: null, stdout: Buffer.alloc(0) };
  return { status: run.status, stdout: run.stdout };
}

/**
 * The bytes of a regular, non-executable file at `rel` in the tree of the
 * hub's HEAD, or null. HEAD must be attached to a branch, the path must be one
 * blob of mode 100644 (a symbolic link is refused), and the read goes through
 * the blob's object id, so the working tree is never consulted.
 */
function readCommittedBlob(hub: string, rel: string): Buffer | null {
  const head = runGit(hub, ["symbolic-ref", "-q", "HEAD"]);
  if (head.status !== 0 || !head.stdout.toString("utf8").trim().startsWith("refs/heads/")) return null;
  const listed = runGit(hub, ["ls-tree", "-z", "HEAD", "--", rel]);
  if (listed.status !== 0) return null;
  const records = listed.stdout.toString("utf8").split("\0").filter((record) => record !== "");
  if (records.length !== 1) return null;
  const record = records[0]!;
  const tab = record.indexOf("\t");
  if (tab === -1 || record.slice(tab + 1) !== rel) return null;
  const [mode, type, oid, ...rest] = record.slice(0, tab).split(" ");
  if (mode !== "100644" || type !== "blob" || oid === undefined || rest.length > 0 || !OBJECT_ID.test(oid)) return null;
  const blob = runGit(hub, ["cat-file", "blob", oid]);
  return blob.status === 0 ? blob.stdout : null;
}

/** The hub inventory's repository ids, read through readHubFile (no link, nothing outside the hub); an absent file lists none. */
function readInventory(hub: string): readonly string[] {
  const path = join(hub, WORKSPACE_INVENTORY_REL);
  try {
    if (lstatSync(path, { throwIfNoEntry: false }) === undefined) return [];
  } catch {
    return refuse("inventory-unreadable");
  }
  if (readHubFile(hub, WORKSPACE_INVENTORY_REL) === null) return refuse("inventory-unreadable");
  try {
    return readInventoryRepositories(createNodeHost(hub), path, "the hub inventory");
  } catch {
    return refuse("inventory-unreadable");
  }
}

function readPlan(hub: string): { plan: AdvisorPlan; bytes: Buffer } {
  const bytes = readHubFile(hub, PLAN_REL);
  if (bytes === null) return refuse("plan-unreadable");
  let document: unknown;
  try {
    document = readStrictJson(bytes);
  } catch {
    return refuse("plan-unreadable");
  }
  if (!validateAdvisorPlan(document).valid) return refuse("plan-invalid");
  return { plan: document as AdvisorPlan, bytes };
}

function readBrief(hub: string): EngagementBrief {
  const bytes = readHubFile(hub, BRIEF_REL);
  if (bytes === null) return refuse("brief-unreadable");
  let document: unknown;
  try {
    document = readStrictJson(bytes);
  } catch {
    return refuse("brief-unreadable");
  }
  if (!validateEngagementBrief(document).valid) return refuse("brief-invalid");
  return document as EngagementBrief;
}

/** The composed skill of every staffed role, and of the Advisor voice, as UTF-8 text. */
function readSkills(hub: string, plan: AdvisorPlan): { role: string; content: string }[] {
  const roles = [...new Set([...(plan.staffing ?? []).flatMap((entry) => entry.roles), ADVISOR_VOICE])];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return roles.map((role) => {
    if (!ID_TOKEN.test(role)) return refuse("skill-unreadable");
    const bytes = readHubFile(hub, skillPath(role));
    if (bytes === null) return refuse("skill-unreadable");
    try {
      return { role, content: decoder.decode(bytes) };
    } catch {
      return refuse("skill-unreadable");
    }
  });
}

/**
 * The hub's pin of one engine package: the exact version its package.json
 * names, and the integrity the hub's lockfile resolves that version to.
 */
function readPin(manifest: Record<string, unknown>, lockfile: ReturnType<typeof readLockfile>, name: string): PinnedPackage {
  if (isUnreadable(lockfile)) return refuse("engine-pin-unreadable");
  const buckets = ["dependencies", "devDependencies"].map((bucket) => manifest[bucket]).filter((bucket) => bucket !== undefined);
  const declared = buckets.flatMap((bucket) => (isRecord(bucket) && Object.hasOwn(bucket, name) ? [bucket[name]] : []));
  if (declared.length !== 1) return refuse("engine-pin-unreadable");
  const version = declared[0];
  if (typeof version !== "string" || !EXACT_VERSION.test(version)) return refuse("engine-pin-unreadable");
  const resolved = lockfile.root.filter((entry) => entry.name === name && !entry.link);
  if (resolved.length !== 1 || resolved[0]!.version !== version) return refuse("engine-pin-unreadable");
  const integrity = resolved[0]!.integrity;
  if (integrity === null || !INTEGRITY.test(integrity)) return refuse("engine-pin-unreadable");
  return { name, version, integrity };
}

function readPins(hub: string): { engine: PinnedPackage; integrator: PinnedPackage } {
  const manifestBytes = readHubFile(hub, "package.json");
  if (manifestBytes === null) return refuse("engine-pin-unreadable");
  let manifest: unknown;
  try {
    manifest = readStrictJson(manifestBytes);
  } catch {
    return refuse("engine-pin-unreadable");
  }
  if (!isRecord(manifest)) return refuse("engine-pin-unreadable");
  const candidates: { format: LockfileFormat; rel: string }[] = [
    { format: "npm", rel: "package-lock.json" },
    { format: "pnpm", rel: "pnpm-lock.yaml" },
  ];
  const present = candidates.flatMap((candidate) => {
    const bytes = readHubFile(hub, candidate.rel);
    return bytes === null ? [] : [{ format: candidate.format, bytes }];
  });
  if (present.length !== 1) return refuse("engine-pin-unreadable");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(present[0]!.bytes);
  } catch {
    return refuse("engine-pin-unreadable");
  }
  const lockfile = readLockfile(present[0]!.format, text);
  return { engine: readPin(manifest, lockfile, ADVISOR_PACKAGE), integrator: readPin(manifest, lockfile, INTEGRATOR_PACKAGE) };
}

/**
 * The execution authorization committed at the hub's HEAD, or null when there
 * is no committed assessment or it holds no `engagement.executionAuthorization`.
 * Only the two fields the bundle records are judged: a value that is present
 * and is not an object holding a string `planDigest` and `expiresAt` refuses.
 * Whether it permits the plan's acts is the planner's V3 check, and admission's.
 */
function readAuthorization(hub: string): { planDigest: string; expiresAt: string } | null {
  const bytes = readCommittedBlob(hub, ASSESSMENT_REL);
  if (bytes === null) return null;
  let document: unknown;
  try {
    document = readStrictJson(bytes);
  } catch {
    return refuse("authorization-malformed");
  }
  if (!isRecord(document)) return refuse("authorization-malformed");
  const engagement = document.engagement;
  if (engagement === undefined) return null;
  if (!isRecord(engagement)) return refuse("authorization-malformed");
  const authorization = engagement.executionAuthorization;
  if (authorization === undefined) return null;
  if (!isRecord(authorization) || typeof authorization.planDigest !== "string" || typeof authorization.expiresAt !== "string") return refuse("authorization-malformed");
  return { planDigest: authorization.planDigest, expiresAt: authorization.expiresAt };
}

function readProducerVersion(options: PlanCommandOptions): string {
  if (options.producerVersion !== undefined) return options.producerVersion;
  try {
    const manifest: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    if (isRecord(manifest) && typeof manifest.version === "string" && manifest.version !== "") return manifest.version;
  } catch {
    /* handled below */
  }
  return refuse("producer-unreadable");
}

// ---------------------------------------------------------------------------
// observing the clones

function ghApi(id: string, field: string): string {
  const run = spawnSync("gh", ["api", `repos/${id}`, "--jq", field], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 });
  if (run.status !== 0) throw new Error("gh api failed");
  return run.stdout.trim();
}

const DEFAULT_PORTS: RepositoryObservationPorts = {
  nodeId: (id) => {
    if (!id.includes("/")) throw new Error("no owner");
    return ghApi(id, ".node_id");
  },
  visibility: (id) => {
    if (!id.includes("/")) throw new Error("no owner");
    const visibility = ghApi(id, ".visibility");
    if (!VISIBILITIES.includes(visibility)) throw new Error("unknown visibility");
    return visibility as RepositoryVisibility;
  },
};

/** The sibling directory of the hub that holds a repository's clone. */
const cloneOf = (hub: string, id: string): string => resolve(dirname(hub), id.slice(id.indexOf("/") + 1));

async function observeStaffed(
  hub: string,
  plan: AdvisorPlan,
  inventory: readonly string[],
  ports: RepositoryObservationPorts,
): Promise<(RepositoryObservation | SkippedRepositoryObservation)[]> {
  const observations: (RepositoryObservation | SkippedRepositoryObservation)[] = [];
  const seen = new Set<string>();
  for (const entry of plan.staffing ?? []) {
    const id = entry.repository;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!inventory.some((listed) => sameRepository(listed, id))) {
      observations.push({ id, skipped: "not-in-inventory", verdict: "indeterminate" });
      continue;
    }
    observations.push(await observeRepository({ id, clone: cloneOf(hub, id), ports }));
  }
  return observations;
}

// ---------------------------------------------------------------------------
// the command

function exitCodeOf(bundle: ApplyBundle): number {
  const verdicts = bundle.repositories.map((entry) => entry.verdict);
  if (verdicts.includes("violated")) return 1;
  return verdicts.includes("indeterminate") ? 2 : 0;
}

function store(hub: string, result: PlanApplyBundleResult): void {
  try {
    for (const set of result.changeSets) storeChangeSet(hub, set);
    storeApplyBundle(hub, result.bundle);
  } catch {
    refuse("store-failed");
  }
}

/**
 * The `plan` subcommand. Never throws: every refusal prints one line naming a
 * fixed reason and returns 2, and nothing is written unless a bundle was
 * computed and its sheet rendered.
 */
export async function planMain(argv: readonly string[], options: PlanCommandOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((text: string) => void process.stdout.write(text));
  const stderr = options.stderr ?? ((line: string) => console.error(line));
  try {
    if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
      stdout(`${PLAN_USAGE}\n`);
      return 0;
    }
    let agentProvenance: "codex" | "claude" | "cursor" | undefined;
    let adoptionPath: string | undefined;
    for (let index=0; index<argv.length; index+=2) {
      const flag=argv[index]; const value=argv[index+1];
      if (flag === "--agent" && agentProvenance === undefined && value !== undefined && ["codex","claude","cursor"].includes(value)) agentProvenance=value as "codex"|"claude"|"cursor";
      else if (flag === "--adopt-existing" && adoptionPath === undefined && value !== undefined) adoptionPath=value;
      else return refuse("usage");
    }
    let existingDeclarationAdoptions: import("./plan-bundle.js").PlanApplyBundleInputs["existingDeclarationAdoptions"];
    if (adoptionPath !== undefined) {
      try { existingDeclarationAdoptions=readContractDocument(readFileSync(adoptionPath)) as NonNullable<typeof existingDeclarationAdoptions>; }
      catch { return refuse("usage"); }
    }
    let hub: string;
    try {
      hub = realpathSync(options.cwd ?? process.cwd());
    } catch {
      return refuse("hub-unreadable");
    }
    const { plan, bytes: planBytes } = readPlan(hub);
    const hubBrief = readBrief(hub);
    const skills = readSkills(hub, plan);
    let heldChangeSets: RepositoryChangeSet[];
    try {
      heldChangeSets = listStoredChangeSets(hub);
    } catch {
      return refuse("store-unreadable");
    }
    const inventory = readInventory(hub);
    const { engine, integrator } = readPins(hub);
    const authorization = readAuthorization(hub);
    const committedPlan = readCommittedBlob(hub, PLAN_REL);
    const planCommitted = committedPlan !== null && committedPlan.equals(planBytes);
    const producerVersion = readProducerVersion(options);
    const repositories = await observeStaffed(hub, plan, inventory, options.ports ?? DEFAULT_PORTS);
    const computedAt = (options.now ?? (() => new Date()))().toISOString();

    let result: PlanApplyBundleResult;
    try {
      result = planApplyBundle({
        plan,
        hubBrief,
        repositories,
        skills,
        producer: { name: "@clossys/launcher", version: producerVersion },
        engine,
        integrator,
        planCommitted,
        authorization,
        computedAt,
        heldChangeSets,
        ...(agentProvenance !== undefined ? { agentProvenance } : {}),
        ...(existingDeclarationAdoptions !== undefined ? {existingDeclarationAdoptions} : {}),
      });
    } catch {
      return refuse("planner-refused");
    }
    // The part of V6 the planner cannot run, and V9: on a temporary tree, never in a clone.
    try {
      result = await dryMaterializeBundle(result, { hub, cloneFor: (id) => cloneOf(hub, id), now: options.now ?? (() => new Date()), ports: { lockfileSpawn: options.spawn?.lockfileSpawn, provenanceSpawn: options.spawn?.provenanceSpawn } });
    } catch {
      return refuse("planner-refused");
    }
    // An approval that binds exactly what was planned: only from the hub's committed, approved plan, only through admission.
    try {
      result = await plannedBundle(result, { hub, cloneFor: (id) => cloneOf(hub, id), heldChangeSets, now: options.now ?? (() => new Date()), runReadiness: options.runReadiness });
    } catch {
      return refuse("planner-refused");
    }
    let sheet: string;
    try {
      sheet = renderApprovalSheet({ bundle: result.bundle, changeSets: result.changeSets });
    } catch (cause) {
      if (cause instanceof ApprovalSheetError) return refuse("sheet-refused");
      throw cause;
    }
    store(hub, result);
    stdout(sheet);
    return exitCodeOf(result.bundle);
  } catch (cause) {
    const token = cause instanceof PlanRefused ? cause.token : "failed";
    stderr(`launcher-apply-plan plan: ${token}${token === "store-failed" ? "" : "; nothing was stored"}`);
    return 2;
  }
}
