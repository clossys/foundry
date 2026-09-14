#!/usr/bin/env node
// check-package-visibility — a two-directional, fully anonymous check
// against public npm:
//
//   DECLARED -> is every package governance/release-catalog.json's active
//               target authorizes anonymously installable right now?
//   UNDECLARED -> is every package actually live under the scope on the
//               registry accounted for by that same declaration?
//
//   node scripts/check-package-visibility.mjs [--json] [--declarations-only]
//     [--catalog path] [--scope-file path] [--lifecycle path] [--retention path]
//
// Exit 0 = both directions reconcile cleanly. Exit 1 = at least one finding
// in either direction. Exit 2 = the check could not be completed at all —
// an unresolvable release target, an unsupported registry or access mode,
// an empty declared package set, a network error, a non-200/404 response,
// an unparseable/non-object response, or a roster enumeration that could
// not be trusted. Same three-state contract every gate in this repo uses
// (see CONTRIBUTING.md's "Gate CLIs exit 0/1/2" entry): a check that
// cannot run must fail, never silently pass.
//
// WHY THIS GATE EXISTS (issue #817)
// ------------------------------------
// This gate originally queried GitHub Packages, whose npm registry defaults
// every newly published package to PRIVATE, per package, regardless of this
// repository being public. Nothing before it checked the resulting state; a
// package once sat private across twelve published versions, completely
// uninstallable by any external reader, while its README confidently
// documented `npm install` instructions that could not possibly work.
//
// This repository has since migrated its publishing target to public npm
// (see governance/package-identity-transition.json and
// governance/release-catalog.json's now-"historical" `current-github-packages`
// target versus its active `clossys-npmjs` target). A scoped npm package
// still defaults to RESTRICTED access unless published with `--access
// public` (`npm help access`), so the same failure mode remains possible on
// the new registry — just with a different API to observe it with.
//
// THIS GATE RUNS WITH NO CREDENTIAL, BECAUSE NEITHER ENDPOINT NEEDS ONE
// ---------------------------------------------------------------------------
// A prior revision of this gate authenticated to `GET /-/org/<scope>/package`
// with an `NPM_PACKAGES_TOKEN`. The owner's decision, made explicitly when
// this gate was first reworked: "no token, all pkg are public from foundry
// repo" — that token was never going to be created, and
// `.github/workflows/package-visibility.yml` had gone permanently red with
// no token to read.
//
// Removing the credential requirement is NOT what determines what this gate
// checks, though — read that distinction carefully, because an earlier
// revision of this file conflated the two. Independently re-verified
// 2026-09-14: `GET /-/org/clossys/package`, with NO Authorization header at
// all, returns HTTP 200 and the full package roster; only an actively
// INVALID token gets HTTP 401. The roster endpoint was never
// credential-gated for a public organization. So dropping the token did not
// force dropping the roster-based check that endpoint enables — that would
// have been a scope decision falsely blamed on the credential decision. This
// gate makes BOTH the per-package anonymous packument reads AND the
// anonymous roster read, and is two-directional as a result. See
// "TWO DIRECTIONS" below for exactly what each one checks, and "WHAT THIS
// GATE USED TO DO, AND NO LONGER DOES" for the one piece of the old gate's
// job that WAS cut, as its own separate, argued scope decision.
//
// WHAT THIS GATE CAN AND CANNOT DISTINGUISH, AND WHY THAT'S ENOUGH
// ---------------------------------------------------------------------------
// The DECLARED direction's only network call is the same anonymous
// packument GET every other public-npm gate in this repository already
// uses (scripts/lib/public-npm-registry.mjs's fetchPublicNpmPackument):
//
//   GET https://registry.npmjs.org/<name>, no Authorization header
//     200 -> the package is public and published right now. Definitive.
//     404 -> the package is NOT publicly installable right now. Ambiguous
//            on its own between "never published" and "published but
//            access-restricted" — verified directly against the live
//            registry while reworking this gate (2026-09-14): an
//            unauthenticated `GET /-/package/<name>/visibility` (the
//            endpoint `npm access get status` itself calls) returns HTTP
//            200 with `{"public":false}` for BOTH cases; authenticating to
//            that specific endpoint buys nothing, because it never requires
//            or even accepts a credential in the first place.
//
// This gate DOES NOT try to resolve that ambiguity for the DECLARED
// direction, and says so in its own output. It does not need to: this
// repository's actual invariant is narrower than "tell me why a package is
// hidden" — it is "every package governance/release-catalog.json's active
// target declares must be publicly installable right now." Under that
// invariant, "never published" and "published but private" are the SAME
// failure — both mean an external reader cannot `npm install` a package
// this repository says is live — so a single undifferentiated 404 finding
// is a complete, honest answer for that direction, not a weakened one. A
// 200 is a definitive pass either way.
//
// TWO DIRECTIONS, CLEARLY LABELLED
// ---------------------------------------------------------------------------
// Every result this gate produces carries a `direction`, printed inline in
// both the human-readable and `--json` output, because the two directions
// have different remedies and a reader must not have to guess which one
// they are looking at:
//
//   direction "declared"   — "is this package this repository SAYS is live
//                             actually publicly installable?" A finding
//                             here means: publish it, or fix its access
//                             (`npm access set status=public <name>`).
//   direction "undeclared" — "is this package that IS live under the scope
//                             actually accounted for by a declaration?" A
//                             finding here means: a forgotten publish, a
//                             name something else placed under this scope,
//                             or a release catalogue that has drifted from
//                             reality — governance/release-catalog.json
//                             needs updating, or the package needs to come
//                             down.
//
// The "undeclared" direction needs the full roster
// (fetchNpmScopePackages, anonymous — see above) with the declared set
// (governance/release-catalog.json's active target) subtracted out
// (findUndeclaredPackages). A roster fetch that fails is FATAL for the
// whole run (exit 2) — never silently downgraded to "found: nothing
// undeclared". An empty roster that was genuinely, successfully read (HTTP
// 200, a well-formed `{}` object) is a legitimate zero-undeclared result,
// not an error; the two are distinguished by which code path produced them,
// never conflated.
//
// WHAT THIS GATE USED TO DO, AND NO LONGER DOES
// ---------------------------------------------------------------------------
// The token-era gate also cross-checked a "deprecated" roster package (per
// docs/contracts/package-lifecycle.json) against
// docs/contracts/package-retention.json's `{ reason, reviewBy }`
// declarations, to catch a retention window lapsing while the package
// stayed live. THAT piece — and only that piece — is cut, as its own
// separate, argued scope decision, not a consequence of dropping the
// credential: it needs a second document join on top of the roster diff,
// real standing complexity, and package-retention.json is currently empty
// (no "deprecated" `@clossys` entries), so there is nothing live to protect
// today. Tracked in issue #844 rather than left to silently regress or
// require re-reading this file's history to rediscover. `--declarations-only`
// still validates the retention declaration itself (offline, no roster
// involved) — see below.
//
// EVERY PACKAGE, NOT JUST THE FIRST FAILURE
// --------------------------------------------
// Every declared package, and every roster package, is checked and
// reported; a failure on one never short-circuits the rest. The worst
// status across all results decides the exit code: an error (2) dominates
// a finding (1), which dominates a clean pass (0) — the same aggregation
// check-workspace-links.mjs and check-release-readiness.mjs already use.
//
// NEVER WIRED INTO LOCAL `npm run check`, WITH ONE OFFLINE EXCEPTION
// -----------------------------------------------------------------------
// The live half calls the live public npm registry over the network, so it
// stays out of the hermetic `npm run check` chain and runs in CI instead —
// see .github/workflows/package-visibility.yml's scheduled run — the same
// reason check:registry-parity is kept out of `check` (see its own comment
// in package.json). This is a network-access concern, not a credential
// concern: the live half needs no token at all, it just isn't the kind of
// call every contributor's offline local run should depend on succeeding.
// --declarations-only runs the pure offline half instead (no network, no
// token): it confirms the active release target actually resolves (the same
// loadReleaseCatalog/readCurrentReleaseIdentity/resolveReleaseTarget calls
// the live half depends on, so a broken release-catalog.json is caught with
// a gate-specific message before anything reaches the network) and that
// every "deprecated" package under the active scope carries a valid,
// unexpired retention declaration — the one piece of this gate's job that
// remains knowable before any registry call. It is wired into
// `npm run check:visibility-declarations`, part of `npm run check`.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadReleaseCatalog, readCurrentReleaseIdentity, resolveReleaseTarget } from "./check-release-catalog.mjs";
import { PUBLIC_NPM_REGISTRY, fetchPublicNpmPackument } from "./lib/public-npm-registry.mjs";

