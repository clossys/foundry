#!/usr/bin/env node

// dependency-audit-outcomes — a SECOND independent `LandedChangeOutcome`
// source for @clossys/observer's escape-rate metric, this time for the
// "dependency audit" gate (`npm audit --audit-level=high`; see
// package.json's `check:dependency-audit` and .github/workflows/ci.yml's
// `dependency-audit` job).
//
// #484 asked for a second gate to move off the `could-not-read` lower bound
// that every gate except "publish safety" reports. `secret-scanning-
// outcomes.mjs` is the one existing instance — this module mirrors its
// SHAPE (the same `LandedChangeOutcome[]` this file's own header documents,
// the same push-only landing filter, the same "unreadable input never
// becomes a clean verdict" discipline) but not its MECHANISM, because the
// independent source it draws from answers a structurally different
// question. See below.
//
// THE INDEPENDENT SOURCE: GitHub's OWN Dependabot alerts
// ---------------------------------------------------------
// This repository is public with Dependabot alerts enabled (verified
// empirically: `gh api repos/<owner>/<repo>/dependabot/alerts` returns a
// real, readable array). Dependabot's alert engine is not invoked by this
// repository's own CI, shares no code with `npm audit`, cannot be
// influenced by a pull request's own changes to this repository's
// workflows or scripts, and is computed by GitHub from the dependency graph
// it derives from `package-lock.json` independently of whether or when any
// workflow here runs. That is the same independence argument `secret-
// scanning-outcomes.mjs`'s own header makes for GitHub's secret scanning,
// applied to a different GitHub-operated detector for a different gate.
//
// WHY THIS CHECKS TREE STATE DIRECTLY, NEVER A DIFF
// ----------------------------------------------------
// `secretScanningOutcomes` diffs each landed push against the previous
// landed push, because secret-scanning alerts report the exact COMMIT(S)
// a secret's file content was found at, and a landing can span more than
// one real commit (a rebase-landed pull request in particular — see that
// module's own header). `npm audit --audit-level=high` has no equivalent
// per-commit notion: it re-evaluates the CURRENT, WHOLE locked dependency
// tree on every run, regardless of what changed. So the matching question
// here is not "did any commit this landing introduced touch a vulnerable
// line" but "was `package-lock.json`, AS OF this landed change's own tree,
// carrying a version the gate should have failed on". That is answered by
// reading `package-lock.json` at each landed `changeId` directly (`git show
// <changeId>:package-lock.json`) and checking it against Dependabot's own
// vulnerable-version data — no commit ordering, no diffing, and therefore
// no dependency on `orderLandedChangesChronologically` or
// `commitsIntroducedSince` at all. A landed change with an unreadable
// lockfile at that commit reports `could-not-read` for itself alone, same
// discipline, different reason than the "oldest entry in the window" case
// that diffing needs and this does not.
//
// ONLY "push" EVENTS ARE LANDINGS
// ---------------------------------
// Same reasoning as `secret-scanning-outcomes.mjs`: a merged pull request
// produces both a `pull_request`-event run history row (keyed by the PR
// branch's own pre-merge head SHA) and a `push`-event row (keyed by
// whatever actually landed) for the same real change. Counting both would
// double the denominator and could double-count one real escape. This
// module only ever considers `event === "push"` rows.
//
// SEVERITY SCOPE MATCHES THE GATE, ON PURPOSE
// -----------------------------------------------
// `check:dependency-audit` runs `npm audit --audit-level=high`, which fails
// only on `high` or `critical` advisories — `moderate` and `low` are
// visible in its output but do not fail the gate. Counting a `moderate`
// Dependabot alert as an escape would measure this module's own,
// stricter opinion of severity, not whether the ACTUAL gate was defeated.
// Only `high`/`critical` `security_vulnerability.severity` values are
// treated as violations this gate should have caught.
//
// DISMISSALS THAT ARE NOT VIOLATIONS
// -------------------------------------
// Dependabot's own dismissal reasons that mean "this was never a real,
// applicable vulnerability" are the ecosystem analogue of secret-scanning's
// `false_positive`/`used_in_tests`: `inaccurate` (the advisory itself was
// wrong) and `not_used` (the flagged code path is not reachable — GitHub's
// own documented meaning, distinct from "fixed" or "tolerable risk", which
// both still mean the vulnerable version really landed). Every other alert
// — open, fixed, dismissed for `tolerable_risk`/`fix_started`/
// `no_bandwidth`, or auto-dismissed — counts as a real, landed
// vulnerability: reaching `main` at all is the fact the gate exists to
// prevent, independent of whether it was later cleaned up. Same rule
// `secret-scanning-outcomes.mjs` applies, restated for this API's own
// dismissal vocabulary.
//
// A MINIMAL, SCOPED SEMVER COMPARATOR — NOT A DEPENDENCY
// -----------------------------------------------------------
// GitHub's `vulnerable_version_range` uses a small, well-documented grammar:
// comma-separated constraints of the form `<op> <version>` (`=`, `<`, `<=`,
// `>`, `>=`), ANDed together, or the literal `*` meaning every published
// version. That is a strict subset of full npm semver ranges (no `||`, no
// `~`/`^`, no `x`-ranges), so this module implements exactly that grammar
// plus standard semver precedence (semver.org section 11) rather than
// adding a `semver` dependency to a `scripts/` tree that has none today. A
// constraint this comparator cannot parse is treated as unmatched rather
// than thrown — see `parseConstraint`'s own comment for why silently
// widening the escape count on a shape surprise would be worse than
// under-reading one alert, and `KNOWN REMAINING LIMITATIONS` below.
//
// KNOWN REMAINING LIMITATIONS
// -------------------------------
// - Single-page alert fetching: `fetchAllAlerts` reads one page (100 items),
//   matching `secret-scanning-outcomes.mjs`'s own existing convention and
//   carrying the same under-read risk past 100 alerts. Not fixed here.
// - Ecosystem scope: only `ecosystem === "npm"` alerts are considered, since
//   this is an npm workspace and only `package-lock.json` is read. Correct
//   for this repository today; would need extending if another ecosystem's
//   manifest is ever added.
// - A `vulnerable_version_range` constraint outside the grammar above is
//   skipped for that one alert (logged nowhere, silently excluded from the
//   violating set) rather than failing the whole read. A real GHSA range
//   this comparator cannot parse would under-report, never over-report.

