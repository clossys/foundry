// Planned mode for `launcher-apply-plan plan` (issue #1708, RFC apply-approved-plan sections 4.2, 4.4 and 7).
//
// The planner and the dry tree produce a report: it claims no repository state and records no approval. This module turns
// that report into a planned bundle, but only when an approval binds exactly what was planned. Every ambiguity leaves the
// report as it is, or refuses; a rule is one of a fixed set of tokens and never carries tool output, a path, an id or a file
// name.
//
//   P1. The result is planned only when the bundle says the plan is the committed one AND the hub's committed plan, read as a
//       git object at an attached HEAD, is approved (readHubAuthority) for this very plan digest AND the bundle that approval
//       names is one the hub holds, stored and verifying, for that plan digest (the same K2 read admission makes). An approval
//       that names nothing the hub holds approves nothing this run could be bound by. Otherwise the result is returned
//       untouched, so its bytes are what they were before this module existed.
//   P2. A binding comes only from decideSetBinding, over the ledger this module reads at the set's base commit and trusts
//       against the committed plan's acts (never the acts of the set being judged). Nothing here builds a binding by hand.
//   P3. A repository that already carries a violated V3 (the planner's A4 flags: an authorization for another plan, or none)
//       is not admitted, and no readiness check runs for it.
//   P4. V3 is satisfied exactly when the set is bound. A refusal is V3 violated (exit 1) or indeterminate (exit 2), the rule is
//       the refusal's fixed token, and the repository has no binding.
//   P5. Planned mode reports V1, V2, V4, V5 and V7 as satisfied on every computed repository (a set that exists and validated
//       has met them), and V9 as satisfied only for a set that changes no lockfile; the dry tree's V6 and V9 are kept.
//   P6. A repository is `planned` when its verdict is satisfied and it has a binding (code rule A6). The bundle is validated
//       again before it is returned. No set, digest or set byte moves: the bundle digest does not cover mode, state, binding
//       or checks.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { decideSetBinding, planPackagesFor, readHubAuthority } from "./admission.js";
import { readStoredApplyBundle } from "./apply-store.js";
import type { AdmissionRefusal, HubAuthority, ReadinessRunner } from "./admission.js";
import {
  AUTHORIZATION_ABSENT,
  AUTHORIZATION_PLAN_MISMATCH,
  LEDGER_PATH,
  canonicalOrder,
  validateApplyBundle,
  worstVerdict,
} from "./change-set-contract.js";
import type { ApplyBundle, ApplyBundleRepository, ApplyCheck, RepositoryChangeSet } from "./change-set-contract.js";
import type { InstalledLedger } from "./ledger-contract.js";
import { trustInstalledLedger } from "./ledger-trust.js";
import { derivedLockfile } from "./materialize.js";
import type { PlanApplyBundleResult } from "./plan-bundle.js";

export interface PlannedBundleOptions {
  /** The hub's real path. */
  readonly hub: string;
  /** The local clone of a repository id. */
  readonly cloneFor: (id: string) => string;
  /** Every change set the hub holds: the ledger's history is trusted only against these. */
  readonly heldChangeSets: readonly RepositoryChangeSet[];
  readonly now: () => Date;
  /** Runs advisor-execution-readiness; the hub's own bin by default. Not reachable from a CLI. */
  readonly runReadiness?: ReadinessRunner;
}

const TOKEN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
/** The V3 rule of a refusal whose token is not a fixed one, or is one the bundle may carry only for its own authorization condition. */
const AUTHORIZATION_NOT_CURRENT = "authorization-not-current";
/** The V3 rule of a base ledger that cannot be read as a regular file. */
const LEDGER_UNREADABLE = "ledger-unreadable";
/** The V3 rule of a base ledger whose generation is not the one the set was computed over. */
const LEDGER_MISMATCH = "ledger-mismatch";

/** The V9 rule of a set that changes a lockfile and whose dry tree left no provenance check. */
const PROVENANCE_NOT_RUN = "provenance-not-run";

/** Rules only the bundle's own authorization condition may name (code rule A4). */
const RESERVED_RULES: ReadonlySet<string> = new Set([AUTHORIZATION_PLAN_MISMATCH, AUTHORIZATION_ABSENT]);