const DEFAULT_CATALOG_PATH = "governance/release-catalog.json";
const DEFAULT_SCOPE_PATH = "package-scope.json";
const DEFAULT_LIFECYCLE_PATH = "docs/contracts/package-lifecycle.json";
const DEFAULT_RETENTION_PATH = "docs/contracts/package-retention.json";
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// One label per status, shared by BOTH report paths — see the token-era
// version of this file for the incident that motivated splitting the
// display from the exit-code reducer. Kept in one place so the two paths
// cannot drift into disagreeing about what a status is called.
const STATUS_LABELS = { pass: "PASS ", finding: "FIND ", error: "ERROR" };
const BENIGN_STATUSES = new Set(["pass"]);
// One label per direction — see this file's header's "TWO DIRECTIONS"
// section for what each one means and why they must never be conflated in
// output.
const DIRECTION_LABELS = { declared: "DECLARED  ", undeclared: "UNDECLARED" };

export function isFailureStatus(status) {
  return !BENIGN_STATUSES.has(status);
}

function statusLabel(status) {
  return STATUS_LABELS[status] ?? String(status).toUpperCase();
}

function directionLabel(direction) {
  return DIRECTION_LABELS[direction] ?? String(direction).toUpperCase();
}

function die(msg, code = 2) {
  console.error(`check-package-visibility: ${msg}`);
  process.exit(code);
}

