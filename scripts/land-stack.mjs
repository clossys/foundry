#!/usr/bin/env node
// land-stack — local conductor for stacked pull requests on this repository.
//
//   node scripts/land-stack.mjs --status <pr>
//   node scripts/land-stack.mjs --merge <pr>
//   node scripts/land-stack.mjs --restack <pr> --worktree <path>
//
// Policy is pure and exported for tests; git/gh are injectable at the CLI edge.
//
// TIER GATE (HITL escalation, first slice -- issue #1187, decision-tier rule
// at #1187 comment 5800142871, Fable second opinion at #1187 comment
// 5800683025). In addition to the existing required-status-check merge
// readiness above, this script refuses to merge a pull request whose changed
// files classify as tier-1 or tier-2 (governance/review-tiers.json) unless
// its review evidence satisfies that tier's rule -- see
// `evaluateTierGate` below. This runs ONLY here, in the merge-train
// conductor a contributor invokes from their own machine with an
// authenticated `gh`: no CI workflow reads governance/review-tiers.json or
// the `foundry-review-record` comments it requires, so AGENTS.md's "Do not
// add a background model reviewer or make repository workflows wait for
// provider-specific review evidence" stays true exactly as written -- this
// is a merge-train gate, not a workflow.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const PERMITTED_MERGE = "merge";

const NON_BLOCKING_CONCLUSIONS = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

/** @returns {'merge'} */
export function permittedMergeMethod() {
  return PERMITTED_MERGE;
}

/**
 * Only the PR about to merge may leave draft; others stay draft.
 * @param {number|string} prNumber
 * @param {number|string|null|undefined} currentlyReadyNumber
 */
export function shouldReady(prNumber, currentlyReadyNumber) {
  if (currentlyReadyNumber === null || currentlyReadyNumber === undefined) return false;
  return String(prNumber) === String(currentlyReadyNumber);
}

/**
 * Whether a single check, taken alone, would block a merge if it were
 * required. Unchanged in meaning from before #1135: incomplete, absent, or
 * anything other than SUCCESS/SKIPPED/NEUTRAL is blocking. What changed is
 * *which* checks this is asked about -- see `classifyRequiredContexts`.
 * @param {{ status?: string, conclusion?: string|null }} check
 */
export function isCheckBlocking({ status, conclusion }) {
  if (status !== "COMPLETED") return true;
  if (conclusion == null || conclusion === "") return true;
  return !NON_BLOCKING_CONCLUSIONS.has(conclusion);
}

/**
 * Derive the required-status-check context set from a branch's live rule
 * evaluation (the shape returned by
 * `gh api repos/{owner}/{repo}/rules/branches/{branch}`), never from a
 * hand-written literal (#907) -- the set has already grown from 9 contexts
 * to 15 (#402) and will grow again without this script being told.
 *
 * @param {Array<{type?: string, parameters?: {required_status_checks?: Array<{context?: string}>}}>} branchRules
 * @returns {string[]}
 */
export function extractRequiredContexts(branchRules) {
  const contexts = [];
  for (const rule of branchRules ?? []) {
    if (rule?.type !== "required_status_checks") continue;
    for (const check of rule.parameters?.required_status_checks ?? []) {
      if (check?.context) contexts.push(check.context);
    }
  }
  return contexts;
}

/**
 * Classify every required context against the FULL set of checks reported
 * for a pull request -- required and non-required alike. The full set is
 * needed, not just the required subset, to tell "no run recorded yet
 * because an upstream job this context depends on is still going" apart
 * from "no run recorded, and nothing will ever produce one".
 *
 * Concretely: `secret-scan (inspector judgment)` declares
 * `needs: [push-tree, safety]` in .github/workflows/ci.yml, so it does not
 * exist as a check run at all until those finish -- even though neither of
 * them is itself a required context. Scoping "is anything still running" to
 * only the required contexts would misclassify that as a permanent
 * blocker while push-tree/safety are mid-flight, reproducing the bug this
 * function exists to fix.
 *
 * @param {string[]} requiredContexts
 * @param {Array<{name?: string, status?: string, conclusion?: string|null}>} checks
 * @returns {{
 *   green: string[],
 *   red: Array<{ name: string, conclusion: string|null }>,
 *   pending: string[],
 *   missing: string[],
 * }}
 */
