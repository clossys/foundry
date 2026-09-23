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
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { validateDecisionRecordShape, isRelaxationPastSunset } from "./check-decision-records.mjs";

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

/**
 * Builds the full path set `classifyTier` (and `evaluateChangedDecisionRecords`)
 * should be fed, from the raw per-file entries the Pulls API returns:
 * BOTH the new `filename` and, when the file was renamed, the OLD
 * `previousFilename`. #1187 review at df15ab87, blocking finding 1: moving
 * `scripts/land-stack.mjs` to `scripts/old/land-stack.mjs`, or a workflow
 * file to a `.off` extension, classified as tier-0 when only the new path
 * was ever checked -- the move itself was the whole change, and its old
 * (tier-1/tier-2) path was never looked at. Feeding both names into the
 * same union-over-paths, max-over-tiers classifier `classifyTier` already
 * runs makes a rename classify at whichever tier EITHER name would reach on
 * its own, which is exactly the safe direction: a rename can raise a
 * change's tier, never lower it below what its old path alone would have
 * demanded.
 *
 * Deliberately separate from the plain filename list `verifyChangedFilesComplete`
 * checks against the PR's own `changedFiles` count -- that count is
 * per-FILE-CHANGE (a rename is one changed file, not two), so it must never
 * see the doubled classification list.
 * @param {Array<{ filename: string, previousFilename?: string|null }>} fileEntries
 * @returns {string[]}
 */
export function changedFilePathsForClassification(fileEntries) {
  const paths = [];
  for (const f of fileEntries ?? []) {
    if (typeof f?.filename === "string" && f.filename.length > 0) paths.push(f.filename);
    if (typeof f?.previousFilename === "string" && f.previousFilename.length > 0) paths.push(f.previousFilename);
  }
  return paths;
}

// Matches every scripts/**/*.mjs, .github/**/*.{mjs,cjs,js,json}, and
// .root-entry-policy.json token anywhere in a workflow file's text -- a
// coarse net (matches `run:` steps, `uses:` references, and comments
// alike), the same trade-off scripts/check-workflow-references.test.mjs's
// own detection already accepts, deliberately erring toward over-matching.
const WORKFLOW_REFERENCED_PATH_PATTERN = /(?:\.github\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.(?:mjs|cjs|js|json)|scripts(?:\/[A-Za-z0-9._-]+)+\.mjs|\.root-entry-policy\.json)/g;

/**
 * Every gate-relevant script or JSON-config path referenced anywhere in a
 * workflow file's text. `findUnclassifiedWorkflowPaths` below is what
 * actually matters; this is just its raw material.
 * @param {string} workflowText
 * @returns {string[]}
 */
export function extractWorkflowReferencedPaths(workflowText) {
  return [...new Set(String(workflowText ?? "").match(WORKFLOW_REFERENCED_PATH_PATTERN) ?? [])];
}

/**
 * The subset of `extractWorkflowReferencedPaths`' output that `classifyTier`
 * (against the REAL `governance/review-tiers.json`) would still call
 * tier-0. Anything a workflow can execute or read must be reviewable code
 * or config by definition -- a non-empty result here means this
 * repository's own workflows can reach gate-critical code with zero review
 * evidence required (#1187 review round 4, blocking finding 1). The
 * `land-stack.test.mjs` test of the same name runs this against every real
 * `.github/workflows/*.yml` file and the real tier config, so a workflow
 * that starts invoking a new, unclassified script fails a test rather than
 * silently landing unreviewable.
 * @param {string} workflowText
 * @param {{ tier1?: string[], tier1RecordExempt?: string[], tier2?: string[] }} tierGlobs
 * @returns {string[]}
 */
export function findUnclassifiedWorkflowPaths(workflowText, tierGlobs) {
  return extractWorkflowReferencedPaths(workflowText).filter((p) => classifyTier([p], tierGlobs).tier === "tier-0");
}

const REVIEW_RECORD_MARKER = "foundry-review-record";

/**
 * Positive-grammar scan for `foundry-review-record` blocks (#1187 review
 * round 5, blocking finding 2, both reviewers -- REPLACES the round-4
 * strip-then-regex approach entirely, which both reviewers independently
 * broke: 4-space/tab-indented JSON had its field lines deleted by the
 * indented-code-block rule, leaving `{}` -- a clean parse that matched
 * nothing, so a real reject silently vanished; a fenced or quoted reject
 * was silently dropped with no signal; and editing a reject INTO a fence
 * or quote bypassed the edited-at-head check entirely, since no record
 * survived stripping to be checked in the first place).
 *
 * A block counts ONLY when:
 *   - its `<!-- foundry-review-record` opener line starts at column 0 --
 *     no leading whitespace at all. This alone excludes every blockquote
 *     line (always prefixed `>`) and every classic indented-code-block
 *     line (4+ leading spaces or a tab), with no separate "strip indented
 *     lines" pass needed -- and unlike stripping, it never touches or
 *     deletes the JSON body between the markers, so ANY indentation
 *     inside a genuine block survives untouched.
 *   - it is not inside an open fenced code block (``` or ~~~, tracked line
 *     by line, CommonMark-style: 0-3 leading spaces before the fence
 *     marker) or an open `<details>`/`<pre>` region (tracked the same way).
 *   - a closing `-->` is actually found (on the opener line itself, or on
 *     a later line) before the comment body ends -- "closer intact".
 *
 * The JSON body is EVERYTHING between the two markers, taken byte-for-byte
 * with no markdown-aware rewriting at all, and handed directly to
 * `JSON.parse` -- arbitrary indentation is fine because JSON.parse itself
 * does not care about whitespace ("Parse the JSON body with a real JSON
 * parser, so any indentation works"). Nothing here can delete or reassemble
 * text the way regex stripping could (closing the inline-code-span
 * reassembly attack one review round-5 review raised, by construction: this
 * function never removes or rejoins any text at all).
 * @param {string} rawBody
 * @returns {Array<{ raw: string|null, valid: boolean }>} `valid: true` with
 *   `raw` set to the inner text when a genuine opener AND a closer were
 *   both found; `valid: false` (`raw: null`) when a genuine opener was
 *   found but the comment body ended with no closer -- a malformed,
 *   truncated block that must still be reported, never silently ignored.
 */
export function findReviewRecordBlocks(rawBody) {
  const lines = String(rawBody ?? "").split("\n");
  const blocks = [];
  let fenceChar = null;
  let fenceLen = 0;
  let detailsDepth = 0;
  let preDepth = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (fenceChar) {
      const closeMatch = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
      }
      i++;
      continue;
    }
    const openFence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (openFence) {
      fenceChar = openFence[1][0];
      fenceLen = openFence[1].length;
      i++;
      continue;
    }
    if (/^\s*<details\b/i.test(line)) {
      detailsDepth++;
      i++;
      continue;
    }
    if (/^\s*<\/details>/i.test(line)) {
      detailsDepth = Math.max(0, detailsDepth - 1);
      i++;
      continue;
    }
    if (/^\s*<pre\b/i.test(line)) {
      preDepth++;
      i++;
      continue;
    }
    if (/^\s*<\/pre>/i.test(line)) {
      preDepth = Math.max(0, preDepth - 1);
      i++;
      continue;
    }
    if (detailsDepth === 0 && preDepth === 0 && /^<!--\s*foundry-review-record\b/.test(line)) {
      const sameLineRest = line.replace(/^<!--\s*foundry-review-record\b/, "");
      if (sameLineRest.includes("-->")) {
        blocks.push({ raw: sameLineRest.slice(0, sameLineRest.indexOf("-->")), valid: true });
        i++;
        continue;
      }
      const bodyLines = [sameLineRest];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const inner = lines[j];
        if (inner.includes("-->")) {
          bodyLines.push(inner.slice(0, inner.indexOf("-->")));
          closed = true;
          j++;
          break;
        }
        bodyLines.push(inner);
        j++;
      }
      if (closed) {
        blocks.push({ raw: bodyLines.join("\n"), valid: true });
        i = j;
      } else {
        blocks.push({ raw: null, valid: false });
        i = lines.length;
      }
      continue;
    }
    i++;
  }
  return blocks;
}

/**
 * Extracts every `foundry-review-record` block from a set of PR comment
 * bodies via `findReviewRecordBlocks`'s positive grammar. A block that is
 * not valid JSON, OR that was never a genuine column-0/unfenced block at
 * all despite the marker text appearing SOMEWHERE in the comment
 * (fenced, quoted, indented, mid-sentence, malformed -- #1187 review round
 * 5, blocking finding 2: "Any authorized comment containing a record-like
 * marker ... that doesn't parse as a valid record must REFUSE the gate,
 * never be silently dropped. That covers fenced, quoted, indented and
 * malformed markers"), is kept as `{ _parseError: true }` so
 * `findSuspiciousRecordComments` can refuse the gate over it rather than
 * silently treating the comment as having said nothing. This is a real,
 * accepted trade-off, not a bug: an AUTHORIZED comment that merely
 * illustrates or discusses the marker syntax (this very review thread's
 * own comments, or this repository's own contract example) now also
 * refuses the gate. Under `governance/review-tiers.json`'s
 * `"report-only"` default `enforcement` mode, that refusal is reported,
 * not enforced -- see `applyEnforcement`.
 *
 * `comments` must already carry an `authorization` field per comment, one
 * of `"authorized"`, `"unauthorized"`, or `"unknown"` (set by
 * `defaultAnnotateCommentAuthorization` or an equivalent caller) -- this
 * function stays pure and never makes the authorization call itself; it
 * only reads the value the caller resolved. A comment with no
 * `authorization` field at all is treated as `"unauthorized"`, not trusted
 * by default. `"unknown"` (the permission LOOKUP itself failed) is
 * deliberately distinct from `"unauthorized"` (the lookup succeeded and
 * said no) -- `findSuspiciousRecordComments` refuses the whole gate on
 * `"unknown"`, for any record, rather than guessing either direction.
 * @param {Array<{ body?: string, created_at?: string, updated_at?: string, authorization?: "authorized"|"unauthorized"|"unknown" }>} comments
 * @returns {Array<Record<string, unknown>>}
 */
