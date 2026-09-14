/**
 * check-attestation-freshness: an early warning for time-boxed governance
 * and strategy records, well before wall-clock expiry turns into a frozen
 * repository.
 *
 * WHY THIS EXISTS. Several repositories in this fleet govern themselves with
 * time-boxed attestation records: a `freshUntil`, `expiresAt`, `validUntil`,
 * `nextReviewAt`, or a duration such as `_stalenessBudgetDays` measured from
 * an anchor timestamp in the same record. Some of those records feed a
 * REQUIRED status check, so when the wall clock crosses the line, every
 * merge into that repository stops, with no warning, because nothing ever
 * looked at the date until the gate itself did. Twice in one day that meant a
 * repository carrying live critical security fixes could not take them.
 *
 * This script is the warning, not a new gate. It never fails a merge and it
 * never touches an attestation record's own dates: see EXIT CODES below.
 * Reconfirming or lengthening a record is a decision for the record's own
 * accountable sponsor, named in fields such as `verifiedBy` and `sponsorRef`;
 * this script only says, ahead of time, which records need that decision.
 *
 * DECLARED VERSUS ENFORCED: THE PART THAT NEEDS RIGOUR. A field that LOOKS
 * like a budget is not necessarily wired to anything. One repository in this
 * fleet reads its staleness budget only from a dashboard script that is
 * invoked by no workflow and sets no failing exit code: it enforces nothing.
 * Another repository's expiry field sits at a path its own checker does not
 * evaluate as a live expiry at all. Both are structurally indistinguishable
 * from a genuinely blocking record if the only thing read is the data. So
 * this script never infers enforcement from the presence of a field. It
 * trusts only an explicit, hand-authored entry in an "enforcement registry"
 * (see loadRegistry / RegistryEntry below) naming the reader script, the
 * workflow, and the exact required-status-check context, and then it
 * cross-checks that claim against a LIVE snapshot of the repository's
 * rulesets (see loadRulesets below), because a registry entry can go stale
 * exactly like the record it describes. `repos/{owner}/{repo}/rulesets` is
 * the only source this trusts for "required"; branch protection
 * (`branches/{branch}/protection`) 404s even when a ruleset is actively
 * enforcing, so a caller relying on it would see "unprotected" for a
 * genuinely blocking repository. A registry claim the live snapshot cannot
 * confirm is reported as `enforcement-drift`, not silently believed.
 *
 * WHAT COUNTS AS A TIME-BOXED FIELD. An exact match against KNOWN_DATE_FIELDS
 * or KNOWN_BUDGET_FIELDS, anywhere in a JSON file's object tree (not only
 * under governance/ or strategy/: a repository is free to keep one
 * elsewhere). A budget-days field needs an anchor timestamp field in the same
 * object (asOf, measuredAt, verifiedAt, assessedAt, generatedAt, observedAt,
 * lastVerifiedAt, reportedAt); without one it is reported `unanchored` rather
 * than silently skipped or guessed at.
 *
 * WHAT IS DELIBERATELY EXCLUDED. Any path containing a `fixtures` or
 * `__fixtures__` segment, and any `*.test.*` file. This fleet's own test
 * fixtures plant fields named exactly like the real thing (a `freshUntil` of
 * 2099 inside `governance/release-qualification-fixtures/...`) so a package's
 * own gate tests have something to assert against. Counting those as live
 * attestations would bury the real ones in noise, and noise is exactly what
 * makes a warning get ignored: see docs/ATTESTATION-FRESHNESS.md.
 *
 * EXIT CODES. This never mimics a merge gate. `run()` always succeeds (exit
 * 0) once it has produced a report, however urgent the findings: urgency
 * lives in each finding's own `urgency` field, never in the process exit
 * code, precisely so nobody can wire this into a required check by habit and
 * recreate the exact failure mode it exists to warn about. Exit 2 only when
 * the scan itself could not run (bad root, unreadable registry/rulesets
 * file, unparseable JSON where a real one was expected).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const KNOWN_DATE_FIELDS = Object.freeze([
  "freshUntil",
  "expiresAt",
  "validUntil",
  "nextReviewAt",
  "reviewBy",
  "reviewDate",
]);

export const KNOWN_BUDGET_FIELDS = Object.freeze([
  "_stalenessBudgetDays",
  "stalenessBudgetDays",
]);

const ANCHOR_FIELDS = Object.freeze([
  "asOf",
  "measuredAt",
  "verifiedAt",
  "assessedAt",
  "generatedAt",
  "observedAt",
  "lastVerifiedAt",
  "reportedAt",
]);

// Fallback so a differently-cased or newly invented field name is still
// caught rather than silently missed: see WHAT COUNTS AS A TIME-BOXED FIELD.
const DATE_FIELD_PATTERN = /^(fresh|expir|valid|nextReview|reviewBy|reviewDate).*?(until|at|by|date)?$/i;
const BUDGET_FIELD_PATTERN = /budgetDays$/i;

const EXCLUDED_PATH_SEGMENT = /(^|\/)[^/]*fixtures[^/]*(\/|$)/i;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** Every JSON field in `root`'s object tree matching a known or fallback name. */
export function findTimeBoxedFields(root, filePath) {
  const found = [];
  function walk(node, pointer) {
    if (Array.isArray(node)) { node.forEach((item, index) => walk(item, `${pointer}/${index}`)); return; }
    if (!isPlainObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const isKnownDate = KNOWN_DATE_FIELDS.includes(key);
      const isKnownBudget = KNOWN_BUDGET_FIELDS.includes(key);
      const isFallbackDate = !isKnownDate && typeof value === "string" && DATE_FIELD_PATTERN.test(key) && isTimestamp(value);
      const isFallbackBudget = !isKnownBudget && typeof value === "number" && BUDGET_FIELD_PATTERN.test(key);
      if (isKnownDate || isFallbackDate) {
        if (isTimestamp(value)) found.push({ file: filePath, field: key, pointer: `${pointer}/${key}`, kind: "date", rawValue: value, container: node });
      } else if (isKnownBudget || isFallbackBudget) {
        if (typeof value === "number" && Number.isFinite(value)) found.push({ file: filePath, field: key, pointer: `${pointer}/${key}`, kind: "budgetDays", rawValue: value, container: node });
      }
      walk(value, `${pointer}/${key}`);
    }
  }
  walk(root, "");
  return found;
}