export function classifyRequiredContexts(requiredContexts, checks) {
  const byName = new Map();
  for (const check of checks) {
    const name = check.name ?? "";
    if (name) byName.set(name, check);
  }
  const anyIncomplete = checks.some((check) => check.status !== "COMPLETED");

  const green = [];
  const red = [];
  const pending = [];
  const missing = [];

  for (const context of requiredContexts) {
    const check = byName.get(context);
    if (!check) {
      // Three states, not two (#1135): an absent required context is never
      // treated as a pass. Whether it counts as "still coming" or "will
      // never come" depends on whether anything else on this pull request
      // is still in flight.
      if (anyIncomplete) pending.push(context);
      else missing.push(context);
      continue;
    }
    if (check.status !== "COMPLETED") {
      pending.push(context);
    } else if (isCheckBlocking(check)) {
      red.push({ name: context, conclusion: check.conclusion ?? null });
    } else {
      green.push(context);
    }
  }

  return { green, red, pending, missing };
}

/**
 * @param {{
 *   mergeable?: string|null,
 *   mergeStateStatus?: string|null,
 *   isDraft?: boolean,
 *   checks?: Array<{ name?: string, status?: string, conclusion?: string|null }>,
 *   requiredContexts?: string[],
 * }} input
 * @returns {{ ok: boolean, reason: string }}
 */
export function canMerge(input) {
  const mergeable = input.mergeable ?? "UNKNOWN";
  const mergeStateStatus = input.mergeStateStatus ?? "UNKNOWN";
  const isDraft = Boolean(input.isDraft);
  const checks = input.checks ?? [];
  const requiredContexts = input.requiredContexts ?? [];

  if (isDraft) return { ok: false, reason: "pull request is draft" };
  if (mergeable === "CONFLICTING") return { ok: false, reason: "merge conflicts" };
  if (mergeable === "UNKNOWN") return { ok: false, reason: "mergeability unknown" };
  if (mergeStateStatus === "BEHIND") return { ok: false, reason: "head is behind main; restack first" };
  if (mergeStateStatus === "UNKNOWN") return { ok: false, reason: "merge state unknown" };
  if (mergeable !== "MERGEABLE") return { ok: false, reason: `mergeable=${mergeable}` };

  if (requiredContexts.length === 0) {
    // Fail closed rather than silently falling back to "every check that
    // happened to run" -- that fallback is the exact defect #1135 exists to
    // remove. A caller that could not resolve the ruleset should say so,
    // not merge blind.
    return { ok: false, reason: "no required contexts supplied; refusing to evaluate merge readiness blind" };
  }

  const { red, pending, missing } = classifyRequiredContexts(requiredContexts, checks);

  if (red.length > 0 || missing.length > 0) {
    const names = [
      ...red.map((c) => `${c.name} (${c.conclusion ?? "no conclusion"})`),
      ...missing.map((name) => `${name} (no run recorded)`),
    ].join(", ");
    return { ok: false, reason: `blocking required checks: ${names}` };
  }

  if (pending.length > 0) {
    return { ok: false, reason: `pending required checks: ${pending.join(", ")}` };
  }

  // Non-required checks are reported as context, never as blockers (#1135):
  // a red or cancelled informational signal must stay visible without being
  // a wedge that can never clear.
  const requiredNames = new Set(requiredContexts);
  const nonRequiredRed = checks.filter((check) => !requiredNames.has(check.name ?? "") && isCheckBlocking(check));

  const base = "ready to merge with --merge";
  if (nonRequiredRed.length > 0) {
    const names = nonRequiredRed.map((c) => c.name ?? "<unnamed>").join(", ");
    return { ok: true, reason: `${base} (non-required checks red, not blocking: ${names})` };
  }
  return { ok: true, reason: base };
}

