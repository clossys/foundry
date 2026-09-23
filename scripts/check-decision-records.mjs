#!/usr/bin/env node
// check-decision-records — validates the append-only decision log under
// governance/decisions/ against docs/contracts/decision-record.json, and
// flags the two time-based failure modes that contract requires and no
// schema check alone can catch: an "open" decision whose own expiry date has
// passed (default-deny: it is never silently treated as approved), and a
// "decided" relaxation whose sunset has passed with no later record
// superseding it (a relaxation is not permanent by default).
//
//   node scripts/check-decision-records.mjs [--dir <path>] [--now <ISO8601>]
//
// Exit 0 = every record is well-formed and no time-based flag fired.
// Exit 1 = at least one schema violation or time-based flag.
//
// NOT WIRED AS A `check:*` NPM SCRIPT ON PURPOSE. This repository's own
// scripts/check-workflow-references.test.mjs fails any `check:*` script that
// no workflow ever invokes (#414) -- and the HITL first slice this script
// belongs to is explicit that this round adds no CI change and no new
// workflow (governance/review-tiers.json's own header comment says the same
// for the merge-train review-record gate). Run this by hand
// (`node scripts/check-decision-records.mjs`) until a later slice decides to
// wire it into a workflow.
//
// Pure validation logic is exported and unit-tested in
// scripts/check-decision-records.test.mjs; only `main()` below does I/O.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const TIERS = Object.freeze(["tier-1", "tier-2"]);
export const STATUSES = Object.freeze(["open", "decided", "expired"]);
export const DECIDED_BY_VALUES = Object.freeze(["owner", "consensus"]);
export const REVIEW_VERDICTS = Object.freeze(["approve", "reject", "changes"]);
export const REVIEW_ROLES = Object.freeze(["author", "primary", "secondary", "owner"]);
/**
 * Where a `decidedBy` claim can be checked, per the owner-ratified
 * escalation rule (docs/HITL.md's "Escalation rule", item 6): `"owner-chat"`
 * (a channel no agent can write to, not independently verifiable by anyone
 * reading the git tree) and `"signed-commit"` (a future, hardware-key-signed
 * commit, also not agent-writable) are both channels an agent cannot forge;
 * `"github-comment"` is a channel every session in this repository can post
 * to under the SAME shared account, so it is never, by itself, proof of
 * owner intent -- see the tier-2 rule this field feeds below.
 */
export const CHANNELS = Object.freeze(["owner-chat", "signed-commit", "github-comment"]);

const KNOWN_FIELDS = Object.freeze([
  "schemaVersion",
  "id",
  "tier",
  "question",
  "options",
  "recommendation",
  "reviews",
  "status",
  "decidedBy",
  "channel",
  "decision",
  "relaxesGateOrPolicy",
  "sunset",
  "expiry",
  "supersedes",
  "links",
  "notes",
]);