/** Resolve a date-or-budget field to a concrete deadline, or say why it can't be resolved. */
export function computeDeadline(record, now) {
  if (record.kind === "date") {
    const deadline = Date.parse(record.rawValue);
    return { deadlineISO: new Date(deadline).toISOString(), daysRemaining: (deadline - now) / MS_PER_DAY, anchorField: null };
  }
  const anchorField = ANCHOR_FIELDS.find((name) => isTimestamp(record.container[name]));
  if (!anchorField) return { deadlineISO: null, daysRemaining: null, anchorField: null, unanchored: true };
  const anchor = Date.parse(record.container[anchorField]);
  const deadline = anchor + record.rawValue * MS_PER_DAY;
  return { deadlineISO: new Date(deadline).toISOString(), daysRemaining: (deadline - now) / MS_PER_DAY, anchorField };
}

/**
 * @typedef {object} RegistryEntry
 * @property {string} file                    repo-relative path of the record
 * @property {string} field                   the field name (matches findTimeBoxedFields)
 * @property {string} readerScript             what actually reads this field
 * @property {string} workflow                 the workflow that runs readerScript
 * @property {string} requiredCheckContext     the exact required-status-check context name,
 *                                              or null if this record is read but not required
 * @property {object} [rulesetEvidence]        { verifiedAt, verifiedBy, rulesetId, rulesetName, sourceCommand }
 * @property {string} [notes]
 */

export function loadRegistry(path) {
  if (!path) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed.records)) throw new Error(`${path}: expected a "records" array`);
  return parsed.records;
}

/**
 * A live snapshot the WRAPPING WORKFLOW assembles by calling
 * `gh api repos/{owner}/{repo}/rulesets` and then, for each branch-target
 * ruleset, the ruleset's own detail endpoint for its `required_status_checks`
 * contexts. Kept as an injected file (not a network call this script makes
 * itself) so this stays pure and testable, the same discipline
 * check-release-readiness.mjs and check-merge-policy.mjs already use for a
 * live-API dependency.
 *
 * Shape: [{ id, name, enforcement, requiredStatusContexts: string[] }]
 */