import { execFileSync } from "node:child_process";

const ALERTS_PER_PAGE = 100;

/** `npm audit --audit-level=high` fails only at these severities. See this module's header. */
const AUDIT_LEVEL_SEVERITIES = new Set(["high", "critical"]);

/** Dependabot dismissal reasons that mean "this was never a real, applicable vulnerability". Every other alert counts. See this module's header. */
const NON_VIOLATION_DISMISSAL_REASONS = new Set(["inaccurate", "not_used"]);

/** This module only reads `package-lock.json`; only npm-ecosystem alerts can be checked against it. */
const NPM_ECOSYSTEM = "npm";

function couldNotRead(gate, changeId, note) {
  return { gate, changeId, violation: { state: "could-not-read", note, source: "github-dependabot" } };
}

/** Fetches every Dependabot alert this token can see, any state, in one call — the endpoint's `state` filter is optional and omitting it returns alerts in every state. One page; see this module's header on the pagination limitation. */
async function fetchAllAlerts(fetchJson, owner, repo) {
  const alerts = await fetchJson(`repos/${owner}/${repo}/dependabot/alerts?per_page=${ALERTS_PER_PAGE}`);
  if (!Array.isArray(alerts)) {
    throw new Error("dependabot alerts response was not an array — a changed API shape, or an error body");
  }
  return alerts;
}

/**
 * Every `{ name, range }` pair genuinely representing a landed high/critical
 * npm vulnerability — filtered for ecosystem, severity, and non-violation
 * dismissals exactly as this module's header documents.
 */