/**
 * Resolves the active release target from governance/release-catalog.json
 * and package-scope.json using check-release-catalog.mjs's own exported,
 * exhaustively-validated functions — never a second parse of either file.
 * Never throws: any failure (malformed catalog, mismatched identity, a
 * historical default target) is returned as `fatal`, the same
 * `{ value, fatal }` shape every other loader in this file uses, so a
 * caller that cannot resolve the declared state can report it as a finding
 * rather than an uncaught exception.
 */
export function resolveActiveVisibilityTarget({ catalogPath = DEFAULT_CATALOG_PATH, scopeFilePath = DEFAULT_SCOPE_PATH, readFile = readFileSync } = {}) {
  try {
    const catalog = loadReleaseCatalog({ path: catalogPath, readFile });
    const identity = readCurrentReleaseIdentity({ path: scopeFilePath, readFile });
    const target = resolveReleaseTarget(catalog, identity);
    return { target, fatal: null };
  } catch (error) {
    return { target: null, fatal: `could not resolve the active release target: ${error.message}` };
  }
}

/**
 * Reads one package's real public-npm visibility, anonymously — the same
 * lookup discipline every other gate in this repository uses for the public
 * registry (scripts/lib/public-npm-registry.mjs's fetchPublicNpmPackument),
 * never a second implementation of the anonymous packument fetch.
 *
 * Returns one of:
 *   - { state: "found", visibility: "public" } — a real, anonymous read
 *     succeeded: this package genuinely is public. Definitive.
 *   - { state: "not-found" } — 404. Deliberately ambiguous between "never
 *     published" and "private" — see this file's header. This gate does not
 *     try to resolve that ambiguity for the DECLARED direction; both are
 *     failures of the same invariant, so both are reported as one
 *     undifferentiated finding.
 *   - { state: "error", detail } — a denied or unreachable anonymous
 *     request. Never treated as "not-found" or silently downgraded to a
 *     pass.
 */
export async function fetchNpmPackageVisibility({ registry, name, fetchImpl }) {
  const result = await fetchPublicNpmPackument({ registry, name, fetchImpl });
  if (result.kind === "found") return { state: "found", visibility: "public" };
  if (result.kind === "not-found") return { state: "not-found" };
  return { state: "error", detail: result.detail ?? `anonymous public npm request for "${name}" could not be completed (${result.kind}).` };
}