const REVIEW_FIELDS = Object.freeze(["role", "instance", "provider", "model", "effort", "verdict", "link"]);
const LINKS_FIELDS = Object.freeze(["pullRequests", "issues", "paths", "patchIds"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isIsoDateOrNull(value) {
  if (value === null) return true;
  if (typeof value !== "string" || value.length === 0) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

/**
 * Validates one decision record's SHAPE against docs/contracts/decision-record.json.
 * Returns a list of finding strings; an empty list means the record is
 * well-formed. `idFromFilename` is the filename (without `.json`) the record
 * was read from -- `id` must equal it exactly.
 *
 * @param {unknown} record
 * @param {string} idFromFilename
 * @returns {string[]}
 */
export function validateDecisionRecordShape(record, idFromFilename) {
  const findings = [];
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return [`record is not a JSON object`];
  }

  for (const key of Object.keys(record)) {
    if (!KNOWN_FIELDS.includes(key)) findings.push(`unknown field: ${key}`);
  }

  if (record.schemaVersion !== 1) findings.push(`schemaVersion must be 1, got ${JSON.stringify(record.schemaVersion)}`);
  if (!isNonEmptyString(record.id)) findings.push("id must be a non-empty string");
  else if (record.id !== idFromFilename) findings.push(`id (${record.id}) must equal its filename (${idFromFilename}.json)`);

  if (!TIERS.includes(record.tier)) findings.push(`tier must be one of ${TIERS.join(", ")}, got ${JSON.stringify(record.tier)}`);
  if (!isNonEmptyString(record.question)) findings.push("question must be a non-empty string");
  if (!Array.isArray(record.options) || record.options.length === 0 || !record.options.every(isNonEmptyString)) {
    findings.push("options must be a non-empty array of non-empty strings");
  }
  if (!isNonEmptyString(record.recommendation)) findings.push("recommendation must be a non-empty string");

  if (!Array.isArray(record.reviews)) {
    findings.push("reviews must be an array");
  } else {
    record.reviews.forEach((review, index) => {
      if (review === null || typeof review !== "object" || Array.isArray(review)) {
        findings.push(`reviews[${index}] is not an object`);
        return;
      }
      for (const key of Object.keys(review)) {
        if (!REVIEW_FIELDS.includes(key)) findings.push(`reviews[${index}] unknown field: ${key}`);
      }
      if (!REVIEW_ROLES.includes(review.role)) findings.push(`reviews[${index}].role must be one of ${REVIEW_ROLES.join(", ")}`);
      if (!REVIEW_VERDICTS.includes(review.verdict)) findings.push(`reviews[${index}].verdict must be one of ${REVIEW_VERDICTS.join(", ")}`);
      for (const field of ["instance", "provider", "model", "effort", "link"]) {
        if (!isNonEmptyString(review[field])) findings.push(`reviews[${index}].${field} must be a non-empty string`);
      }
    });
  }

  if (!STATUSES.includes(record.status)) findings.push(`status must be one of ${STATUSES.join(", ")}, got ${JSON.stringify(record.status)}`);

  if (record.status === "decided") {
    if (!DECIDED_BY_VALUES.includes(record.decidedBy)) findings.push(`decidedBy is required and must be one of ${DECIDED_BY_VALUES.join(", ")} when status is "decided"`);
    if (!isNonEmptyString(record.decision)) findings.push('decision is required and must be a non-empty string when status is "decided"');
  } else {
    if (record.decidedBy !== null && record.decidedBy !== undefined && !DECIDED_BY_VALUES.includes(record.decidedBy)) {
      findings.push(`decidedBy must be one of ${DECIDED_BY_VALUES.join(", ")} or null/absent when status is not "decided"`);
    }
  }

  // `channel` is OPTIONAL, not required (#1187 escalation rule, item 6):
  // this field is new, and requiring it retroactively on every existing
  // owner-decided record would force backfilling records this rule was
  // never meant to reach back and invalidate. When present it must be one
  // of `CHANNELS`; a github-comment channel is a specific, hard
  // disqualifier for exactly the case it exists to prevent -- a decided,
  // owner-decided TIER-2 record (the shape `evaluateTier2Decision` in
  // scripts/land-stack.mjs treats as live authorization) whose owner
  // decision is sourced from a channel every session shares write access
  // to. A record with NO `channel` field at all (every record predating
  // this rule) is left alone; only an EXPLICIT `channel: "github-comment"`
  // on a live tier-2 owner authorization is rejected.
  if (record.channel !== undefined) {
    if (!CHANNELS.includes(record.channel)) {
      findings.push(`channel must be one of ${CHANNELS.join(", ")} when present, got ${JSON.stringify(record.channel)}`);
    } else if (record.tier === "tier-2" && record.status === "decided" && record.decidedBy === "owner" && record.channel === "github-comment") {
      findings.push(
        'channel "github-comment" can never satisfy decidedBy "owner" for a tier-2 record -- a GitHub comment under the shared agent identity is never proof of owner intent (docs/HITL.md\'s "Escalation rule", item 6); source it from owner-chat or a signed-commit instead',
      );
    }
  }

  if (typeof record.relaxesGateOrPolicy !== "boolean") {
    findings.push("relaxesGateOrPolicy is required and must be a boolean (no default -- see docs/contracts/decision-record.json)");
  } else {
    if (record.relaxesGateOrPolicy === true && !isNonEmptyString(record.sunset)) {
      findings.push("sunset is required (a non-null date) when relaxesGateOrPolicy is true");
    }
    if (record.relaxesGateOrPolicy === false && record.sunset !== null && record.sunset !== undefined) {
      findings.push("sunset must be null when relaxesGateOrPolicy is false");
    }
  }
  if (record.sunset !== null && record.sunset !== undefined && !isIsoDateOrNull(record.sunset)) {
    findings.push(`sunset must be null or a valid RFC 3339 date, got ${JSON.stringify(record.sunset)}`);
  }

  if (!("expiry" in record)) {
    findings.push("expiry is required");
  } else if (!isIsoDateOrNull(record.expiry)) {
    findings.push(`expiry must be null or a valid RFC 3339 date, got ${JSON.stringify(record.expiry)}`);
  } else if (record.expiry === null && record.status !== "decided") {
    findings.push('expiry may only be null when status is "decided"');
  } else if (record.expiry === null && record.relaxesGateOrPolicy === true) {
    findings.push("expiry may not be null when relaxesGateOrPolicy is true (a relaxation is bounded by its sunset, but the decision record itself still needs an expiry)");
  }

  if (record.supersedes !== undefined) {
    if (!Array.isArray(record.supersedes) || !record.supersedes.every(isNonEmptyString)) {
      findings.push("supersedes must be an array of non-empty strings when present");
    }
  }

  if (record.links !== undefined) {
    if (record.links === null || typeof record.links !== "object" || Array.isArray(record.links)) {
      findings.push("links must be an object when present");
    } else {
      for (const key of Object.keys(record.links)) {
        if (!LINKS_FIELDS.includes(key)) findings.push(`links unknown field: ${key}`);
      }
      for (const field of LINKS_FIELDS) {
        const value = record.links[field];
        if (value !== undefined && (!Array.isArray(value) || !value.every((v) => typeof v === "string"))) {
          findings.push(`links.${field} must be an array of strings when present`);
        }
      }
      // The two rules below apply only to a record actually FUNCTIONING as
      // tier-2 authorization (tier: "tier-2", status: "decided") -- a
      // tier-1 record, or an open/not-yet-decided one, may cite a PR or a
      // path for context without yet meeting the bar a live authorization
      // needs.
      const isLiveTier2Authorization = record.tier === "tier-2" && record.status === "decided";
      if (isLiveTier2Authorization) {
        // A PR-scoped authorization must pin at least one patch-id --
        // without it, links.pullRequests alone authorizes whatever head
        // that PR happens to carry at merge time, not the exact change
        // content the record was actually decided about. A head-sha pin
        // (this repository's earlier design) is unsatisfiable under strict,
        // up-to-date branch protection: landing the record itself advances
        // main, forcing the authorized PR into a restack that changes its
        // head sha every time. `git patch-id --stable` of the PR's net diff
        // against its merge base survives a pure restack or merge-forward
        // and only changes when the actual patch content changes (#1187
        // review round 5, blocking, reviewer 2: "pin the change content").
        if (Array.isArray(record.links.pullRequests) && record.links.pullRequests.length > 0) {
          if (!Array.isArray(record.links.patchIds) || record.links.patchIds.length === 0) {
            findings.push("links.patchIds must be a non-empty array when links.pullRequests is non-empty on a decided tier-2 record (a PR-scoped authorization must pin a patch-id, not a head sha)");
          }
        }
        // A path-scoped authorization must be bounded by a real expiry --
        // otherwise one owner decision pre-authorizes every future change
        // under that glob, forever (#1187 review round 4, should-fix: "a
        // path-scoped authorization must carry a non-null expiry").
        if (Array.isArray(record.links.paths) && record.links.paths.length > 0 && record.expiry === null) {
          findings.push("expiry must not be null when links.paths is non-empty on a decided tier-2 record (a path-scoped authorization must be bounded)");
        }
      }
    }
  }

  if (record.notes !== undefined && typeof record.notes !== "string") {
    findings.push("notes must be a string when present");
  }

  return findings;
}

/**
 * An "open" record is default-deny past its own expiry: it must never be
 * silently read as decided. Returns true when `record.status === "open"`
 * and `record.expiry` is a valid date at or before `now`.
 * @param {{status?: string, expiry?: string|null}} record
 * @param {Date} now
 */
export function isExpiredOpenDecision(record, now) {
  if (record?.status !== "open") return false;
  if (typeof record?.expiry !== "string") return false;
  const t = Date.parse(record.expiry);
  if (!Number.isFinite(t)) return false;
  return t <= now.getTime();
}

/**
 * A "decided" relaxation (`relaxesGateOrPolicy: true`) is bounded by its
 * `sunset` unless a later record's `supersedes` names it -- renewal is an
 * explicit new record, never silent continuation. Returns true when the
 * record's sunset has passed and no other record in `allRecords` supersedes it.
 * @param {{id?: string, status?: string, relaxesGateOrPolicy?: boolean, sunset?: string|null}} record
 * @param {Array<{supersedes?: string[]}>} allRecords
 * @param {Date} now
 */
export function isRelaxationPastSunset(record, allRecords, now) {
  if (record?.status !== "decided") return false;
  if (record?.relaxesGateOrPolicy !== true) return false;
  if (typeof record?.sunset !== "string") return false;
  const t = Date.parse(record.sunset);
  if (!Number.isFinite(t)) return false;
  if (t > now.getTime()) return false;
  const renewed = allRecords.some((other) => Array.isArray(other?.supersedes) && other.supersedes.includes(record.id));
  return !renewed;
}

/**
 * Full validation pass over every {id, filename, record} entry: shape
 * findings per record, plus the two time-based flags across the whole set.
 * @param {Array<{id: string, record: unknown}>} entries
 * @param {Date} now
 * @returns {{ [id: string]: string[] }} non-empty only for ids with findings
 */
export function validateDecisionRecords(entries, now) {
  const results = {};
  const records = entries.map((e) => e.record);
  for (const { id, record } of entries) {
    const findings = validateDecisionRecordShape(record, id);
    if (record && typeof record === "object" && !Array.isArray(record)) {
      if (isExpiredOpenDecision(record, now)) {
        findings.push(`open decision has passed its expiry (${record.expiry}) with no status change to "expired" -- default is deny, not silent approval`);
      }
      if (isRelaxationPastSunset(record, records, now)) {
        findings.push(`relaxation has passed its sunset (${record.sunset}) with no later record superseding it -- a relaxation is not permanent by default`);
      }
    }
    if (findings.length > 0) results[id] = findings;
  }
  return results;
}

function readEntries(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((file) => {
    const id = file.slice(0, -".json".length);
    const raw = readFileSync(join(dir, file), "utf8");
    let record;
    try {
      record = JSON.parse(raw);
    } catch (error) {
      record = { __parseError: String(error?.message ?? error) };
    }
    return { id, record };
  });
}

function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: "string" },
      now: { type: "string" },
    },
  });
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const dir = values.dir ? resolve(values.dir) : resolve(scriptDir, "..", "governance", "decisions");
  const now = values.now ? new Date(values.now) : new Date();

  const entries = readEntries(dir);
  const results = validateDecisionRecords(entries, now);
  const ids = Object.keys(results);

  if (ids.length === 0) {
    console.log(`${entries.length} decision record(s) in ${dir}: all valid, no expiry or sunset flags.`);
    return;
  }

  for (const id of ids) {
    console.error(`${id}.json:`);
    for (const finding of results[id]) console.error(`  - ${finding}`);
  }
  console.error(`${ids.length} of ${entries.length} decision record(s) have findings.`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