export function violatingRanges(alerts) {
  const ranges = [];
  for (const alert of alerts) {
    if (NON_VIOLATION_DISMISSAL_REASONS.has(alert?.dismissed_reason)) continue;
    const vuln = alert?.security_vulnerability;
    if (!vuln || typeof vuln.vulnerable_version_range !== "string") continue;
    if (vuln.package?.ecosystem !== NPM_ECOSYSTEM) continue;
    if (typeof vuln.package?.name !== "string") continue;
    if (!AUDIT_LEVEL_SEVERITIES.has(vuln.severity)) continue;
    ranges.push({ name: vuln.package.name, range: vuln.vulnerable_version_range });
  }
  return ranges;
}

// ---- a minimal semver comparator, scoped to what this module needs — see this module's header ----

/** Splits `MAJOR.MINOR.PATCH[-prerelease][+build]` into comparable parts. Missing numeric fields default to 0; build metadata is dropped (per semver.org, it never affects precedence). */
function parseVersion(raw) {
  const withoutBuild = String(raw).split("+")[0];
  const dashIndex = withoutBuild.indexOf("-");
  const versionPart = dashIndex === -1 ? withoutBuild : withoutBuild.slice(0, dashIndex);
  const prereleasePart = dashIndex === -1 ? null : withoutBuild.slice(dashIndex + 1);
  const numbers = versionPart.split(".").map((n) => {
    const parsed = Number(n);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  while (numbers.length < 3) numbers.push(0);
  return { numbers, prerelease: prereleasePart === null || prereleasePart === "" ? null : prereleasePart.split(".") };
}

/** semver.org section 11's precedence rule for one pair of dot-separated prerelease identifiers. */
function compareIdentifiers(a, b) {
  const an = Number(a);
  const bn = Number(b);
  const aIsNumeric = a !== "" && String(an) === a && Number.isFinite(an);
  const bIsNumeric = b !== "" && String(bn) === b && Number.isFinite(bn);
  if (aIsNumeric && bIsNumeric) return an - bn;
  if (aIsNumeric) return -1; // numeric identifiers always have lower precedence than alphanumeric ones
  if (bIsNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `< 0` when `rawA` precedes `rawB`, `0` when equal precedence, `> 0` otherwise. Per semver.org section 11. */
export function compareVersions(rawA, rawB) {
  const a = parseVersion(rawA);
  const b = parseVersion(rawB);
  for (let i = 0; i < 3; i += 1) {
    if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] - b.numbers[i];
  }
  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1; // a release version has HIGHER precedence than the same version with a prerelease
  if (b.prerelease === null) return -1;
  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < len; i += 1) {
    if (a.prerelease[i] === undefined) return -1; // fewer prerelease fields sort first
    if (b.prerelease[i] === undefined) return 1;
    const cmp = compareIdentifiers(a.prerelease[i], b.prerelease[i]);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

const CONSTRAINT_RE = /^(=|<=|>=|<|>)?\s*(.+)$/;

/** A version bound's own shape: digit groups joined by dots, plus an optional `-prerelease`/`+build` suffix — never a partial or wildcard form like `1.x`, which GitHub's own `vulnerable_version_range` grammar never emits. */
const VERSION_BOUND_RE = /^[0-9]+(\.[0-9]+){0,2}(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/**
 * One `<op> version` constraint from a `vulnerable_version_range`. Returns
 * `null` for a constraint outside the recognized grammar rather than
 * throwing — see this module's header on why an unparseable constraint is
 * excluded, never guessed.
 */
function parseConstraint(constraintText) {
  const trimmed = constraintText.trim();
  const match = CONSTRAINT_RE.exec(trimmed);
  if (!match) return null;
  const [, op = "=", bound] = match;
  if (!VERSION_BOUND_RE.test(bound)) return null;
  return { op, bound };
}

function satisfiesConstraint(version, constraint) {
  const cmp = compareVersions(version, constraint.bound);
  switch (constraint.op) {
    case "=":
      return cmp === 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    default:
      return false;
  }
}

/** Whether `version` falls inside GitHub's own `vulnerable_version_range` grammar (comma-separated, ANDed constraints, or `*` for "every version"). */
export function satisfiesRange(version, range) {
  const trimmed = String(range).trim();
  if (trimmed === "*") return true;
  const constraints = trimmed.split(",").map(parseConstraint);
  if (constraints.some((c) => c === null)) return false; // an unrecognized clause never matches — see this module's header
  return constraints.every((c) => satisfiesConstraint(version, c));
}

/**
 * Every version of every npm package recorded anywhere in the lockfile tree
 * at `changeId`, read via `git show`. Walks lockfileVersion 2/3's flat
 * `packages` map (keyed `node_modules/.../<name>`, so a scoped package like
 * `@scope/name` and a nested transitive copy at a different version both
 * resolve correctly) and falls back to lockfileVersion 1's nested
 * `dependencies` tree for an older lockfile shape.
 */
export function lockedVersionsAt(changeId, execFile = execFileSync) {
  const raw = execFile("git", ["show", `${changeId}:package-lock.json`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lock = JSON.parse(raw);
  const byName = new Map();
  const record = (name, version) => {
    if (typeof name !== "string" || typeof version !== "string") return;
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(version);
  };

  if (lock.packages && typeof lock.packages === "object") {
    for (const [key, pkg] of Object.entries(lock.packages)) {
      if (key === "") continue; // the root package entry, not a dependency
      const segments = key.split("node_modules/");
      const name = segments[segments.length - 1];
      record(name, pkg?.version);
    }
  } else if (lock.dependencies && typeof lock.dependencies === "object") {
    const walk = (deps) => {
      for (const [name, entry] of Object.entries(deps ?? {})) {
        record(name, entry?.version);
        if (entry?.dependencies) walk(entry.dependencies);
      }
    };
    walk(lock.dependencies);
  }
  return byName;
}

/**
 * Builds real `LandedChangeOutcome` rows for `gate` from GitHub's own
 * Dependabot alerts, for every `push`-event `changeId` in `records` matching
 * `gate`.
 *
 * Never throws: a transport failure reading alerts reports `could-not-read`
 * for every requested change (an unreadable alert list must not silently
 * shrink the denominator, same discipline `secretScanningOutcomes` and
 * `collectJobs` both already follow); a `changeId` whose lockfile cannot be
 * read or parsed at that commit reports `could-not-read` for that entry
 * alone.
 */
export async function dependencyAuditOutcomes({ fetchJson, owner, repo, records, gate, execFile = execFileSync }) {
  const changeIds = [
    ...new Set(records.filter((r) => r.gate === gate && r.event === "push").map((r) => r.changeId)),
  ];
  if (changeIds.length === 0) return [];

  let alerts;
  try {
    alerts = await fetchAllAlerts(fetchJson, owner, repo);
  } catch (error) {
    const note = `could not read dependabot alerts: ${error?.message ?? error}`;
    return changeIds.map((changeId) => couldNotRead(gate, changeId, note));
  }

  const ranges = violatingRanges(alerts);

  return changeIds.map((changeId) => {
    let versionsByName;
    try {
      versionsByName = lockedVersionsAt(changeId, execFile);
    } catch (error) {
      return couldNotRead(
        gate,
        changeId,
        `could not read package-lock.json at ${changeId}: ${error?.message ?? error}`,
      );
    }
    const escaped = ranges.some(({ name, range }) => {
      const versions = versionsByName.get(name);
      if (!versions) return false;
      return [...versions].some((version) => satisfiesRange(version, range));
    });
    return {
      gate,
      changeId,
      violation: escaped
        ? { state: "observed", source: "github-dependabot" }
        : { state: "unobserved", source: "github-dependabot" },
    };
  });
}