/**
 * Enumerates every package name actually live under the npm scope,
 * anonymously — `GET /-/org/<org>/package`, falling back to
 * `/-/user/<org>/package` on a first-page 404, the exact endpoints and
 * fallback order `libnpmaccess`'s own `getPackages` uses (what `npm access
 * list packages` calls). No credential is sent or accepted: this endpoint
 * is not gated on authentication for a public organization — independently
 * re-verified 2026-09-14, `GET /-/org/clossys/package` with no
 * Authorization header returns HTTP 200 and the full roster. See this
 * file's header for why that fact means the "undeclared" direction did not
 * need to be cut alongside the credential.
 *
 * Returns one of:
 *   - { state: "found", packages: [fullScopedName, ...] } — may legitimately
 *     be an empty array (an org that owns nothing yet); that is a real
 *     result, never confused with the error states below.
 *   - { state: "error", detail } — a network error, a non-200/404 HTTP
 *     status, an unparseable response, or an org name neither endpoint
 *     recognises. Deliberately no "found: empty" read as clean on a total
 *     miss from both endpoints — the caller must treat this as fatal
 *     (exit 2), never as "nothing undeclared".
 */
export async function fetchNpmScopePackages({ scope, fetchImpl }) {
  const org = scope.startsWith("@") ? scope.slice(1) : scope;
  for (const kind of ["orgs", "users"]) {
    const url = kind === "orgs" ? `${PUBLIC_NPM_REGISTRY}/-/org/${encodeURIComponent(org)}/package` : `${PUBLIC_NPM_REGISTRY}/-/user/${encodeURIComponent(org)}/package`;
    const label = kind === "orgs" ? "organization" : "user";
    let response;
    try {
      response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    } catch (error) {
      return { state: "error", detail: `network error calling the anonymous npm ${label} package roster endpoint for "${org}": ${error.message}` };
    }
    if (response.status === 404) continue;
    if (!response.ok) {
      return { state: "error", detail: `the anonymous npm ${label} package roster endpoint for "${org}" returned HTTP ${response.status} — could not enumerate registry packages.` };
    }
    let body;
    try {
      body = await response.json();
    } catch (error) {
      return { state: "error", detail: `the anonymous npm ${label} package roster endpoint for "${org}" returned a response this gate could not parse as JSON: ${error.message}` };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { state: "error", detail: `the anonymous npm ${label} package roster endpoint for "${org}" returned a non-object response — could not enumerate registry packages.` };
    }
    return { state: "found", packages: Object.keys(body) };
  }
  return {
    state: "error",
    detail: `neither the anonymous npm organization nor user package roster endpoint could enumerate registry packages for "${org}" — the scope name may be wrong, or npm's roster endpoint shape has changed. Refusing to report a reconciled set it never verified.`,
  };
}

/** True for a well-formed `YYYY-MM-DD` calendar date (rejects `2026-13-40` shapes the regexp alone would accept). */
function isValidCalendarDate(value) {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return asDate.getUTCFullYear() === year && asDate.getUTCMonth() === month - 1 && asDate.getUTCDate() === day;
}

/** True when `reviewBy` (already validated as a real calendar date) is strictly before `now`'s UTC calendar date. */
export function isRetentionExpired(reviewBy, now = new Date()) {
  const match = CALENDAR_DATE_PATTERN.exec(reviewBy);
  if (match === null) return true; // malformed is never treated as "still valid"
  const reviewByUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return reviewByUtc < today;
}

/**
 * Parses docs/contracts/package-retention.json into a Map from package name
 * to its `{ reason, reviewBy }` declaration. Pure, no network. Used only by
 * the offline --declarations-only half now — see this file's header (and
 * issue #844) for why the live half no longer cross-checks retention
 * against the real registry roster.
 */