// ---------------------------------------------------------------------------
// Tier gate — pure policy (governance/review-tiers.json,
// docs/contracts/review-record.json, docs/contracts/decision-record.json).
// I/O (reading those files, fetching PR files/comments) is injectable, the
// same discipline the merge-readiness policy above already follows.
// ---------------------------------------------------------------------------

/**
 * Converts one glob pattern (this repository's own minimal dialect: `**`
 * matches across path separators including zero segments, `*` matches
 * within one path segment, everything else is literal) into an anchored
 * RegExp. No external dependency: root package.json carries almost no
 * dependencies outside packages/*'s own workspaces, and Node's
 * `path.matchesGlob` is not available across this repository's declared
 * `engines.node: ">=20"` floor (it landed in 20.17/22.13), so this repeats
 * the same "no dependency-free alternative exists, so this script defines
 * its own narrow version" choice scripts/collect-review-evidence.mjs's own
 * header makes for `normalizeCheckConclusion` and friends.
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  const ESCAPE = new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else {
        re += ".*";
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (ESCAPE.has(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Classifies a pull request's changed-file set into a review tier: the
 * union of every path, the MAX tier any single path reaches. A path
 * matching `tierGlobs.tier2` is tier-2 regardless of whether it also
 * matches `tier1`. A path matching `tier1` is tier-1 UNLESS it also matches
 * `tier1RecordExempt` (governance/review-tiers.json's carve-out for pure
 * record files with their own rules). Everything else is tier-0.
 *
 * @param {string[]} paths
 * @param {{ tier1?: string[], tier1RecordExempt?: string[], tier2?: string[] }} tierGlobs
 * @returns {{ tier: "tier-0"|"tier-1"|"tier-2", tier1Paths: string[], tier2Paths: string[] }}
 */
export function classifyTier(paths, tierGlobs) {
  const tier1 = (tierGlobs.tier1 ?? []).map(globToRegExp);
  const tier1Exempt = (tierGlobs.tier1RecordExempt ?? []).map(globToRegExp);
  const tier2 = (tierGlobs.tier2 ?? []).map(globToRegExp);

  const tier1Paths = [];
  const tier2Paths = [];
  for (const p of paths) {
    if (tier2.some((re) => re.test(p))) {
      tier2Paths.push(p);
      continue;
    }
    if (tier1.some((re) => re.test(p)) && !tier1Exempt.some((re) => re.test(p))) {
      tier1Paths.push(p);
    }
  }

  const tier = tier2Paths.length > 0 ? "tier-2" : tier1Paths.length > 0 ? "tier-1" : "tier-0";
  return { tier, tier1Paths, tier2Paths };
}

const REVIEW_RECORD_MARKER = "foundry-review-record";
const REVIEW_RECORD_BLOCK = /<!--\s*foundry-review-record\s*([\s\S]*?)-->/g;

/**
 * Extracts every `foundry-review-record` block (docs/contracts/review-record.json)
 * from a set of PR comment bodies. A block that is not valid JSON is kept
 * as `{ _parseError: true }` so callers can report it rather than silently
 * dropping malformed input.
 * @param {Array<{ body?: string, createdAt?: string }>} comments
 * @returns {Array<Record<string, unknown>>}
 */
export function parseReviewRecordComments(comments) {
  const records = [];
  for (const comment of comments ?? []) {
    const body = typeof comment?.body === "string" ? comment.body : "";
    if (!body.includes(REVIEW_RECORD_MARKER)) continue;
    REVIEW_RECORD_BLOCK.lastIndex = 0;
    let match;
    while ((match = REVIEW_RECORD_BLOCK.exec(body))) {
      try {
        const parsed = JSON.parse(match[1]);
        records.push({ ...parsed, _commentCreatedAt: comment.createdAt ?? null });
      } catch {
        records.push({ _parseError: true, _commentCreatedAt: comment.createdAt ?? null });
      }
    }
  }
  return records;
}