export function parseReviewRecordComments(comments) {
  const records = [];
  for (const comment of comments ?? []) {
    const rawBody = typeof comment?.body === "string" ? comment.body : "";
    if (!rawBody.includes(REVIEW_RECORD_MARKER)) continue;
    // GitHub's REST payload (gh api .../comments) uses snake_case
    // (created_at/updated_at); the earlier camelCase read here was always
    // populating null. Both spellings are accepted so this also works
    // against a GraphQL-shaped or hand-built fixture in tests.
    const createdAt = comment.created_at ?? comment.createdAt ?? null;
    const updatedAt = comment.updated_at ?? comment.updatedAt ?? null;
    // A comment edited after it was posted is untrusted for an APPROVAL --
    // this module has no way to tell "fixed a typo" from "changed the
    // verdict after the fact" apart. It is deliberately NOT dropped here,
    // though: `findStickyRejections` and `findSuspiciousRecordComments`
    // below both need to see it, because an edited comment containing a
    // reject must still block, and an edited comment at all refuses the
    // whole gate rather than being silently ignored. KNOWN LIMITATION: this
    // only detects an edit whose CURRENT body still shows `updated_at !==
    // created_at`; a comment edited to remove the marker text entirely is
    // indistinguishable, from this API response alone, from one that never
    // had it -- reconstructing that would need GitHub's comment revision
    // history, which this slice does not fetch. See docs/HITL.md.
    const edited = Boolean(createdAt && updatedAt && createdAt !== updatedAt);
    const authorization = ["authorized", "unauthorized", "unknown"].includes(comment.authorization) ? comment.authorization : "unauthorized";

    const blocks = findReviewRecordBlocks(rawBody);
    if (blocks.length === 0) {
      // The marker text is present somewhere in the raw body (the
      // `.includes(REVIEW_RECORD_MARKER)` check above already confirmed
      // that), but never as a genuine column-0, unfenced, closed block.
      records.push({ _parseError: true, _commentCreatedAt: createdAt, _edited: edited, _authorization: authorization });
      continue;
    }
    for (const block of blocks) {
      if (!block.valid) {
        records.push({ _parseError: true, _commentCreatedAt: createdAt, _edited: edited, _authorization: authorization });
        continue;
      }
      try {
        const parsed = JSON.parse(block.raw);
        records.push({ ...parsed, _commentCreatedAt: createdAt, _edited: edited, _authorization: authorization });
      } catch {
        records.push({ _parseError: true, _commentCreatedAt: createdAt, _edited: edited, _authorization: authorization });
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
 * rely on throughout this module. A record from an edited comment
 * (`_edited: true`), a comment whose authorization is anything other than
 * exactly `"authorized"` (`"unauthorized"` OR `"unknown"` -- only a
 * confirmed admin/write collaborator's comment may ever count as an
 * approval), or with an unparseable `submittedAt` is invalid too. This is
 * the gate for ORDINARY (approval / author-declaration) records; a
 * reject/changes-requested record is evaluated separately by
 * `findStickyRejections`, which deliberately does NOT route through this
 * function -- see that function's own doc comment for why a malformed or
 * edited reject must still block.
 * @param {Record<string, unknown>} record
 */
export function isValidReviewRecord(record) {
  if (!record || record._parseError || record._edited || record._authorization !== "authorized") return false;
  if (record.schemaVersion !== 1) return false;
  if (record.role !== "author" && record.role !== "reviewer") return false;
  for (const field of ["id", "reviewerId", "instanceId", "provider", "submittedAt", "state", "headSha"]) {
    if (typeof record[field] !== "string" || record[field].length === 0) return false;
  }
  if (!Number.isFinite(Date.parse(record.submittedAt))) return false;
  if (!Number.isFinite(Date.parse(record._commentCreatedAt))) return false;
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
 * comment per (role, instanceId) pair -- an instance's later comment at the
 * same head supersedes its own earlier one, matching the staleness
 * discipline #1311 established for native GitHub reviews (docs/contracts/
 * review-record.json's own "STALENESS" note). Ordered by the COMMENT'S OWN
 * `_commentCreatedAt` (GitHub-assigned, not editable by the poster), never
 * by the record's self-declared `submittedAt` -- a self-declared timestamp
 * could otherwise be backdated or postdated to win or lose a supersession
 * race on purpose. `isValidReviewRecord` already guarantees every record
 * reaching this point has a parseable `_commentCreatedAt`. This EXACT
 * (case-sensitive, non-prefix) `headSha` match is intentionally strict --
 * unlike `findStickyRejections`' deliberately lenient matching below, an
 * approval that cannot be confirmed as exactly current does not count,
 * which is the conservative direction for evidence that GRANTS clearance.
 * @param {Array<Record<string, unknown>>} records
 * @param {string} headSha
 */
export function selectCurrentReviewRecords(records, headSha) {
  const atHead = records.filter((r) => isValidReviewRecord(r) && r.headSha === headSha);
  const latest = new Map();
  for (const r of atHead) {
    const key = `${r.role}:${r.instanceId}`;
    const prev = latest.get(key);
    if (!prev || Date.parse(r._commentCreatedAt) > Date.parse(prev._commentCreatedAt)) latest.set(key, r);
  }
  return [...latest.values()];
}

/**
 * Whether a candidate `headSha` (as a reviewer might actually write it --
 * possibly a short prefix, possibly uppercase) should be read as naming the
 * CURRENT head, for the specific, narrow purpose of deciding whether a
 * reject/changes-requested record is stale. Case-insensitive, and treats
 * any candidate of 7 or more hex characters that is a genuine prefix of the
 * current head as a match (#1187 review round 4, blocking finding 3b).
 * This is deliberately LENIENT where `selectCurrentReviewRecords` above is
 * strict: erring toward "this reject IS current" is the safe direction for
 * evidence that BLOCKS a merge, the mirror image of why approval matching
 * stays exact.
 * @param {unknown} candidateHeadSha
 * @param {string} currentHeadSha
 */
export function isCurrentHeadShaForReject(candidateHeadSha, currentHeadSha) {
  if (typeof candidateHeadSha !== "string" || candidateHeadSha.length < 7) return false;
  if (typeof currentHeadSha !== "string" || currentHeadSha.length === 0) return false;
  const candidate = candidateHeadSha.toLowerCase();
  const current = currentHeadSha.toLowerCase();
  return current.startsWith(candidate);
}

/**
 * Normalizes a `state` value for spelling-insensitive comparison:
 * lowercase, underscores folded to hyphens (so GitHub's own
 * `changes_requested` spelling compares equal to this repository's
 * `changes-requested`). #1187 review round 5, should-fix 3.
 * @param {unknown} state
 */
function normalizeStateSpelling(state) {
  return String(state ?? "").toLowerCase().replace(/_/g, "-");
}

/**
 * Every spelling this module recognizes as a REJECT, after
 * `normalizeStateSpelling` -- `"reject"`, `"rejected"` (a natural English
 * variant), and `"changes-requested"` (which also covers GitHub's own
 * `changes_requested` once normalized). #1187 review round 5, should-fix 3:
 * "Also accept the reject spellings changes_requested, changes-requested
 * and rejected, case-insensitively."
 */
const REJECT_STATE_SPELLINGS = new Set(["reject", "rejected", "changes-requested"]);

/** Every `state` spelling this module recognizes at all (approval-path values plus every reject spelling), after `normalizeStateSpelling`. */
const KNOWN_STATE_SPELLINGS = new Set(["approved", "commented", ...REJECT_STATE_SPELLINGS]);

/**
 * ANY record block from an AUTHORIZED comment that could not be trusted as
 * an ordinary approval/author record -- an unparseable JSON block, a
 * well-formed one from a comment edited after posting, or a reject/
 * changes-requested whose `headSha` is missing entirely -- refuses the
 * WHOLE tier-1 gate rather than being silently dropped and worked around.
 * Silently dropping and continuing would let a tampered or garbled comment
 * simply be out-voted by other, untouched comments -- exactly the
 * "quietly work around it" failure this check exists to close.
 *
 * AN UNAUTHORIZED COMMENT IS NEVER SUSPICIOUS, WHATEVER IT CONTAINS (#1187
 * review round 4, blocking finding 1/2 -- BOTH independent reviewers found
 * the SAME hole in the same place: an earlier draft of this function
 * checked `_parseError`/`_edited` before ever looking at `_authorization`,
 * so a stranger with no write access to this repository could permanently
 * refuse every tier-1/tier-2 pull request by posting one malformed
 * `foundry-review-record` comment, or by posting one and then editing it.
 * A record whose comment is unauthorized can never count toward anything
 * -- approval OR suspicion -- so filtering it out costs nothing and closes
 * a denial-of-service vector on a public repository. `_authorization ===
 * "unknown"` (the permission lookup itself failed, not a confirmed "no")
 * is the one exception: it is ALWAYS suspicious, for every record, checked
 * FIRST, before the authorized/unauthorized split -- #1187 review round 4,
 * blocking finding 3a found that collapsing a failed lookup into a
 * confirmed "no" silently dropped a genuine reject this module simply
 * could not verify. Refusing the whole gate whenever any permission check
 * could not be resolved is simpler and safer than reasoning per-record
 * about which failures matter.
 *
 * Among AUTHORIZED records: a `_parseError` record carries no `headSha` at
 * all (JSON.parse failed before any field could be read), so it is always
 * suspicious regardless of head -- there is no way to know it is stale. An
 * `_edited` record DOES parse and carry a `headSha`, so it is only
 * suspicious when it claims the CURRENT head (exact match); an edit to a
 * comment from a past, already-superseded round is not this pull
 * request's problem. A reject/changes-requested with NO `headSha` at all
 * cannot be placed at any head, current or stale (#1187 review round 4,
 * blocking finding 3c), so it is ALSO suspicious rather than silently
 * un-matched and dropped by `findStickyRejections`' lenient-but-still-a-
 * match requirement below.
 * @param {Array<Record<string, unknown>>} records
 * @param {string} headSha
 * @returns {Array<Record<string, unknown>>}
 */
export function findSuspiciousRecordComments(records, headSha) {
  return (records ?? []).filter((r) => {
    if (!r) return false;
    if (r._authorization === "unknown") return true;
    if (r._authorization !== "authorized") return false; // confirmed unauthorized: NEVER suspicious, whatever it contains
    if (r._parseError) return true;
    if (r._edited && r.headSha === headSha) return true;
    const state = normalizeStateSpelling(r?.state);
    if (REJECT_STATE_SPELLINGS.has(state) && (typeof r.headSha !== "string" || r.headSha.length === 0)) {
      return true;
    }
    // A reviewer-role record whose state is NEITHER a known approval-path
    // value NOR a recognized reject spelling, at (or near) the current
    // head, is ambiguous -- #1187 review round 5, should-fix 3: "Treat any
    // unrecognized state at the head as suspicious." Matched with the same
    // lenient, case-insensitive, 7+-character-prefix headSha rule
    // `findStickyRejections` uses for rejects, since an unrecognized
    // spelling could plausibly BE a reject typo, and erring toward
    // suspicion is the safe direction either way.
    if (r.role === "reviewer" && state.length > 0 && !KNOWN_STATE_SPELLINGS.has(state) && isCurrentHeadShaForReject(r.headSha, headSha)) {
      return true;
    }
    return false;
  });
}

/**
 * A `reject`/`changes-requested` record (matched CASE-INSENSITIVELY -- a
 * hand-typed `"Reject"` counts the same as `"reject"`; #1187 review round
 * 4, blocking finding 3d) from an AUTHORIZED comment
 * (`_authorization === "authorized"` -- exactly, never `"unknown"`, which
 * `findSuspiciousRecordComments` above already refuses the whole gate over)
 * at the current head -- matched via `isCurrentHeadShaForReject`'s lenient,
 * case-insensitive, 7+-character-prefix rule, not exact equality -- is
 * STICKY: it blocks the merge regardless of what else is wrong with the
 * record, and cannot be superseded by any later record, from the same
 * `instanceId` or otherwise. Concretely, unlike `isValidReviewRecord`'s
 * gate, this deliberately does NOT require `depth`/`model`/a parseable
 * `submittedAt`, and does NOT collapse to "latest per instanceId" the way
 * `selectCurrentReviewRecords` does for ordinary records -- a `reject` is
 * never something a later, self-declared "actually never mind" from the
 * same poster can undo. The only way to clear a sticky rejection in this
 * slice is a genuinely new head: a new commit gives every existing record,
 * reject included, a stale `headSha`. No decision-record override path
 * exists or is implemented here -- see docs/HITL.md's "Reject escalates to
 * the owner, but only within one head" section for the real consequence of
 * that.
 *
 * An UNAUTHORIZED comment's claimed reject is excluded here for the same
 * reason blocking finding 2 excludes it from approvals: on a public
 * repository, anyone could otherwise post a `reject` block and
 * permanently deny every pull request, which would be a denial-of-service
 * vector at least as serious as the forged-approval one this whole
 * mechanism exists to close.
 * @param {Array<Record<string, unknown>>} records
 * @param {string} headSha
 * @returns {Array<Record<string, unknown>>}
 */
export function findStickyRejections(records, headSha) {
  return (records ?? []).filter((r) => {
    if (!r || r._parseError) return false;
    if (r._authorization !== "authorized") return false;
    if (!REJECT_STATE_SPELLINGS.has(normalizeStateSpelling(r?.state))) return false;
    return isCurrentHeadShaForReject(r.headSha, headSha);
  });
}

/**
 * Tier-1 independence (governance/review-tiers.json's `tier1.review`):
 * the rule at #1187 comment 5800142871, applied to `foundry-review-record`
 * comments instead of native GitHub reviews (see docs/contracts/
 * review-record.json's header for why).
 *
 * Runs three checks, IN ORDER, before ever searching for a qualifying pair:
 *
 * 1. `findSuspiciousRecordComments` -- any edited-at-head, unparseable,
 *    unresolved-authorization, or headSha-less-reject record block refuses
 *    outright.
 * 2. `findStickyRejections` -- any authorized reject/changes-requested at
 *    (or unambiguously prefixing) the current head refuses outright,
 *    whatever else is wrong with it, and regardless of any later record
 *    claiming to supersede it. The decision-tier rule says "If they
 *    disagree, or either says reject, escalate to the owner with both
 *    positions" and lists "tier-1 reviewers disagree" under "escalate
 *    immediately, whatever the tier".
 * 3. Requires EXACTLY ONE current author record (more than one is
 *    ambiguous and refused outright, not silently resolved to "the first
 *    one found").
 *
 * Only once all three pass does this search for a qualifying pair: two
 * independent, `state: "approved"` records (`"commented"` never counts)
 * whose `instanceId` differs from the author's AND from each other's,
 * whose `depth` values are one `"primary"` and one `"secondary"`, and
 * which differ in `model` or `provider`.
 * @param {{ records: Array<Record<string, unknown>>, headSha: string }} input
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluateTier1Independence({ records, headSha }) {
  const suspicious = findSuspiciousRecordComments(records, headSha);
  if (suspicious.length > 0) {
    return {
      ok: false,
      reason: `${suspicious.length} edited-at-head, unparseable, unresolved-authorization, or headSha-less-reject foundry-review-record comment(s) found -- refusing rather than silently dropping them; remove or repost the comment(s), or retry once the permission check succeeds`,
    };
  }

  const stickyRejections = findStickyRejections(records, headSha);
  if (stickyRejections.length > 0) {
    return {
      ok: false,
      reason: `${stickyRejections.length} authorized review record(s) at the current head carry state reject/changes-requested -- sticky, never outvoted or superseded by a later record at this same head; only a new head clears it (${stickyRejections.map((r) => `${r.instanceId ?? "?"}:${r.state}`).join(", ")})`,
    };
  }

  const current = selectCurrentReviewRecords(records, headSha);
  const authors = current.filter((r) => r.role === "author");
  if (authors.length === 0) {
    return {
      ok: false,
      reason:
        'no current-head role:"author" foundry-review-record found -- tier-1 independence cannot be evaluated without the author declaring their own instanceId (docs/contracts/review-record.json)',
    };
  }
  if (authors.length > 1) {
    return {
      ok: false,
      reason: `${authors.length} current-head role:"author" records found (instanceIds: ${authors.map((a) => a.instanceId).join(", ")}) -- tier-1 independence requires exactly one, not "the first one found"`,
    };
  }
  const author = authors[0];

  const reviewers = current.filter((r) => r.role === "reviewer");
  const independent = reviewers.filter((r) => r.instanceId !== author.instanceId);
  const approved = independent.filter((r) => r.state === "approved");
  for (let i = 0; i < approved.length; i++) {
    for (let j = i + 1; j < approved.length; j++) {
      const a = approved[i];
      const b = approved[j];
      if (a.instanceId === b.instanceId) continue;
      const depthsPaired = (a.depth === "primary" && b.depth === "secondary") || (a.depth === "secondary" && b.depth === "primary");
      if (!depthsPaired) continue;
      if (a.model === b.model && a.provider === b.provider) continue;
      return { ok: true, reason: `tier-1 independence satisfied by ${a.instanceId} (${a.depth}) and ${b.instanceId} (${b.depth})` };
    }
  }

  return {
    ok: false,
    reason: `tier-1 requires one primary and one secondary independent record, both state "approved" (distinct instanceId, distinct from the author, differing in model or provider) -- found ${approved.length} independent approved record(s); "commented" records never count`,
  };
}

/**
 * Whether a path glob is broader than a real tier-2 glob is allowed to be,
 * when used to authorize a tier-2 change via a decision record's
 * `links.paths`. #1187 review at df15ab87, blocking finding 4: the prior
 * canary-path heuristic let `governance/**`, `.github/**`, `scripts/lib/**`
 * and any-YAML-file globs all pass as "not overbroad" -- none of those are
 * enumerable against a fixed small canary set. This is computed against the
 * ACTUAL tier config instead: an entry is accepted only when it is either
 * (a) a LITERAL path with no glob metacharacters (`*`/`?`) at all -- it can
 * name at most one file, so it cannot be "broad" -- or (b) EXACTLY EQUAL to
 * one of `tierConfig.tier2` 's own declared globs, i.e. already a path this
 * repository's own tier-2 declaration says is tier-2, verbatim. Anything
 * else -- including a glob that LOOKS narrower than an existing tier-2
 * glob, like `governance/model-qualifications/allowlist-*.json` -- is
 * rejected outright, per the review's own suggested fix: "require each
 * entry to be a literal path or exactly one of tier2.globs".
 * @param {string} glob
 * @param {{ tier2?: string[] }} tierConfig
 */
export function isOverbroadPathGlob(glob, tierConfig) {
  if (typeof glob !== "string" || glob.length === 0) return true;
  const tier2Globs = new Set(tierConfig?.tier2 ?? []);
  if (tier2Globs.has(glob)) return false;
  if (!/[*?]/.test(glob)) return false;
  return true;
}

/**
 * Tier-2 gate (governance/review-tiers.json's `tier2.requiresOwnerDecisionRecord`):
 * at least one governance/decisions/*.json record that is itself schema-valid
 * (`validateDecisionRecordShape`, scripts/check-decision-records.mjs --
 * "Run check-decision-records inside the gate"), `tier: "tier-2"` (a tier-1
 * record is never tier-2 authority), `status: "decided"`, `decidedBy: "owner"`,
 * not superseded by any other record, with an `expiry` that parses and is
 * in the future (an unparseable `expiry` is treated as already expired,
 * never as unexpired), not a relaxation past its own `sunset`
 * (`isRelaxationPastSunset`), and linked to this change either by:
 *
 * - pull-request number (`links.pullRequests`) PLUS a matching entry in
 *   `links.patchIds` (case-insensitive) equal to `patchId` -- the pull
 *   request's own net-diff patch id (`git patch-id --stable` of its
 *   three-dot diff against its base, computed fresh at evaluation time --
 *   see `defaultFetchPatchId`), NOT a pinned head sha. #1187 review round
 *   5, blocking finding 2 (reviewer 2): pinning a head sha, as an earlier
 *   draft of this function did, could NEVER be satisfied on a repository
 *   whose branch protection requires the base branch to be current --
 *   landing the record itself moves `main`, which makes the very PR it
 *   authorizes `BEHIND` and forces a restack, producing a new head the
 *   pin no longer matches, every single time. A patch id is invariant to
 *   a pure merge-from-base or restack (the merge commit contributes
 *   nothing to the three-dot diff) and changes only when the PR's OWN
 *   content changes -- so an authorization pinned to a patch id survives
 *   exactly the operations (restacks, merge-train rebasing) that made a
 *   head-sha pin unsatisfiable, while still breaking the instant real
 *   content changes. A PR-scoped authorization with NO `patchIds` at all
 *   never matches anything.
 * - a set of path globs (`links.paths`, each checked against
 *   `isOverbroadPathGlob` against THIS SAME `tierConfig`) covering every
 *   tier-2 path the pull request touches -- but ONLY when the record's own
 *   `expiry` is non-null (#1187 review round 4, should-fix: "a path-scoped
 *   authorization must carry a non-null expiry"). A `null` expiry paired
 *   with a path glob would otherwise pre-authorize every future change
 *   under that glob, forever, from one single owner decision -- a standing
 *   blank cheque, not a bounded authorization for the change it was
 *   actually written about.
 *
 * Each record's shape is validated against its EXPECTED id, taken from
 * `record._idFromFilename` when the caller set it (the real filename it was
 * read from on the base branch -- see `defaultReadDecisionRecords`) and
 * falling back to `record.id` only when no such association exists (a
 * fixture built without one). Falling back to `record.id` unconditionally,
 * as an earlier draft of this function did, made the id-vs-filename check
 * inside `validateDecisionRecordShape` vacuous for every real record.
 *
 * KNOWN LIMITATION, DOCUMENTED RATHER THAN SOLVED (#1187 review round 4,
 * should-fix: "A merge-train batch is authorized when its constituent PR
 * and head are authorized"): a merge-train batch pull request carries a
 * DIFFERENT PR number, and its own net diff is the union of every
 * constituent's changes, so it also carries a DIFFERENT patch id than any
 * original constituent PR a decision record might name. This function has
 * no notion of "constituent PRs" and does not attempt to resolve one PR's
 * authorization through another's -- a batch containing a tier-2 change
 * needs its OWN decision record (or its own fresh review), even when the
 * original constituent PR was already authorized. A future slice could
 * check each constituent's OWN patch id against its OWN prior
 * authorization, but that needs land-stack to know which PRs a batch
 * carries at all, which nothing in this slice resolves. See docs/HITL.md.
 * @param {{ decisionRecords: Array<Record<string, unknown>>, prNumber: string|number, patchId?: string, tier2Paths: string[], tierConfig: { tier2?: string[] }, now?: Date }} input
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluateTier2Decision({ decisionRecords, prNumber, patchId, tier2Paths, tierConfig, now = new Date() }) {
  const nowMs = now.getTime();
  const all = (decisionRecords ?? []).filter((r) => r && typeof r === "object" && !Array.isArray(r));

  const supersededIds = new Set();
  for (const r of all) {
    for (const s of Array.isArray(r.supersedes) ? r.supersedes : []) supersededIds.add(s);
  }

  const candidates = all.filter((record) => {
    const { _idFromFilename, ...recordForValidation } = record;
    const expectedId = _idFromFilename ?? record.id;
    if (validateDecisionRecordShape(recordForValidation, expectedId).length > 0) return false;
    if (record.status !== "decided") return false;
    if (record.decidedBy !== "owner") return false;
    if (record.tier !== "tier-2") return false;
    if (supersededIds.has(record.id)) return false;
    if (record.expiry !== null) {
      const t = Date.parse(record.expiry);
      if (!Number.isFinite(t) || t <= nowMs) return false; // unparseable or past -- both treated as expired
    }
    if (isRelaxationPastSunset(record, all, now)) return false;
    return true;
  });

  const byPr = candidates.filter((record) => {
    if (!(record.links?.pullRequests ?? []).map(String).includes(String(prNumber))) return false;
    const patchIds = (record.links?.patchIds ?? []).filter((p) => typeof p === "string" && p.length > 0);
    if (patchIds.length === 0) return false; // PR-scoped authorization MUST pin at least one patch id
    if (typeof patchId !== "string" || patchId.length === 0) return false;
    return patchIds.some((p) => p.toLowerCase() === patchId.toLowerCase());
  });
  if (byPr.length > 0) {
    return { ok: true, reason: `tier-2 authorized by decision record ${byPr[0].id} (linked to PR #${prNumber}, patch id ${patchId})` };
  }

  const byPaths = candidates.find((record) => {
    if (record.expiry === null) return false; // a path-scoped authorization must be bounded, never a standing blank cheque
    const rawGlobs = record.links?.paths ?? [];
    const globs = rawGlobs.filter((g) => typeof g === "string" && !isOverbroadPathGlob(g, tierConfig)).map(globToRegExp);
    if (globs.length === 0) return false;
    return tier2Paths.every((p) => globs.some((re) => re.test(p)));
  });
  if (byPaths) {
    return { ok: true, reason: `tier-2 authorized by decision record ${byPaths.id} (path-linked)` };
  }

  return {
    ok: false,
    reason:
      "no schema-valid, decided, owner-approved, tier-2, unexpired, un-superseded governance/decisions/ record links this pull request (by PR number or by a non-overbroad path glob covering every tier-2 path changed) -- tier-2 requires an owner decision record",
  };
}

/**
 * Validates every decision record CHANGED by this pull request (added,
 * modified, deleted, or RENAMED under governance/decisions/**) against its
 * own contract, using the checkout-independent shape validator
 * scripts/check-decision-records.mjs itself exports -- "Run
 * check-decision-records inside the gate". This runs regardless of tier
 * (both tier-1's independence bar and tier-2's owner-decision bar are about
 * WHO approved a change; this is about whether the changed record is even
 * well-formed) and regardless of whether the changed record happens to also
 * satisfy `evaluateTier2Decision` for THIS pull request -- a malformed
 * decision record must never merge just because two reviewers approved the
 * PR that adds it.
 *
 * A record whose `record.__deletedOrUnreadable` is set (the path named in
 * `changedDecisionRecords` no longer resolves at the PR's own head -- see
 * `defaultReadChangedDecisionRecords`) is ALWAYS a problem, never silently
 * skipped: this covers both an outright deletion and a RENAME out of
 * governance/decisions/ (the caller feeds this function BOTH the new and
 * previous filename for a rename -- see `changedFilePathsForClassification`
 * -- so the OLD path shows up here as "no longer exists", exactly as a
 * deletion would; #1187 review at df15ab87, blocking finding 1: "Treat a
 * rename out of governance/decisions/ like the deletion case"). Decision
 * records are append-only: a decision is superseded by a new record, never
 * deleted or renamed away.
 *
 * A DECIDED RECORD IS IMMUTABLE (#1187 review round 4, should-fix: "A
 * decided record is immutable: edits to it are refused, and it can only be
 * superseded by a new record"). Each entry may optionally carry
 * `baseRecord` -- the same path's content already on the base branch, when
 * it existed there at all (`undefined`/`null` for a genuinely new file).
 * When `baseRecord.status === "decided"` and the pull request's own head
 * content at that same path differs from it (by deep value, not by raw
 * text -- a whitespace-only re-serialization changes nothing), the change
 * is refused: a decided record's history is supposed to be exactly what it
 * says, permanently, and the only sanctioned way to change a decision is a
 * NEW record whose `supersedes` names the old one, never an edit in place.
 * A record whose `baseRecord.status` is `"open"` may still be edited
 * freely -- it has not been decided yet, so ordinary iteration is exactly
 * what should happen.
 * @param {Array<{ path: string, record: unknown, baseRecord?: unknown }>} changedDecisionRecords
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluateChangedDecisionRecords(changedDecisionRecords) {
  const problems = [];
  for (const { path, record, baseRecord } of changedDecisionRecords ?? []) {
    if (record && typeof record === "object" && record.__deletedOrUnreadable) {
      problems.push(`${path}: no longer exists at this pull request's head (deleted, or renamed out of governance/decisions/) -- decision records are append-only; supersede with a new record instead`);
      continue;
    }
    const idFromFilename = String(path).split("/").pop().replace(/\.json$/, "");
    const findings = validateDecisionRecordShape(record, idFromFilename);
    if (findings.length > 0) problems.push(`${path}: ${findings.join("; ")}`);

    if (baseRecord && typeof baseRecord === "object" && baseRecord.status === "decided") {
      const changed = record === null || typeof record !== "object" || JSON.stringify(record) !== JSON.stringify(baseRecord);
      if (changed) {
        problems.push(`${path}: already status "decided" on the base branch -- a decided record is immutable; supersede it with a new record instead of editing it in place`);
      }
    }
  }
  if (problems.length > 0) {
    return { ok: false, reason: `invalid decision record(s) in this change: ${problems.join(" | ")}` };
  }
  return { ok: true, reason: "every changed decision record is schema-valid" };
}

/**
 * Fails closed on an incomplete or empty changed-file list, or on a
 * `changedFilesCount` that is not usable as a real count, rather than
 * classifying an unknowable diff as tier-0. `changedFilesCount`, when
 * known, is the pull request's own `changedFiles` count (from `gh pr
 * view`), independent of the paginated file list this checks it against --
 * a mismatch means the page fetch was cut short, not that the PR genuinely
 * touched zero files. A non-number `changedFilesCount` (missing, `null`, a
 * string) is ALSO refused, not skipped: `runStatus` always requests this
 * field, so a non-number value here means the fetch itself is broken, and
 * "unable to cross-check" is not the same fact as "cross-check passed"
 * (#1187 review at df15ab87, should-fix 8 -- an earlier draft treated a
 * non-number count as "nothing to check against", which is exactly the
 * silent-pass shape this whole function exists to refuse).
 * @param {string[]} paths
 * @param {unknown} changedFilesCount
 * @returns {{ ok: boolean, reason: string }}
 */
export function verifyChangedFilesComplete(paths, changedFilesCount) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: false, reason: "changed-file list is empty or unavailable; refusing to classify a tier blind (fail closed)" };
  }
  if (typeof changedFilesCount !== "number" || !Number.isFinite(changedFilesCount)) {
    return {
      ok: false,
      reason: `pull request's changedFiles count is not a usable number (got ${JSON.stringify(changedFilesCount)}); refusing to classify without a real cross-check`,
    };
  }
  if (paths.length !== changedFilesCount) {
    return {
      ok: false,
      reason: `paginated changed-file list has ${paths.length} entries but the pull request reports changedFiles=${changedFilesCount}; refusing to classify with an incomplete list`,
    };
  }
  return { ok: true, reason: "changed-file list is complete" };
}

/**
 * Whether the pull request's own HEAD COMMIT (not the whole PR diff --
 * `headCommitFileCount` is the number of files that specific commit
 * changes relative to its own parent, from `repos/{owner}/{repo}/commits/{sha}`'s
 * own `files` array) changes zero files. A no-op commit -- most commonly
 * `git commit --allow-empty` -- gives a rejected pull request a brand-new
 * `headSha` without changing anything a reviewer could re-review, which
 * would otherwise be enough to clear a sticky rejection on its own (a new
 * head makes every existing record's `headSha` stale, reject included) and
 * let a fresh, otherwise-identical pair of approvals merge with no owner
 * involvement (#1187 review round 4, should-fix: "require that the new
 * approvals follow a commit that actually changes files").
 *
 * This is a blanket rule for any tier-1/tier-2 pull request, not
 * conditioned on whether a reject actually existed at the prior head: this
 * module has no cheap way to re-fetch and re-evaluate review state at a
 * PAST head from here, so refusing every no-op head commit outright is the
 * simpler, safe-by-construction alternative to trying to detect "was there
 * a reject specifically" after the fact.
 *
 * KNOWN LIMITATION: this reads only the head commit's OWN diff against its
 * first parent (what the Commits API reports), not the whole ANCESTRY back
 * to the last commit real reviewers actually saw -- a chain of several
 * no-op commits following one real change is not specially detected beyond
 * each one individually reporting zero files.
 * @param {number} headCommitFileCount
 */
export function isNoOpHeadCommit(headCommitFileCount) {
  return headCommitFileCount === 0;
}

/**
 * Whether the current head's TREE sha is byte-identical to any of a set of
 * previously-rejected heads' own tree shas -- #1187 review round 5,
 * should-fix: "Compare the git tree of the rejected head with the current
 * head, so a change-then-revert can't clear a reject." `isNoOpHeadCommit`
 * alone only catches a head commit that changes literally zero files; a
 * commit that changes a line and a second commit that reverts it (or a
 * whitespace-only change) is not a no-op commit by that measure, but its
 * TREE can still be exactly what a rejected head's tree already was --
 * the same underlying fact, reached a different way.
 * @param {string|null} currentTreeSha
 * @param {string[]} rejectedTreeShas
 */
export function isTreeIdenticalToRejectedHead(currentTreeSha, rejectedTreeShas) {
  if (typeof currentTreeSha !== "string" || currentTreeSha.length === 0) return false;
  return (rejectedTreeShas ?? []).some((t) => typeof t === "string" && t.toLowerCase() === currentTreeSha.toLowerCase());
}

/**
 * Applies `governance/review-tiers.json`'s `enforcement` switch
 * (`"report-only"` | `"enforce"`, defaulting to `"report-only"`) to a raw
 * tier verdict (#1187 review round 5, item 1 -- coordinator decision,
 * "matching this repo's report-then-enforce pattern"). Under `"enforce"`,
 * the verdict passes through completely unchanged -- this is the FULL
 * logic every earlier round built, doing exactly what it always did. Under
 * `"report-only"` (the default), a REFUSING verdict is rewritten to `ok:
 * true`, with its original reason prefixed and preserved verbatim, so the
 * refusal is still computed, still returned, and still visible in
 * `land-stack.mjs --status`'s JSON output -- "computes and prints ... but
 * does not block merging." A verdict that was already `ok: true` is
 * returned unchanged in either mode; there is nothing to soften.
 *
 * Changing `enforcement` to `"enforce"` is itself a tier-2 change (the
 * whole of `governance/review-tiers.json` is tier-2 -- see that file's own
 * header), so flipping the switch on needs the same owner-approved bar as
 * any other change to the enforcement surface. See docs/HITL.md for the
 * observe-then-flip rollout plan.
 * @param {{ ok: boolean, tier: string, reason: string }} verdict
 * @param {"report-only"|"enforce"|undefined} enforcement
 * @returns {{ ok: boolean, tier: string, reason: string }}
 */
export function applyEnforcement(verdict, enforcement) {
  const mode = enforcement === "enforce" ? "enforce" : "report-only";
  if (mode === "enforce" || verdict.ok) return verdict;
  return {
    ok: true,
    tier: verdict.tier,
    reason: `[report-only; would refuse under enforce mode] ${verdict.reason}`,
  };
}

/**
 * Combines the tier-1 independence result, the changed-decision-record
 * validity result, and, for tier-2, the owner decision-record result, into
 * one verdict for a classified pull request. Tier-0 still runs
 * `evaluateChangedDecisionRecords` (a tier-0 PR can still touch
 * governance/decisions/** if a future tier reclassification ever allows
 * it) but otherwise passes without fetching any review evidence at all.
 * @param {{ tier: string, tier2Paths: string[] }} classification
 * @param {{ records: Array<Record<string, unknown>>, headSha: string, patchId?: string, decisionRecords: Array<Record<string, unknown>>, changedDecisionRecords?: Array<{ path: string, record: unknown }>, prNumber: string|number, tierConfig?: { tier2?: string[] }, now?: Date }} evidence
 * @returns {{ ok: boolean, tier: string, reason: string }}
 */
export function evaluateTierGate(classification, evidence) {
  const changedRecordsCheck = evaluateChangedDecisionRecords(evidence.changedDecisionRecords ?? []);
  if (!changedRecordsCheck.ok) {
    return { ok: false, tier: classification.tier, reason: changedRecordsCheck.reason };
  }

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
      patchId: evidence.patchId,
      tier2Paths: classification.tier2Paths,
      tierConfig: evidence.tierConfig,
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

/**
 * Live network call: every changed-file entry for a pull request, paginated
 * directly against the REST Pulls API rather than `gh pr view --json files`
 * -- that call silently truncates at 100 entries. Returns `{filename,
 * previousFilename}` per entry, carrying `previous_filename` through under
 * `previousFilename` so a caller can classify a renamed file by BOTH its
 * old and new path (`changedFilePathsForClassification`) -- #1187 review at
 * df15ab87, blocking finding 1.
 */
function defaultFetchPrFiles(pr, { nameWithOwner = defaultNameWithOwner } = {}) {
  const nwo = nameWithOwner();
  const out = execFileSync(
    "gh",
    ["api", `repos/${nwo}/pulls/${pr}/files`, "--paginate"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const files = JSON.parse(out);
  return (files ?? [])
    .filter((f) => typeof f?.filename === "string" && f.filename.length > 0)
    .map((f) => ({
      filename: f.filename,
      previousFilename: typeof f?.previous_filename === "string" && f.previous_filename.length > 0 ? f.previous_filename : null,
    }));
}

/**
 * Live network call: the number of files the pull request's HEAD COMMIT
 * itself changes, relative to its own first parent, via
 * `repos/{owner}/{repo}/commits/{sha}`'s own `files` array -- used by
 * `isNoOpHeadCommit` to refuse a no-op commit (see that function's own doc
 * comment). On any error, returns a value `isNoOpHeadCommit` will read as
 * NOT a no-op commit (a large sentinel), matching this module's
 * fail-CLOSED-toward-refusing-only-when-CONFIRMED-no-op direction -- an
 * unresolved commit lookup should not itself refuse every tier-1/tier-2 PR,
 * unlike the review-record authorization lookups above, since a no-op
 * commit is a narrower, additive check, not the core independence gate.
 */
function defaultFetchHeadCommitFileCount(sha, { nameWithOwner = defaultNameWithOwner } = {}) {
  try {
    const nwo = nameWithOwner();
    const out = execFileSync(
      "gh",
      ["api", `repos/${nwo}/commits/${encodeURIComponent(sha)}`, "--jq", "(.files // []) | length"],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    const n = Number(out.trim());
    return Number.isFinite(n) ? n : 1;
  } catch {
    return 1;
  }
}

/**
 * Live network call: one commit's own TREE sha, via
 * `repos/{owner}/{repo}/commits/{sha}`'s own `.commit.tree.sha`. Used by
 * `isTreeIdenticalToRejectedHead` (see its own doc comment) to catch a
 * change-then-revert commit that clears a sticky rejection without
 * `isNoOpHeadCommit` ever seeing an empty commit. Returns `null` on any
 * error, or on a response that is not a real 40-character hex sha -- never
 * a value that could accidentally match another tree sha by coincidence.
 * @param {string} sha
 * @returns {string|null}
 */
function defaultFetchCommitTreeSha(sha, { nameWithOwner = defaultNameWithOwner } = {}) {
  try {
    const nwo = nameWithOwner();
    const out = execFileSync(
      "gh",
      ["api", `repos/${nwo}/commits/${encodeURIComponent(sha)}`, "--jq", ".commit.tree.sha"],
      { encoding: "utf8", maxBuffer: 65536 },
    );
    const t = out.trim();
    return /^[0-9a-f]{40}$/i.test(t) ? t : null;
  } catch {
    return null;
  }
}

/**
 * Live network call: the pull request's own net-diff `git patch-id
 * --stable`, computed fresh at evaluation time, used by
 * `evaluateTier2Decision` to check a PR-scoped decision record's
 * `links.patchIds` (#1187 review round 5, blocking finding 2, reviewer 2).
 * Fetches the raw unified diff for the THREE-DOT compare
 * `base...head` (`repos/{owner}/{repo}/compare/{base}...{head}` with the
 * `application/vnd.github.v3.diff` media type) -- the three-dot form is
 * exactly "what HEAD changed since it diverged from BASE", i.e. the PR's
 * own net diff against its merge base, which is what stays invariant
 * across a pure restack or merge-from-base. That raw diff text is piped
 * directly into `git patch-id --stable`, a stateless plumbing command that
 * hashes diff TEXT with no repository access at all -- this never touches
 * or depends on the local checkout, the same discipline every other
 * base-ref read in this module already follows. `base` should be the pull
 * request's own `baseRefName` (its real target branch, which may not be
 * `main` for a stacked PR), never a fixed sha, so a restack that merges
 * newer base-branch commits into the PR branch does not itself change what
 * the three-dot diff reports. Returns `null` on any error (network,
 * `gh`/`git` failure) -- never a value that could accidentally match a
 * pinned patch id.
 * @param {string} base
 * @param {string} head
 * @returns {string|null}
 */
function defaultFetchPatchId(base, head, { nameWithOwner = defaultNameWithOwner, gitExec = execFileSync } = {}) {
  try {
    const nwo = nameWithOwner();
    const diff = execFileSync(
      "gh",
      ["api", `repos/${nwo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, "-H", "Accept: application/vnd.github.v3.diff"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const out = gitExec("git", ["patch-id", "--stable"], { input: diff, encoding: "utf8", maxBuffer: 1024 * 1024 });
    const patchId = out.trim().split(/\s+/)[0];
    return patchId && /^[0-9a-f]{40}$/i.test(patchId) ? patchId : null;
  } catch {
    return null;
  }
}

/**
 * Live network call: every issue-style comment on a pull request
 * (`foundry-review-record` blocks are posted as ordinary PR comments, not
 * native GitHub reviews -- see docs/contracts/review-record.json for why).
 * `gh api ... --paginate` flattens every page into one JSON array before
 * this function ever sees it. Does NOT resolve authorization -- see
 * `defaultAnnotateCommentAuthorization`, a separate step, so a caller can
 * inject a fake permission check in tests without also faking the comment
 * fetch.
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

const AUTHORIZED_COLLABORATOR_PERMISSIONS = new Set(["admin", "write"]);

/**
 * Whether a collaborator permission level (from `repos/{owner}/{repo}/collaborators/{username}/permission`,
 * one of `admin`/`write`/`read`/`none`, or any other string the API might
 * one day add) is authorized to post a `foundry-review-record` that counts
 * toward tier-1 independence. Fail-closed: only the two permission levels
 * that can actually merge or push to this repository are authorized;
 * anything else -- including an unrecognized future value -- is not.
 * @param {string} permission
 */
export function isAuthorizedCollaboratorPermission(permission) {
  return AUTHORIZED_COLLABORATOR_PERMISSIONS.has(permission);
}

/**
 * Live network call: one GitHub login's collaborator permission level on
 * this repository, via `repos/{owner}/{repo}/collaborators/{username}/permission`
 * -- the check the task instruction names explicitly. #1187 review at
 * df15ab87, blocking finding 2: `parseReviewRecordComments` previously
 * never looked at who posted a comment at all, so on this PUBLIC repository
 * a `foundry-review-record` from any account with `author_association:
 * "NONE"` satisfied tier-1 independence.
 *
 * Returns the real permission string (`"admin"`/`"write"`/`"read"`/`"none"`)
 * on success, or `null` on ANY error -- network, unexpected response shape,
 * a login `gh` cannot resolve. `null` is a THIRD, DISTINCT outcome from a
 * confirmed `"none"`: #1187 review round 4, blocking finding 3a found that
 * collapsing a failed lookup into `"none"` (unauthorized) silently dropped
 * a genuine reject from an account this call simply could not reach --
 * safe for an approval (which should never count on ambiguous evidence
 * anyway) but UNSAFE for a reject (which must never be dropped on
 * ambiguous evidence either). This function itself never guesses a
 * permissive default; the caller (`defaultAnnotateCommentAuthorization`)
 * is what turns `null` into the `"unknown"` authorization state
 * `findSuspiciousRecordComments` refuses the whole gate over.
 * @param {string} login
 * @returns {string|null}
 */
function defaultCheckCollaboratorPermission(login, { nameWithOwner = defaultNameWithOwner } = {}) {
  if (!login) return "none";
  try {
    const nwo = nameWithOwner();
    const out = execFileSync(
      "gh",
      ["api", `repos/${nwo}/collaborators/${encodeURIComponent(login)}/permission`, "--jq", ".permission"],
      { encoding: "utf8", maxBuffer: 65536 },
    );
    return out.trim();
  } catch {
    return null;
  }
}

/**
 * Annotates every comment with an `authorization` field -- `"authorized"`,
 * `"unauthorized"`, or `"unknown"` -- resolved from the comment author's
 * collaborator permission (`defaultCheckCollaboratorPermission`), cached
 * per login within this one call (a PR thread often has the same author
 * posting several comments; this keeps it to one permission check per
 * distinct login, not one per comment -- a cache failure for one login
 * never poisons another). This is the ONLY point in this module that
 * decides whether a `foundry-review-record` block may be trusted at all;
 * `parseReviewRecordComments` stays pure and simply reads the value this
 * function set (documented in docs/HITL.md). `null` from the permission
 * check (an unresolved lookup, not a confirmed answer) maps to
 * `"unknown"`, never silently to `"unauthorized"` -- see
 * `defaultCheckCollaboratorPermission`'s own doc comment for why that
 * distinction matters for a reject.
 */
function defaultAnnotateCommentAuthorization(comments, { checkPermission = defaultCheckCollaboratorPermission } = {}) {
  const cache = new Map();
  const resolve = (login) => {
    if (!cache.has(login)) {
      let permission;
      try {
        permission = checkPermission(login);
      } catch {
        permission = null;
      }
      cache.set(login, permission === null ? "unknown" : isAuthorizedCollaboratorPermission(permission) ? "authorized" : "unauthorized");
    }
    return cache.get(login);
  };
  return (comments ?? []).map((comment) => {
    const login = comment?.user?.login ?? comment?.author?.login ?? null;
    if (!login) return { ...comment, authorization: "unauthorized" };
    return { ...comment, authorization: resolve(login) };
  });
}

/**
 * URL-encodes a repository-relative path for use in a `gh api
 * repos/{owner}/{repo}/contents/{path}` call, one path SEGMENT at a time --
 * encoding the whole string in one pass would also encode the `/`
 * separators the Contents API needs literal. #1187 review at df15ab87,
 * should-fix nit: an earlier draft interpolated `path` unencoded, which
 * breaks (or worse, silently resolves the wrong resource) for a path
 * containing a character `encodeURIComponent` would otherwise escape.
 * @param {string} path
 */
export function encodeApiPath(path) {
  return String(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * Live network call: one file's raw content at an EXACT git ref (a base
 * commit sha, never a branch name that could move), via the REST Contents
 * API -- never the local checkout. #1187 review at 8e6d97ea, blocking
 * finding 6: a checkout that itself contains the pull request under test
 * (a merge-train or restack worktree, or this very script's own repository
 * root) must never be trusted to grade itself; if `governance/review-tiers.json`
 * or `governance/decisions/**` came from the local tree, a tier-1 pull
 * request could narrow its own tier-1 globs, or a tier-2 pull request could
 * add its own authorizing decision record, in the same diff it needs
 * graded. `ref` MUST be queried in the URL (`?ref=`), never passed with
 * `-f`/`-F` -- those flags force `gh api` to POST, which silently 404s a
 * GET-only endpoint like this one (measured directly: `-F ref=` 404s even
 * README.md on `main`; `?ref=` in the URL does not). Returns `null` for a
 * path that does not exist at that ref (a 404), so callers can tell "not
 * present at this ref" from a real fetch failure.
 */
function defaultReadFileAtRef(ref, path, { nameWithOwner = defaultNameWithOwner } = {}) {
  const nwo = nameWithOwner();
  let out;
  try {
    out = execFileSync(
      "gh",
      ["api", `repos/${nwo}/contents/${encodeApiPath(path)}?ref=${encodeURIComponent(ref)}`, "--jq", ".content"],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (error) {
    if (/\b404\b/.test(String(error?.stderr ?? error?.message ?? ""))) return null;
    throw error;
  }
  return Buffer.from(out.replace(/\s+/g, ""), "base64").toString("utf8");
}

/**
 * Live network call: every JSON file directly inside a directory at an
 * EXACT git ref, via the same Contents API `defaultReadFileAtRef` uses (see
 * its own doc comment for why `ref` is a query param, and why this never
 * reads the local checkout). Returns `[]` for a directory that does not
 * exist at that ref.
 */
function defaultListDirAtRef(ref, dirPath, { nameWithOwner = defaultNameWithOwner } = {}) {
  const nwo = nameWithOwner();
  let out;
  try {
    out = execFileSync(
      "gh",
      ["api", `repos/${nwo}/contents/${encodeApiPath(dirPath)}?ref=${encodeURIComponent(ref)}`],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (error) {
    if (/\b404\b/.test(String(error?.stderr ?? error?.message ?? ""))) return [];
    throw error;
  }
  const entries = JSON.parse(out);
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e?.type === "file" && typeof e?.name === "string" && e.name.endsWith(".json"))
    .map((e) => e.path);
}

/** Reads governance/review-tiers.json at an EXACT ref -- the pull request's BASE sha, never the local checkout (see `defaultReadFileAtRef`). */
function defaultReadReviewTierConfig(ref, io = {}) {
  const raw = defaultReadFileAtRef(ref, "governance/review-tiers.json", io);
  if (raw === null) {
    throw new Error(`governance/review-tiers.json does not exist at ${ref} -- refusing to classify a tier without it`);
  }
  const config = JSON.parse(raw);
  return {
    tier1: config.tier1?.globs ?? [],
    tier1RecordExempt: config.tier1RecordExempt?.globs ?? [],
    tier2: config.tier2?.globs ?? [],
    // "report-only" | "enforce", defaulting to "report-only" -- #1187
    // review round 5, item 1. Anything other than the literal string
    // "enforce" reads as report-only, the safe default direction.
    enforcement: config.enforcement === "enforce" ? "enforce" : "report-only",
  };
}

/**
 * Reads every governance/decisions/*.json record at an EXACT ref -- the
 * pull request's BASE sha, never the local checkout (see `defaultReadFileAtRef`).
 * Each record is annotated with `_idFromFilename`, the id its OWN filename
 * on the base branch implies -- `evaluateTier2Decision` checks a candidate
 * record's declared `id` against this, not against itself, closing the
 * vacuous self-check an earlier draft had (#1187 review at df15ab87,
 * should-fix nit).
 */
function defaultReadDecisionRecords(ref, io = {}) {
  const files = defaultListDirAtRef(ref, "governance/decisions", io);
  return files.map((path) => {
    const record = JSON.parse(defaultReadFileAtRef(ref, path, io));
    const idFromFilename = path.split("/").pop().replace(/\.json$/, "");
    return { ...record, _idFromFilename: idFromFilename };
  });
}

/**
 * Reads every `governance/decisions/**.json` path in `paths` at an EXACT
 * ref -- the pull request's HEAD sha -- for `evaluateChangedDecisionRecords`.
 * Unlike the base-ref readers above, this deliberately reads the PULL
 * REQUEST'S OWN proposed content: the whole point is to validate the record
 * this PR is trying to add or change, not what already exists on the base
 * branch. `paths` should be the UNION of new and previous filenames
 * (`changedFilePathsForClassification`), so a decision record renamed OUT
 * of governance/decisions/ still shows up here (at its OLD path, which no
 * longer resolves at head -- `__deletedOrUnreadable`) rather than
 * disappearing because only the new, now-irrelevant path was checked.
 *
 * ALSO reads each path's content at `baseRef` (the pull request's base
 * commit) and attaches it as `baseRecord` -- `null` when the path did not
 * exist on the base branch at all (a genuinely new record). This is what
 * `evaluateChangedDecisionRecords`'s immutability check compares the head
 * content against: a `baseRecord.status === "decided"` with a differing
 * head record is refused, so a decided record can only ever be superseded
 * by a new file, never edited in place.
 */
function defaultReadChangedDecisionRecords(ref, paths, io = {}, baseRef = undefined) {
  const decisionPaths = [...new Set((paths ?? []).filter((p) => p.startsWith("governance/decisions/") && p.endsWith(".json")))];
  return decisionPaths.map((path) => {
    const raw = defaultReadFileAtRef(ref, path, io);
    let record;
    if (raw === null) {
      record = { __deletedOrUnreadable: true };
    } else {
      try {
        record = JSON.parse(raw);
      } catch {
        record = { __parseError: true };
      }
    }
    let baseRecord = null;
    if (typeof baseRef === "string" && baseRef.length > 0) {
      const baseRaw = defaultReadFileAtRef(baseRef, path, io);
      if (baseRaw !== null) {
        try {
          baseRecord = JSON.parse(baseRaw);
        } catch {
          baseRecord = null; // an unparseable base record cannot be compared against; treated as "no prior decided version" -- shape-invalidity on the base branch is not this pull request's problem to fix
        }
      }
    }
    return { path, record, baseRecord };
  });
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

/**
 * Exported for `scripts/land-stack.test.mjs` (#1187 review round 5,
 * coordinator instruction: "the tests must exercise enforce mode" —
 * `applyEnforcement`'s own unit tests cover both modes in isolation, but a
 * wiring bug that left the `"enforce"` path unreachable from here would not
 * be caught by those alone). Every dependency is injectable, the same
 * pattern `runMerge` below already follows; production code (the CLI at the
 * bottom of this file) calls this with no second argument, using every
 * `default*` I/O function.
 */
export function runStatus(
  pr,
  {
    ghPrView = defaultGhPrView,
    fetchRequiredContexts = defaultFetchRequiredContexts,
    fetchPrFiles = defaultFetchPrFiles,
    fetchPrComments = defaultFetchPrComments,
    annotateCommentAuthorization = defaultAnnotateCommentAuthorization,
    readReviewTierConfig = defaultReadReviewTierConfig,
    readDecisionRecords = defaultReadDecisionRecords,
    readChangedDecisionRecords = defaultReadChangedDecisionRecords,
    fetchHeadCommitFileCount = defaultFetchHeadCommitFileCount,
    fetchCommitTreeSha = defaultFetchCommitTreeSha,
    fetchPatchId = defaultFetchPatchId,
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
    "baseRefOid",
    "changedFiles",
  ]);
  const requiredContexts = fetchRequiredContexts(view.baseRefName || "main");
  const mergeVerdict = canMerge(prViewToCanMergeInput(view, requiredContexts));

  const fileEntries = fetchPrFiles(pr);
  const countPaths = fileEntries.map((f) => f.filename);
  const completeness = verifyChangedFilesComplete(countPaths, view.changedFiles);
  if (!completeness.ok) {
    const reason = mergeVerdict.ok ? completeness.reason : `${mergeVerdict.reason}; ${completeness.reason}`;
    return { pr: Number(pr), headRefName: view.headRefName, ok: false, reason, tier: "unknown" };
  }

  // Classification (and decision-record change detection) use BOTH the new
  // and previous name of a renamed file, never just countPaths above (#1187
  // review at df15ab87, blocking finding 1) -- see
  // changedFilePathsForClassification's own doc comment.
  const classificationPaths = changedFilePathsForClassification(fileEntries);

  // Tier config is read from the pull request's BASE commit -- never the
  // local checkout, and never the pull request's own head -- so a tier-1 or
  // tier-2 pull request can never narrow its own globs or add its own
  // authorizing decision record in the same diff it needs graded (#1187
  // review at 8e6d97ea, blocking finding 6). This one read is unconditional:
  // it is what DETERMINES the tier in the first place.
  const baseRef = view.baseRefOid || view.baseRefName || "main";
  const tierConfig = readReviewTierConfig(baseRef);
  const enforcement = tierConfig.enforcement === "enforce" ? "enforce" : "report-only";
  const classification = classifyTier(classificationPaths, tierConfig);

  // Everything below -- fetching PR comments, resolving each commenter's
  // collaborator permission, and reading every governance/decisions/*.json
  // record from the base branch -- is read ONLY for a tier-1 or tier-2 PR
  // (#1187 review round 4, should-fix: "Tier-0 PRs skip decision-record and
  // permission reads"). A genuinely tier-0 classification means no path in
  // this diff matches governance/decisions/** either (that glob alone is
  // tier-1, per governance/review-tiers.json), so
  // evaluateChangedDecisionRecords has nothing to check and every one of
  // these reads would be pure waste -- and, for the base-branch decision
  // log specifically, a real cost: one malformed record anywhere in
  // governance/decisions/ would otherwise make `--status` throw for EVERY
  // pull request, tier-0 included, and that cost only grows as the log
  // grows.
  let rawTierVerdict;
  if (classification.tier === "tier-0") {
    rawTierVerdict = evaluateTierGate(classification, {});
  } else if (isNoOpHeadCommit(fetchHeadCommitFileCount(view.headRefOid))) {
    // A no-op head commit (most commonly `git commit --allow-empty`) gives
    // an otherwise-identical PR a brand-new headSha, which alone would be
    // enough to clear a sticky rejection at the OLD head and let a fresh
    // approving pair merge with no owner involvement -- #1187 review round
    // 4, should-fix: "require that the new approvals follow a commit that
    // actually changes files". Refused unconditionally for any tier-1/
    // tier-2 pull request; see `isNoOpHeadCommit`'s own doc comment for
    // what this does and does not detect.
    rawTierVerdict = {
      ok: false,
      tier: classification.tier,
      reason: "the pull request's head commit changes zero files -- a no-op commit cannot advance review state or clear a prior rejection; push a real change instead",
    };
  } else {
    const changedDecisionRecords = readChangedDecisionRecords(view.headRefOid, classificationPaths, {}, baseRef);
    // Only an admin/write collaborator's comment may ever supply a
    // foundry-review-record -- #1187 review at df15ab87, blocking finding 2.
    const annotatedComments = annotateCommentAuthorization(fetchPrComments(pr));
    const records = parseReviewRecordComments(annotatedComments);

    // Round 5 should-fix: `isNoOpHeadCommit` alone only catches a head
    // commit that changes literally zero files. A commit that changes a
    // line and a second commit that reverts it (or a whitespace-only
    // change) is NOT a no-op commit, but the resulting TREE can still be
    // byte-identical to a previously-rejected head's tree -- the same
    // "nothing really changed" fact `isNoOpHeadCommit` exists to catch,
    // just reached a different way. Compare the current head's tree to
    // every DISTINCT prior AUTHORIZED reject's own (now-stale) head tree;
    // capped at 10 distinct prior heads to bound the extra API calls.
    const priorRejectHeadShas = [
      ...new Set(
        records
          .filter(
            (r) =>
              r &&
              r._authorization === "authorized" &&
              !r._parseError &&
              REJECT_STATE_SPELLINGS.has(normalizeStateSpelling(r.state)) &&
              typeof r.headSha === "string" &&
              r.headSha.length > 0 &&
              r.headSha !== view.headRefOid,
          )
          .map((r) => r.headSha),
      ),
    ].slice(0, 10);
    const rejectedTreeShas = priorRejectHeadShas.map((sha) => fetchCommitTreeSha(sha)).filter((t) => t !== null);
    const currentTreeSha = rejectedTreeShas.length > 0 ? fetchCommitTreeSha(view.headRefOid) : null;

    if (isTreeIdenticalToRejectedHead(currentTreeSha, rejectedTreeShas)) {
      rawTierVerdict = {
        ok: false,
        tier: classification.tier,
        reason: "the pull request's current head has the exact same tree as a previously-rejected head -- a change-then-revert (or whitespace-only) commit cannot clear a prior rejection; push a real, different change instead",
      };
    } else {
      // Base-branch decision records are read only when tier-2 authority is
      // actually needed to evaluate them against -- a tier-1 PR's own
      // evaluateTierGate call never reaches evaluateTier2Decision at all.
      const decisionRecords = classification.tier === "tier-2" ? readDecisionRecords(baseRef) : [];
      // The PR's own patch id (net diff against its base) is only needed
      // for tier-2's PR-scoped authorization check -- computed lazily, one
      // extra `gh`+`git` round trip, only when tier-2 might need it.
      const patchId = classification.tier === "tier-2" ? fetchPatchId(view.baseRefName || "main", view.headRefOid) : undefined;
      rawTierVerdict = evaluateTierGate(classification, {
        records,
        headSha: view.headRefOid,
        patchId,
        decisionRecords,
        changedDecisionRecords,
        prNumber: pr,
        tierConfig,
      });
    }
  }

  // Report-only by default (#1187 review round 5, item 1: "land-stack
  // computes and prints the tier verdict and every refusal reason, but
  // does not block merging unless enforcement is on"). See
  // `applyEnforcement`'s own doc comment for what this does and does not
  // change.
  const tierVerdict = applyEnforcement(rawTierVerdict, enforcement);

  const ok = mergeVerdict.ok && tierVerdict.ok;
  const reason = mergeVerdict.ok
    ? tierVerdict.reason
    : tierVerdict.ok
      ? mergeVerdict.reason
      : `${mergeVerdict.reason}; ${tierVerdict.reason}`;

  return { pr: Number(pr), headRefName: view.headRefName, headRefOid: view.headRefOid, ok, reason, tier: classification.tier, enforcement };
}

function runMerge(
  pr,
  {
    ghPrView = defaultGhPrView,
    fetchRequiredContexts = defaultFetchRequiredContexts,
    fetchPrFiles = defaultFetchPrFiles,
    fetchPrComments = defaultFetchPrComments,
    annotateCommentAuthorization = defaultAnnotateCommentAuthorization,
    readReviewTierConfig = defaultReadReviewTierConfig,
    readDecisionRecords = defaultReadDecisionRecords,
    readChangedDecisionRecords = defaultReadChangedDecisionRecords,
    fetchHeadCommitFileCount = defaultFetchHeadCommitFileCount,
    fetchCommitTreeSha = defaultFetchCommitTreeSha,
    fetchPatchId = defaultFetchPatchId,
    ghExec = execFileSync,
  } = {},
) {
  const status = runStatus(pr, {
    ghPrView,
    fetchRequiredContexts,
    fetchPrFiles,
    fetchPrComments,
    annotateCommentAuthorization,
    readReviewTierConfig,
    readDecisionRecords,
    readChangedDecisionRecords,
    fetchHeadCommitFileCount,
    fetchCommitTreeSha,
    fetchPatchId,
  });
  if (!status.ok) {
    console.error(status.reason);
    process.exitCode = 1;
    return status;
  }
  // --match-head-commit closes the TOCTOU window between this status check
  // and the merge call itself: without it, a push landing in that window
  // merges a head no review record or tier classification above ever
  // covered (#1187 review at 8e6d97ea, should-fix 8).
  ghExec(
    "gh",
    ["pr", "merge", String(pr), "--merge", "--match-head-commit", status.headRefOid],
    { encoding: "utf8", stdio: "inherit" },
  );
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