export function selectRetentionDeclarations(retention) {
  const byName = new Map();
  const findings = [];

  if (!retention || typeof retention !== "object" || !Array.isArray(retention.packages)) {
    return { byName, findings, fatal: `${DEFAULT_RETENTION_PATH} does not have the expected { packages: [...] } shape` };
  }

  for (const entry of retention.packages) {
    const name = entry && typeof entry === "object" && typeof entry.name === "string" ? entry.name : undefined;
    const malformed =
      !entry ||
      typeof entry !== "object" ||
      typeof name !== "string" ||
      name.length === 0 ||
      typeof entry.reason !== "string" ||
      entry.reason.trim().length === 0 ||
      typeof entry.reviewBy !== "string" ||
      !isValidCalendarDate(entry.reviewBy);
    if (malformed) {
      findings.push({
        package: name ?? "(unnamed)",
        status: "error",
        detail: `a ${DEFAULT_RETENTION_PATH} entry requires a non-empty "name", a non-empty "reason", and a "reviewBy" date in YYYY-MM-DD form — malformed retention data can never justify keeping a deprecated package on the registry.`,
      });
      continue;
    }
    if (byName.has(name)) {
      findings.push({ package: name, status: "error", detail: `"${name}" has more than one entry in ${DEFAULT_RETENTION_PATH}.` });
      continue;
    }
    byName.set(name, { reason: entry.reason, reviewBy: entry.reviewBy });
  }

  return { byName, findings, fatal: null };
}

/**
 * The DECLARED direction: for every package the active release target
 * authorizes, look up whether it is anonymously installable from public npm
 * right now. Every package is checked — a failure on one never stops the
 * rest.
 *
 * A 404 is always a finding here, never a benign skip: this gate does not
 * distinguish "never published" from "private" for this direction (see this
 * file's header), and this repository's invariant is that every declared
 * package must be public right now, so an absence is not an expected steady
 * state.
 */
export async function checkDeclaredPackages({ target, fetchImpl }) {
  const results = [];
  const lookups = { attempted: 0, found: 0 };

  for (const directory of target.packages) {
    const name = `${target.scope}/${directory}`;
    lookups.attempted += 1;
    const outcome = await fetchNpmPackageVisibility({ registry: target.registry, name, fetchImpl });
    if (outcome.state === "error") {
      results.push({ package: name, direction: "declared", status: "error", detail: `could not determine whether "${name}" is publicly installable: ${outcome.detail}` });
      continue;
    }
    if (outcome.state === "found") {
      lookups.found += 1;
      results.push({ package: name, direction: "declared", status: "pass", detail: `"${name}" is anonymously readable on ${target.registry} — publicly installable right now.` });
      continue;
    }
    // not-found: an anonymous 404. Deliberately undifferentiated — see this
    // file's header for why this gate does not try to tell "never
    // published" apart from "private" for this direction, and why it does
    // not need to.
    results.push({
      package: name,
      direction: "declared",
      status: "finding",
      detail:
        `"${name}" returned HTTP 404 from an anonymous request to ${target.registry} — it is NOT publicly installable right now. ` +
        "This gate cannot tell, and does not try to tell, whether that is because the package has never been published or because " +
        `it is registered but access-restricted (npm defaults every scoped package to restricted access unless published with ` +
        `--access public) — both are failures of this repository's invariant that every package the active release target ` +
        `declares must already be public. If it has been published, an owner can confirm with \`npm access set status=public ${name}\` ` +
        `(see docs/PUBLISHING.md's "Public access and parity" section); if it has not, publish it.`,
    });
  }

  return { results, lookups };
}

/**
 * The UNDECLARED direction: for every package actually live under the
 * scope (`roster`), does the active release target's declared package set
 * account for it? A roster package the target authorizes was already
 * reconciled by checkDeclaredPackages above and is skipped here — this
 * function only reports packages the roster holds that the declaration does
 * not name at all.
 *
 * Deliberately does NOT special-case a "deprecated" lifecycle status — that
 * cross-check (docs/contracts/package-lifecycle.json joined against
 * docs/contracts/package-retention.json) was cut as its own scope decision;
 * see this file's header and issue #844. Every undeclared roster package is
 * a finding here, full stop: a forgotten publish, a name something else put
 * under this scope, or a release catalogue that has drifted from reality.
 */