const REVIEWER_STATES = new Set(["approved", "changes-requested", "reject", "commented"]);
const DEPTHS = new Set(["primary", "secondary"]);

/**
 * Shape validation for one parsed review-record comment block against
 * docs/contracts/review-record.json's `requiredFields`. Returns `false` for
 * anything malformed rather than throwing -- an invalid record is simply
 * not counted, the same fail-closed choice `isValidReviewRecord`'s callers
 * rely on throughout this module.
 * @param {Record<string, unknown>} record
 */
export function isValidReviewRecord(record) {
  if (!record || record._parseError) return false;
  if (record.schemaVersion !== 1) return false;
  if (record.role !== "author" && record.role !== "reviewer") return false;
  for (const field of ["id", "reviewerId", "instanceId", "provider", "submittedAt", "state", "headSha"]) {
    if (typeof record[field] !== "string" || record[field].length === 0) return false;
  }
  if (record.role === "author") {
    return record.state === "declared";
  }
  // role === "reviewer"
  if (!REVIEWER_STATES.has(record.state)) return false;
  if (!DEPTHS.has(record.depth)) return false;
  if (typeof record.model !== "string" || record.model.length === 0) return false;
  return true;
}

/**
 * Filters to valid, current-head records, then keeps only the LATEST
 * `submittedAt` per (role, instanceId) pair -- an instance's later comment
 * at the same head supersedes its own earlier one, matching the staleness
 * discipline #1311 established for native GitHub reviews (docs/contracts/
 * review-record.json's own "STALENESS" note).
 * @param {Array<Record<string, unknown>>} records
 * @param {string} headSha
 */
export function selectCurrentReviewRecords(records, headSha) {
  const atHead = records.filter((r) => isValidReviewRecord(r) && r.headSha === headSha);
  const latest = new Map();
  for (const r of atHead) {
    const key = `${r.role}:${r.instanceId}`;
    const prev = latest.get(key);
    if (!prev || String(r.submittedAt) > String(prev.submittedAt)) latest.set(key, r);
  }
  return [...latest.values()];
}