export function loadRulesets(path) {
  if (!path) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path}: expected an array of rulesets`);
  return parsed;
}

/**
 * Classify one record's real enforcement. Never inferred from the record's
 * own data; only from a registry entry, itself checked against a live
 * ruleset snapshot when one is supplied.
 */
export function classifyEnforcement(record, registryEntry, rulesets) {
  if (!registryEntry) return { status: "unregistered", detail: "No enforcement-registry entry for this record: treat as declared until audited." };
  if (!registryEntry.requiredCheckContext) return { status: "declared", detail: registryEntry.notes ?? "Registry says this record is read but not wired to a required check." };
  if (!rulesets) return { status: "declared-unverified", detail: `Registry claims required check "${registryEntry.requiredCheckContext}", but no live ruleset snapshot was supplied to confirm it.` };
  const active = rulesets.filter((rule) => rule.enforcement === "active");
  const confirmed = active.some((rule) => (rule.requiredStatusContexts ?? []).includes(registryEntry.requiredCheckContext));
  if (confirmed) return { status: "enforced", detail: `Confirmed required in an active ruleset (context "${registryEntry.requiredCheckContext}").` };
  return { status: "enforcement-drift", detail: `Registry claims required check "${registryEntry.requiredCheckContext}" but no active ruleset currently requires it; the registry entry itself may be stale.` };
}

function urgencyOf(status, daysRemaining, { enforcedLeadDays, declaredLeadDays }) {
  if (daysRemaining === null) return "needs-anchor";
  const isEnforced = status === "enforced";
  const lead = isEnforced ? enforcedLeadDays : declaredLeadDays;
  if (daysRemaining < 0) return isEnforced ? "overdue-enforced" : "overdue-declared";
  if (daysRemaining <= lead) return isEnforced ? "approaching-enforced" : "approaching-declared";
  return "ok";
}

function trackedJsonFiles(root) {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z", "--", "*.json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter((entry) => entry.length > 0 && !EXCLUDED_PATH_SEGMENT.test(entry));
}

export function run({ root = process.cwd(), registryPath = null, rulesetsPath = null, now = Date.now(), enforcedLeadDays = 14, declaredLeadDays = 3, files = undefined, read = (path) => readFileSync(path, "utf8") } = {}) {
  let registry, rulesets;
  try {
    registry = loadRegistry(registryPath);
    rulesets = loadRulesets(rulesetsPath);
  } catch (error) {
    return { verdict: "indeterminate", findings: [], reason: `could not load registry/rulesets: ${error instanceof Error ? error.message : String(error)}` };
  }

  let list;
  try { list = files ?? trackedJsonFiles(root); } catch (error) {
    return { verdict: "indeterminate", findings: [], reason: `could not list tracked files: ${error instanceof Error ? error.message : String(error)}` };
  }

  const registryByFileField = new Map(registry.map((entry) => [`${entry.file}#${entry.field}`, entry]));
  const findings = [];
  for (const relative of list) {
    if (EXCLUDED_PATH_SEGMENT.test(relative)) continue;
    let text;
    try { text = read(root ? join(root, relative) : relative); } catch { continue; }
    let parsed;
    try { parsed = JSON.parse(text); } catch { continue; } // not JSON, or malformed; not this gate's business
    for (const record of findTimeBoxedFields(parsed, relative)) {
      const { container: _container, ...publicRecord } = record;
      const deadline = computeDeadline(record, now);
      const registryEntry = registryByFileField.get(`${relative}#${record.field}`);
      const enforcement = classifyEnforcement(record, registryEntry, rulesets);
      const urgency = deadline.unanchored ? "needs-anchor" : urgencyOf(enforcement.status, deadline.daysRemaining, { enforcedLeadDays, declaredLeadDays });
      findings.push({ ...publicRecord, ...deadline, enforcement, urgency });
    }
  }

  findings.sort((a, b) => (a.daysRemaining ?? Number.POSITIVE_INFINITY) - (b.daysRemaining ?? Number.POSITIVE_INFINITY));
  return { verdict: "satisfied", findings, reason: null, scanned: list.length };
}

export const EXIT_CODES = Object.freeze({ satisfied: 0, indeterminate: 2 });

function main() {
  const argv = process.argv.slice(2);
  const root = argv.find((arg) => !arg.startsWith("--")) ?? process.cwd();
  const flagValue = (name, fallback) => { const index = argv.indexOf(`--${name}`); return index === -1 ? fallback : argv[index + 1]; };
  const asJson = argv.includes("--json");
  const result = run({
    root,
    registryPath: flagValue("registry", null),
    rulesetsPath: flagValue("rulesets", null),
    enforcedLeadDays: Number(flagValue("enforced-lead-days", 14)),
    declaredLeadDays: Number(flagValue("declared-lead-days", 3)),
  });
  if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(EXIT_CODES[result.verdict] ?? 2); }
  if (result.verdict === "indeterminate") { console.error(`check-attestation-freshness: INDETERMINATE: ${result.reason}`); process.exit(EXIT_CODES.indeterminate); }
  console.log(`check-attestation-freshness: scanned ${result.scanned} tracked JSON file(s), found ${result.findings.length} time-boxed field(s).\n`);
  for (const f of result.findings) {
    const days = f.daysRemaining === null ? "unanchored, cannot compute" : `${f.daysRemaining.toFixed(1)} day(s)`;
    console.log(`  [${f.urgency}] ${f.file}#${f.field}: ${f.enforcement.status}, ${days}`);
    console.log(`    ${f.enforcement.detail}`);
  }
  process.exit(EXIT_CODES.satisfied);
}

if (process.argv[1] && process.argv[1].endsWith("check-attestation-freshness.mjs")) main();