export function findUndeclaredPackages(roster, target) {
  const declaredNames = new Set(target.packages.map((directory) => `${target.scope}/${directory}`));
  const results = [];
  for (const name of roster) {
    if (declaredNames.has(name)) continue;
    results.push({
      package: name,
      direction: "undeclared",
      status: "finding",
      detail:
        `"${name}" is live on ${target.registry} under ${target.scope}, but the active release target ("${target.id}") does not ` +
        "declare it. This is a forgotten publish, a name something else placed under this scope, or " +
        `${DEFAULT_CATALOG_PATH} has drifted from reality — update the catalogue if this is intentional, or remove the package ` +
        "from the registry if it is not.",
    });
  }
  return results;
}

/**
 * The full, two-directional check, orchestrated as one pure-async function
 * so it is testable end-to-end with an injected `fetchImpl` — never through
 * a spawned CLI process, which cannot inject a fake network. No credential
 * is accepted or required: every call this function makes, in both
 * directions, is anonymous.
 */
export async function checkAllPackageVisibility({ target, fetchImpl }) {
  if (target.registry !== PUBLIC_NPM_REGISTRY) {
    return { fatal: `the active release target ("${target.id}") registry is "${target.registry}", not ${PUBLIC_NPM_REGISTRY} — this gate only knows how to verify visibility on public npm.`, code: 2 };
  }
  if (target.access !== "public") {
    return { fatal: `the active release target ("${target.id}") declares access "${target.access}" — this gate only verifies anonymous PUBLIC installability and cannot meaningfully check a non-public target.`, code: 2 };
  }
  if (!Array.isArray(target.packages) || target.packages.length === 0) {
    return { fatal: `the active release target ("${target.id}") authorizes no packages — refusing to report a clean pass on an empty scan`, code: 2 };
  }

  const { results: declaredResults, lookups } = await checkDeclaredPackages({ target, fetchImpl });

  // The roster fetch is fatal on failure, never silently read as "nothing
  // undeclared" — see fetchNpmScopePackages's own header and this file's
  // "TWO DIRECTIONS" section.
  const rosterResult = await fetchNpmScopePackages({ scope: target.scope, fetchImpl });
  if (rosterResult.state === "error") {
    return { fatal: `could not enumerate public npm packages for ${target.scope}: ${rosterResult.detail}`, code: 2 };
  }
  const roster = new Set(rosterResult.packages);

  const undeclaredResults = findUndeclaredPackages(roster, target);
  const allResults = [...declaredResults, ...undeclaredResults];

  // Worst-of-three: an error anywhere dominates a finding, which dominates a
  // clean pass. An UNRECOGNISED status is treated as `error`, never falls
  // through to a pass — see isFailureStatus.
  const code = allResults.reduce((acc, r) => (isFailureStatus(r.status) && r.status !== "finding" ? 2 : r.status === "finding" && acc !== 2 ? 1 : acc), 0);

  return { fatal: null, code, results: allResults, lookups, registryPackagesEnumerated: roster.size };
}

// ------------------------------------------------------------------- main

function parseArgs(argv) {
  const options = {
    json: false,
    declarationsOnly: false,
    catalogPath: DEFAULT_CATALOG_PATH,
    scopeFilePath: DEFAULT_SCOPE_PATH,
    lifecyclePath: DEFAULT_LIFECYCLE_PATH,
    retentionPath: DEFAULT_RETENTION_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") options.json = true;
    else if (flag === "--declarations-only") options.declarationsOnly = true;
    else if (flag === "--catalog") options.catalogPath = argv[++index];
    else if (flag === "--scope-file") options.scopeFilePath = argv[++index];
    else if (flag === "--lifecycle") options.lifecyclePath = argv[++index];
    else if (flag === "--retention") options.retentionPath = argv[++index];
    else die(`usage: check-package-visibility.mjs [--json] [--declarations-only] [--catalog path] [--scope-file path] [--lifecycle path] [--retention path]`);
  }
  return options;
}