/**
 * Tier-1 independence (governance/review-tiers.json's `tier1.review`):
 * exactly the rule at #1187 comment 5800142871, applied to
 * `foundry-review-record` comments instead of native GitHub reviews (see
 * docs/contracts/review-record.json's header for why). Requires a current
 * author record; at least two current reviewer records whose `instanceId`
 * differs from the author's AND from each other's; at least one such pair
 * differing in `model` or `provider`; and that pair's `state` is neither
 * `reject` nor `changes-requested`.
 * @param {{ records: Array<Record<string, unknown>>, headSha: string }} input
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluateTier1Independence({ records, headSha }) {
  const current = selectCurrentReviewRecords(records, headSha);
  const author = current.find((r) => r.role === "author");
  if (!author) {
    return {
      ok: false,
      reason:
        'no current-head role:"author" foundry-review-record found -- tier-1 independence cannot be evaluated without the author declaring their own instanceId (docs/contracts/review-record.json)',
    };
  }

  const reviewers = current.filter((r) => r.role === "reviewer");
  const independent = reviewers.filter((r) => r.instanceId !== author.instanceId);

  const clean = independent.filter((r) => r.state !== "reject" && r.state !== "changes-requested");
  for (let i = 0; i < clean.length; i++) {
    for (let j = i + 1; j < clean.length; j++) {
      const a = clean[i];
      const b = clean[j];
      if (a.instanceId === b.instanceId) continue;
      if (a.model === b.model && a.provider === b.provider) continue;
      return { ok: true, reason: `tier-1 independence satisfied by ${a.instanceId} and ${b.instanceId}` };
    }
  }

  const rejecting = independent.filter((r) => r.state === "reject" || r.state === "changes-requested");
  if (rejecting.length > 0) {
    return {
      ok: false,
      reason: `${rejecting.length} independent review record(s) at the current head carry state reject/changes-requested; tier-1 requires a qualifying pair with neither verdict`,
    };
  }

  return {
    ok: false,
    reason: `tier-1 requires at least 2 independent reviewer records (distinct instanceId, distinct from the author, differing in model or provider); found ${independent.length} independent, ${current.length - independent.length - 1 >= 0 ? current.length - independent.length - 1 : 0} excluded as the author's own instance`,
  };
}

/**
 * Tier-2 gate (governance/review-tiers.json's `tier2.requiresOwnerDecisionRecord`):
 * at least one governance/decisions/*.json record with `status: "decided"`,
 * `decidedBy: "owner"`, an `expiry` that is null or in the future, and
 * linked to this change either by pull-request number (`links.pullRequests`)
 * or by a set of path globs (`links.paths`) covering every tier-2 path the
 * pull request touches.
 * @param {{ decisionRecords: Array<Record<string, unknown>>, prNumber: string|number, tier2Paths: string[], now?: Date }} input
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluateTier2Decision({ decisionRecords, prNumber, tier2Paths, now = new Date() }) {
  const nowMs = now.getTime();
  const candidates = (decisionRecords ?? []).filter((record) => {
    if (record?.status !== "decided") return false;
    if (record?.decidedBy !== "owner") return false;
    if (typeof record?.expiry === "string") {
      const t = Date.parse(record.expiry);
      if (Number.isFinite(t) && t <= nowMs) return false;
    }
    return true;
  });

  const byPr = candidates.filter((record) => (record.links?.pullRequests ?? []).map(String).includes(String(prNumber)));
  if (byPr.length > 0) {
    return { ok: true, reason: `tier-2 authorized by decision record ${byPr[0].id} (linked to PR #${prNumber})` };
  }

  const byPaths = candidates.find((record) => {
    const globs = (record.links?.paths ?? []).map(globToRegExp);
    if (globs.length === 0) return false;
    return tier2Paths.every((p) => globs.some((re) => re.test(p)));
  });
  if (byPaths) {
    return { ok: true, reason: `tier-2 authorized by decision record ${byPaths.id} (path-linked)` };
  }

  return {
    ok: false,
    reason:
      "no decided, owner-approved, unexpired governance/decisions/ record links this pull request (by PR number or by covering every tier-2 path changed) -- tier-2 requires an owner decision record",
  };
}

/**
 * Combines the tier-1 independence result and, for tier-2, the owner
 * decision-record result, into one verdict for a classified pull request.
 * Tier-0 always passes without fetching any review evidence at all.
 * @param {{ tier: string, tier2Paths: string[] }} classification
 * @param {{ records: Array<Record<string, unknown>>, headSha: string, decisionRecords: Array<Record<string, unknown>>, prNumber: string|number, now?: Date }} evidence
 * @returns {{ ok: boolean, tier: string, reason: string }}
 */
export function evaluateTierGate(classification, evidence) {
  if (classification.tier === "tier-0") {
    return { ok: true, tier: "tier-0", reason: "no tier-1/tier-2 paths changed" };
  }

  const independence = evaluateTier1Independence({ records: evidence.records, headSha: evidence.headSha });
  if (!independence.ok) {
    return { ok: false, tier: classification.tier, reason: `tier-1 review requirement not met: ${independence.reason}` };
  }

  if (classification.tier === "tier-2") {
    const decision = evaluateTier2Decision({
      decisionRecords: evidence.decisionRecords,
      prNumber: evidence.prNumber,
      tier2Paths: classification.tier2Paths,
      now: evidence.now,
    });
    if (!decision.ok) {
      return { ok: false, tier: "tier-2", reason: `tier-2 owner-decision requirement not met: ${decision.reason}` };
    }
    return { ok: true, tier: "tier-2", reason: `${independence.reason}; ${decision.reason}` };
  }

  return { ok: true, tier: "tier-1", reason: independence.reason };
}