const sortChecks = (checks: readonly ApplyCheck[]): ApplyCheck[] => canonicalOrder(checks, (check) => [check.check, check.rule ?? ""]);
const satisfied = (check: ApplyCheck["check"]): ApplyCheck => ({ check, verdict: "satisfied" });

// ---------------------------------------------------------------------------
// the base ledger, from git objects only

const DROPPED_GIT_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_PREFIX", "GIT_SHALLOW_FILE", "GIT_GRAFT_FILE"];
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** Runs git with no repository named by the environment, no replace refs and literal pathspecs. Never throws. */
function runGit(cwd: string, args: readonly string[]): { status: number | null; stdout: Buffer } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of DROPPED_GIT_ENV) delete env[name];
  env.GIT_LITERAL_PATHSPECS = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  const run = spawnSync("git", ["--no-replace-objects", ...args], { cwd, env, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
  if (run.error !== undefined || run.stdout === null || run.stdout === undefined) return { status: null, stdout: Buffer.alloc(0) };
  return { status: run.status, stdout: run.stdout };
}

/**
 * The base ledger's exact bytes at the set's base commit: null when the commit holds none, or when the commit cannot be
 * read (materialize reads it the same way, and admission reads the base tree itself for every set that depends on it);
 * "unreadable" when the path is there but is not one regular, non-executable blob, or the blob cannot be read.
 */
function readBaseLedger(clone: string, baseCommit: string): Buffer | null | "unreadable" {
  if (!OBJECT_ID.test(baseCommit)) return null;
  const listed = runGit(clone, ["ls-tree", "-z", "--full-tree", baseCommit, "--", LEDGER_PATH]);
  if (listed.status !== 0) return null;
  const records = listed.stdout.toString("utf8").split("\0").filter((record) => record !== "");
  if (records.length === 0) return null;
  if (records.length !== 1) return "unreadable";
  const record = records[0]!;
  const tab = record.indexOf("\t");
  if (tab === -1) return "unreadable";
  const [mode, type, oid, ...rest] = record.slice(0, tab).split(" ");
  if (mode !== "100644" || type !== "blob" || oid === undefined || rest.length > 0 || !OBJECT_ID.test(oid) || record.slice(tab + 1) !== LEDGER_PATH) return "unreadable";
  const blob = runGit(clone, ["cat-file", "blob", oid]);
  return blob.status === 0 ? blob.stdout : "unreadable";
}

type BaseLedger = { readonly ledger: InstalledLedger | null; readonly bytes: Uint8Array | null } | { readonly refused: ApplyCheck };

/** The base ledger, trusted over the committed plan's acts (T9), and held to the generation the set was computed over. */
function trustedBaseLedger(clone: string, set: RepositoryChangeSet, held: readonly RepositoryChangeSet[], authority: HubAuthority): BaseLedger {
  const bytes = readBaseLedger(clone, set.repository.baseCommit);
  if (bytes === "unreadable") return { refused: { check: "V3", verdict: "indeterminate", rule: LEDGER_UNREADABLE } };
  const trust = trustInstalledLedger(bytes === null || bytes.length === 0 ? null : bytes, { id: set.repository.id, nodeId: set.repository.nodeId }, held, {
    planPackageActs: [{ planDigest: authority.planDigest, packages: planPackagesFor(authority, set.repository.id) }],
  });
  if (trust.state === "refused") return { refused: { check: "V3", verdict: "indeterminate", rule: TOKEN.test(trust.rule) ? trust.rule : LEDGER_UNREADABLE } };
  if ((trust.ledger?.generation ?? 0) !== set.ledger.generation) return { refused: { check: "V3", verdict: "violated", rule: LEDGER_MISMATCH } };
  return { ledger: trust.ledger, bytes: bytes === null || bytes.length === 0 ? null : bytes };
}

// ---------------------------------------------------------------------------
// V3 for one set

/** The V3 check of a refusal: exit 1 is violated, anything else indeterminate; the rule is its fixed detail, or its reason. */
function refusalCheck(refusal: AdmissionRefusal): ApplyCheck {
  const token = refusal.detail ?? refusal.reason;
  const rule = TOKEN.test(token) && !RESERVED_RULES.has(token) ? token : AUTHORIZATION_NOT_CURRENT;
  return { check: "V3", verdict: refusal.exitCode === 1 ? "violated" : "indeterminate", rule };
}

async function decideV3(entry: Extract<ApplyBundleRepository, { changeSet: string }>, set: RepositoryChangeSet, authority: HubAuthority, options: PlannedBundleOptions): Promise<{ readonly check: ApplyCheck; readonly binding?: NonNullable<Extract<ApplyBundleRepository, { changeSet: string }>["binding"]> }> {
  let clone: string;
  try {
    clone = realpathSync(options.cloneFor(set.repository.id));
  } catch {
    return { check: { check: "V3", verdict: "indeterminate", rule: "clone-unreadable" } };
  }
  const base = trustedBaseLedger(clone, set, options.heldChangeSets, authority);
  if ("refused" in base) return { check: base.refused };
  const decided = await decideSetBinding({
    hub: options.hub,
    clone,
    set,
    authority,
    baseLedger: base.ledger,
    baseLedgerBytes: base.bytes,
    now: options.now,
    runReadiness: options.runReadiness,
  });
  if (decided.state !== "bound") return { check: refusalCheck(decided) };
  return { check: satisfied("V3"), binding: decided.binding };
}

// ---------------------------------------------------------------------------
// the bundle

/** Whether the hub stores, verified, the bundle the approval names, and it is for the approved plan's digest. A store that cannot be read holds nothing. */
function holdsApprovedBundle(hub: string, authority: HubAuthority): boolean {
  try {
    const approved = readStoredApplyBundle(hub, authority.subject);
    return approved !== null && approved.bundleDigest === authority.subject && approved.plan.digest === authority.planDigest;
  } catch {
    return false;
  }
}

const PRE_APPLY: readonly ApplyCheck["check"][] = ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9"];

/**
 * The result as a planned bundle, or the same result when nothing approves it (P1). A repository with no change set keeps
 * its entry. Throws when the planned bundle does not validate; nothing is written here.
 */
export async function plannedBundle(result: PlanApplyBundleResult, options: PlannedBundleOptions): Promise<PlanApplyBundleResult> {
  if (!result.bundle.plan.committed) return result;
  const authority = readHubAuthority(options.hub);
  if ("state" in authority || authority.planDigest !== result.bundle.plan.digest) return result;
  if (!holdsApprovedBundle(options.hub, authority)) return result;

  const repositories: ApplyBundleRepository[] = [];
  for (const entry of result.bundle.repositories) {
    if (!("changeSet" in entry)) {
      repositories.push(entry);
      continue;
    }
    const set = result.changeSets.find((candidate) => candidate.changeSetDigest === entry.changeSet);
    if (set === undefined) throw new Error("a repository names a change set the result does not hold");
    const { state: _state, binding: _binding, ...rest } = entry;
    // P3: the planner already refused this repository's authorization; no readiness runs and nothing is bound.
    const flagged = rest.checks.some((check) => check.check === "V3");
    const decided = flagged ? undefined : await decideV3(rest, set, authority, options);
    const others = rest.checks.filter((check) => !(decided !== undefined && check.check === "V3"));
    const added: ApplyCheck[] = [satisfied("V1"), satisfied("V2"), satisfied("V4"), satisfied("V5"), satisfied("V7")];
    // P5: V9 is satisfied only for a set with no lockfile to regenerate; for any other set it stands as the dry tree left it, and is
    // indeterminate when the dry tree ran no provenance check at all.
    if (derivedLockfile(set) === null) added.push(satisfied("V9"));
    else added.push({ check: "V9", verdict: "indeterminate", rule: PROVENANCE_NOT_RUN });
    const checks = sortChecks([...others, ...(decided === undefined ? [] : [decided.check]), ...added.filter((check) => !others.some((existing) => existing.check === check.check))]);
    const verdict = worstVerdict(checks.map((check) => check.verdict));
    const binding = decided?.binding;
    const planned = verdict === "satisfied" && binding !== undefined && PRE_APPLY.every((id) => checks.some((check) => check.check === id && check.verdict === "satisfied"));
    repositories.push({ ...rest, verdict, checks, ...(binding === undefined ? {} : { binding }), ...(planned ? { state: "planned" as const } : {}) });
  }
  const bundle: ApplyBundle = { ...result.bundle, mode: "planned", repositories };
  if (!validateApplyBundle(bundle).valid) throw new Error("the planned bundle does not validate");
  return { bundle, changeSets: result.changeSets };
}