function readJsonFile(path) {
  if (!existsSync(path)) die(`no document at ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(`${path} does not parse as JSON: ${error.message}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const { target, fatal: targetFatal } = resolveActiveVisibilityTarget({ catalogPath: options.catalogPath, scopeFilePath: options.scopeFilePath });
  if (targetFatal) die(targetFatal);

  if (options.declarationsOnly) {
    // The pure offline half: confirms the active target resolved above (a
    // network-free property this gate's live half depends on) and that
    // every "deprecated" package under the active scope has a valid,
    // unexpired retention declaration — the one piece of this gate's job
    // knowable before any registry call. This does NOT confirm the
    // declaration matches the real registry roster — see this file's
    // header and issue #844 for why that cross-check no longer exists.
    const retention = readJsonFile(options.retentionPath);
    const lifecycle = readJsonFile(options.lifecyclePath);
    const { byName: retentionByName, findings: retentionFindings, fatal: retentionFatal } = selectRetentionDeclarations(retention);
    if (retentionFatal) die(retentionFatal);

    const results = [...retentionFindings];
    let deprecatedChecked = 0;
    for (const entry of lifecycle.packages ?? []) {
      if (!entry || typeof entry !== "object" || typeof entry.name !== "string" || !entry.name.startsWith(`${target.scope}/`) || entry.status !== "deprecated") continue;
      deprecatedChecked += 1;
      const retentionEntry = retentionByName.get(entry.name);
      if (retentionEntry && !isRetentionExpired(retentionEntry.reviewBy)) {
        results.push({ package: entry.name, status: "pass", detail: `"${entry.name}" is "deprecated" and has a valid retention declaration (reviewBy ${retentionEntry.reviewBy}).` });
      } else {
        results.push({
          package: entry.name,
          status: "finding",
          detail: retentionEntry
            ? `"${entry.name}" is "deprecated" but its ${options.retentionPath} entry expired on ${retentionEntry.reviewBy}.`
            : `"${entry.name}" is "deprecated" under the active scope but has no entry in ${options.retentionPath}.`,
        });
      }
    }

    const findings = results.filter((r) => isFailureStatus(r.status));
    if (options.json) {
      console.log(JSON.stringify({ mode: "declarations-only", target: target.id, deprecatedChecked, results }, null, 2));
    } else {
      for (const r of results) console.log(`  [${statusLabel(r.status)}] ${r.package} — ${r.detail}`);
      if (findings.length === 0) {
        console.log(
          `PACKAGE VISIBILITY DECLARATIONS OK — active release target "${target.id}" (${target.scope} at ${target.registry}) resolved cleanly, ` +
            `and ${deprecatedChecked} "deprecated" package(s) under that scope declare valid retention.`,
        );
        console.log("Live registry visibility is NOT checked here; that half runs anonymously (no credential) on schedule.");
      } else {
        console.log("");
        console.log("PACKAGE VISIBILITY DECLARATIONS FAIL — see FIND lines above. This is the offline half of the gate.");
      }
    }
    process.exit(findings.length === 0 ? 0 : 1);
  }

  // No token required, ever — every call this gate makes, in both
  // directions, is anonymous. See this file's header for the owner's
  // decision, why it did not by itself force cutting the roster-based
  // "undeclared" direction, and what was cut instead (issue #844).
  const outcome = await checkAllPackageVisibility({ target, fetchImpl: fetch });
  if (outcome.fatal) die(outcome.fatal, outcome.code);

  const { results: allResults, lookups, registryPackagesEnumerated, code: worst } = outcome;

  if (options.json) {
    console.log(JSON.stringify({ target: target.id, results: allResults, registryPackagesEnumerated }, null, 2));
  } else {
    for (const r of allResults) console.log(`  [${statusLabel(r.status)}] [${directionLabel(r.direction)}] ${r.package} — ${r.detail}`);
  }

  if (!options.json) {
    console.log("");
    console.log(
      worst === 0
        ? `PACKAGE VISIBILITY OK — all ${lookups.attempted} declared package(s) are anonymously installable from public npm right now, and ` +
            `all ${registryPackagesEnumerated} package(s) actually live under ${target.scope} are accounted for by the active release target. ` +
            "No credential was used or needed, in either direction."
        : worst === 2
          ? "PACKAGE VISIBILITY ERROR — could not determine at least one result (see ERROR lines above). This is not a pass."
          : "PACKAGE VISIBILITY FAIL — see FIND lines above. [DECLARED] findings mean a declared package is not publicly installable; " +
              "[UNDECLARED] findings mean a live package is not accounted for by the declaration. Different remedies — see each finding's detail.",
    );
  }
  process.exit(worst);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
}