/**
 * @param {{ branch: string, afterPr: number|string }} param0
 */
export function restackCommitMessage({ branch, afterPr }) {
  return `Restack ${branch} onto origin/main after PR #${afterPr}`;
}

function defaultGhPrView(pr, fields) {
  const out = execFileSync(
    "gh",
    ["pr", "view", String(pr), "--json", fields.join(",")],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

function defaultNameWithOwner() {
  return execFileSync(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
    { encoding: "utf8" },
  ).trim();
}

/**
 * Live network call, kept out of the pure policy above and injectable at
 * every call site, the same discipline check-gate-efficacy.mjs and
 * check-attestation-freshness.mjs already use for a live ruleset dependency.
 */
function defaultFetchRequiredContexts(branch, { nameWithOwner = defaultNameWithOwner } = {}) {
  const nwo = nameWithOwner();
  const out = execFileSync(
    "gh",
    ["api", `repos/${nwo}/rules/branches/${branch}`],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return extractRequiredContexts(JSON.parse(out));
}

/** Live network call: every changed-file path for a pull request, the caller's own claim (gh pr view --json files). */
function defaultFetchPrFiles(pr) {
  const out = execFileSync(
    "gh",
    ["pr", "view", String(pr), "--json", "files"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const { files } = JSON.parse(out);
  return (files ?? []).map((f) => f.path).filter((p) => typeof p === "string" && p.length > 0);
}

/**
 * Live network call: every issue-style comment on a pull request
 * (`foundry-review-record` blocks are posted as ordinary PR comments, not
 * native GitHub reviews -- see docs/contracts/review-record.json for why).
 * `gh api ... --paginate` flattens every page into one JSON array before
 * this function ever sees it.
 */
function defaultFetchPrComments(pr, { nameWithOwner = defaultNameWithOwner } = {}) {
  const nwo = nameWithOwner();
  const out = execFileSync(
    "gh",
    ["api", `repos/${nwo}/issues/${pr}/comments`, "--paginate"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

/** Reads governance/review-tiers.json from this checkout's repository root. */
function defaultReadReviewTierConfig() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const raw = readFileSync(join(repoRoot, "governance", "review-tiers.json"), "utf8");
  const config = JSON.parse(raw);
  return {
    tier1: config.tier1?.globs ?? [],
    tier1RecordExempt: config.tier1RecordExempt?.globs ?? [],
    tier2: config.tier2?.globs ?? [],
  };
}

/** Reads every governance/decisions/*.json record from this checkout's repository root. */
function defaultReadDecisionRecords() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = join(repoRoot, "governance", "decisions");
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files.map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")));
}

function prViewToCanMergeInput(view, requiredContexts) {
  const rollup = view.statusCheckRollup ?? [];
  const checks = rollup.map((entry) => ({
    name: entry.name ?? entry.context ?? "",
    status: entry.status,
    conclusion: entry.conclusion ?? null,
  }));
  return {
    mergeable: view.mergeable,
    mergeStateStatus: view.mergeStateStatus,
    isDraft: view.isDraft,
    checks,
    requiredContexts,
  };
}

function runStatus(
  pr,
  {
    ghPrView = defaultGhPrView,
    fetchRequiredContexts = defaultFetchRequiredContexts,
    fetchPrFiles = defaultFetchPrFiles,
    fetchPrComments = defaultFetchPrComments,
    readReviewTierConfig = defaultReadReviewTierConfig,
    readDecisionRecords = defaultReadDecisionRecords,
  } = {},
) {
  const view = ghPrView(pr, [
    "mergeable",
    "mergeStateStatus",
    "isDraft",
    "statusCheckRollup",
    "headRefName",
    "baseRefName",
    "headRefOid",
  ]);
  const requiredContexts = fetchRequiredContexts(view.baseRefName || "main");
  const mergeVerdict = canMerge(prViewToCanMergeInput(view, requiredContexts));

  const paths = fetchPrFiles(pr);
  const classification = classifyTier(paths, readReviewTierConfig());
  const tierVerdict =
    classification.tier === "tier-0"
      ? evaluateTierGate(classification, {})
      : evaluateTierGate(classification, {
          records: parseReviewRecordComments(fetchPrComments(pr)),
          headSha: view.headRefOid,
          decisionRecords: readDecisionRecords(),
          prNumber: pr,
        });

  const ok = mergeVerdict.ok && tierVerdict.ok;
  const reason = mergeVerdict.ok
    ? tierVerdict.reason
    : tierVerdict.ok
      ? mergeVerdict.reason
      : `${mergeVerdict.reason}; ${tierVerdict.reason}`;

  return { pr: Number(pr), headRefName: view.headRefName, ok, reason, tier: classification.tier };
}

function runMerge(
  pr,
  {
    ghPrView = defaultGhPrView,
    fetchRequiredContexts = defaultFetchRequiredContexts,
    fetchPrFiles = defaultFetchPrFiles,
    fetchPrComments = defaultFetchPrComments,
    readReviewTierConfig = defaultReadReviewTierConfig,
    readDecisionRecords = defaultReadDecisionRecords,
    ghExec = execFileSync,
  } = {},
) {
  const status = runStatus(pr, {
    ghPrView,
    fetchRequiredContexts,
    fetchPrFiles,
    fetchPrComments,
    readReviewTierConfig,
    readDecisionRecords,
  });
  if (!status.ok) {
    console.error(status.reason);
    process.exitCode = 1;
    return status;
  }
  ghExec("gh", ["pr", "merge", String(pr), "--merge"], { encoding: "utf8", stdio: "inherit" });
  return status;
}

function runRestack(pr, worktree, { gitExec = execFileSync } = {}) {
  const view = defaultGhPrView(pr, ["headRefName"]);
  const branch = view.headRefName;
  if (!branch) throw new Error(`could not resolve head branch for PR #${pr}`);
  const message = restackCommitMessage({ branch, afterPr: pr });
  gitExec("git", ["-C", worktree, "fetch", "origin", "main"], { encoding: "utf8", stdio: "inherit" });
  gitExec("git", ["-C", worktree, "checkout", branch], { encoding: "utf8", stdio: "inherit" });
  gitExec("git", ["-C", worktree, "merge", "origin/main", "-m", message], { encoding: "utf8", stdio: "inherit" });
  gitExec("git", ["-C", worktree, "push", "origin", branch], { encoding: "utf8", stdio: "inherit" });
  return { pr: Number(pr), branch, message };
}

function main() {
  const { values, positionals } = parseArgs({
    options: {
      status: { type: "boolean", default: false },
      merge: { type: "boolean", default: false },
      restack: { type: "boolean", default: false },
      worktree: { type: "string" },
    },
    allowPositionals: true,
  });

  const pr = positionals[0];
  if (!pr) {
    console.error("usage: land-stack.mjs --status|--merge|--restack <pr> [--worktree <path>]");
    process.exitCode = 2;
    return;
  }

  if (values.status) {
    console.log(JSON.stringify(runStatus(pr), null, 2));
    return;
  }
  if (values.merge) {
    const result = runMerge(pr);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (values.restack) {
    if (!values.worktree) {
      console.error("--restack requires --worktree <path>");
      process.exitCode = 2;
      return;
    }
    console.log(JSON.stringify(runRestack(pr, values.worktree), null, 2));
    return;
  }

  console.error("specify one of --status, --merge, --restack");
  process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
