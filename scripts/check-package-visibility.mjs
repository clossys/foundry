#!/usr/bin/env node
// check-package-visibility — fail when a package this repository intends to
// be public is actually PRIVATE on the active public npm registry target.
//
//   node scripts/check-package-visibility.mjs [--json] [--declarations-only]
//     [--catalog path] [--scope-file path] [--lifecycle path] [--retention path]
//
// This is a two-directional check, same as always. It starts from
// governance/release-catalog.json's ACTIVE release target — the exact
// package/scope/registry/access tuple check-release-catalog.mjs already
// validates — and asks the registry whether each authorized package's real
// visibility matches that target's declared `access` (or has never been
// published, which is not a violation — see NOT PUBLISHED YET below). AND it
// starts from the registry's own package roster and asks the declaration
// whether it agrees a package should be there at all. Exit 0 = both
// directions reconcile cleanly. Exit 1 = at least one finding in either
// direction (a visibility mismatch, or a package live on the registry that
// the active target does not authorize). Exit 2 = the check could not be
// completed — no token, an unresolvable release target, an API error, a rate
// limit, an unreachable endpoint, an unparseable response, or a registry
// enumeration that could not be trusted. Same three-state contract every
// gate in this repo uses (see CONTRIBUTING.md's "Gate CLIs exit 0/1/2"
// entry): a check that cannot run must fail, never silently pass.
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
// target versus its active `clossys-npmjs` target). GitHub Packages is no
// longer where this repository publishes, so a gate that still queried it
// could only ever report "not found" for everything — which is exactly what
// broke: `.github/workflows/package-visibility.yml` failed daily with "all
// 19 declared package(s) returned not found", because the credential and the
// endpoint were both pointed at a registry this repository stopped using.
//
// THE SAME FAILURE MODE EXISTS ON PUBLIC NPM
// -----------------------------------------------
// A scoped npm package defaults to RESTRICTED access unless published with
// `--access public` (`npm help access`; `docs/PUBLISHING.md`'s "Public
// access and parity" section notes every W1D manifest declares
// `publishConfig.access: "public"` as source policy, not registry proof).
// So this gate's job is not retired by the migration — it still has a real
// incident to catch, just on a different registry with a different API
// shape.
//
// THE DISTINCTION THIS GATE STILL HAS TO MAKE, AND HOW NPM'S API DIFFERS
// ---------------------------------------------------------------------------
// GitHub Packages returned 404, not 403, for a package the caller could not
// see — "never published" and "published but invisible to this credential"
// were the same response. Public npm's ANONYMOUS per-package check
// (registry.npmjs.org/<name>, what scripts/lib/public-npm-registry.mjs's
// fetchPublicNpmPackument already performs — reused here rather than
// duplicated) has the exact same ambiguity: a private package and a
// never-published one both 404 anonymously. Verified directly against the
// live registry while building this gate: an unauthenticated
// `GET /-/package/<name>/visibility` — the endpoint `npm access get status`
// itself calls — returns HTTP 200 with `{"public":false}` for BOTH a
// genuinely-restricted package and one that has never existed at all; it
// never requires or even accepts a credential, so authenticating to that
// specific endpoint buys nothing.
//
// The endpoint that DOES resolve the ambiguity is the one GitHub's own LIST
// endpoint answered for: `GET /-/org/<org>/package` (falling back to
// `/-/user/<user>/package` on 404 — the same org-then-user fallback
// `fetchNpmOrgPackages` below uses, mirrored from `libnpmaccess`'s own
// `getPackages`, the function `npm access list packages` itself calls).
// Authenticated as an account with read access
// to this npm organization, it enumerates every package name the
// organization actually holds, public or private, REGARDLESS of whether an
// anonymous reader could see it. A name present in that authenticated roster
// but absent from the anonymous per-package check is exactly the incident
// this gate exists to catch: published, but invisible to everyone else. A
// name absent from the roster too has simply never been published.
//
// A word on what this endpoint does NOT do, because an earlier revision of
// this comment claimed the opposite and was wrong. It is not gated on
// authentication: measured 2026-09-14, `GET /-/org/clossys/package` with no
// Authorization header at all returns HTTP 200 and the full roster, and the
// same is true of other public organizations. Only an actively invalid or
// expired credential returns 401 ("You must be logged in to publish
// packages."). So "the roster call fails loudly if the credential is lost"
// holds for a WRONG token, not for a MISSING one — a missing one never
// reaches the network, because the token check in main() exits 2 first.
// The aggregate guard is
// kept anyway, as defence in depth — see the guard in
// checkAllPackageVisibility for why an all-miss result stays suspicious even
// though the roster call's own auth failure would normally have caught it
// first.
//
// WHERE THE DECLARED PACKAGE SET AND INTENT COME FROM, AND WHY NOT A SECOND
// PER-PACKAGE DECLARATION FILE
// ---------------------------------------------------------------------------
// The GitHub-Packages version of this gate read its declared package set
// from docs/contracts/package-lifecycle.json's "published" entries, joined
// against a bespoke docs/contracts/package-visibility.json (one
// `intendedVisibility` per package). Neither is the right source for the
// active npm target: package-lifecycle.json's "published" status today
// describes the RETIRED GitHub Packages identity's history
// (docs/PUBLISHING.md: "its nineteen `published` entries describe source
// lifecycle targets, not proof that an `@clossys` artifact is already
// registry-served") — every current `@clossys/*` entry there carries status
// "active", a distinct, earlier value in that same enum. Re-deriving the
// declared package set from lifecycle status would therefore either find
// zero current packages to check (querying nothing, an empty-scan gate that
// never runs) or require this gate to unilaterally reinterpret "active" as
// "published" — a lifecycle-vocabulary decision this gate has no standing to
// make on its own.
//
// governance/release-catalog.json's ACTIVE target already IS the reviewed,
// exhaustively-validated (see check-release-catalog.mjs) authorization for
// exactly which packages are meant to be live and public right now, at which
// scope, on which registry, with which access level — the same authority
// scripts/select-publishable-packages.mjs and publish.yml already answer to.
// Reading it here (via check-release-catalog.mjs's own exported
// `loadReleaseCatalog` / `readCurrentReleaseIdentity` / `resolveReleaseTarget`,
// never a re-parsed or hardcoded copy) satisfies AGENTS.md's "the publishing
// scope lives in exactly one file" rule by construction, and needs no second
// per-package intent file: every package a target authorizes shares that
// target's one `access` value, so `docs/contracts/package-visibility.json`
// (which still names the retired producer scope — dead input, nothing else
// in this repository reads it) is no longer consulted.
// docs/contracts/package-retention.json remains load-bearing — see below.
//
// NOT PUBLISHED YET, vs. PRIVATE
// --------------------------------
// A package the roster has never held is an ordinary pre-publish state, not
// a violation: `docs/PUBLISHING.md` says so explicitly for the current W1D
// state ("A missing package is the expected W1D state, never a passing
// parity result"). One the roster DOES hold, but which the anonymous check
// cannot see, is exactly the incident this gate exists to catch. Both are
// always reported — never silently skipped — but only the second counts as
// a finding.
//
// "DEPRECATED" IS NOT AUTOMATICALLY WRONG — A THIRD STATE, NOT TWO
// --------------------------------------------------------------------
// A registry package that the active target does not authorize is not
// automatically a defect: a lifecycle entry under the active scope with
// status "deprecated" is the intended state — existing consumers keep
// resolving it while new adoption is steered to its replacement (see
// docs/DECISIONS.md's "On retiring the compatibility packages" section).
// This gate asks docs/contracts/package-retention.json
// (selectRetentionDeclarations, unchanged from the GitHub-Packages version)
// for a `{ reason, reviewBy }` declaration before treating a live-deprecated
// package as satisfied; an undeclared or expired one is a finding, never
// silently fine. There are currently no deprecated `@clossys` entries and
// package-retention.json is intentionally empty (docs/PUBLISHING.md), so
// this path is exercised only by its own tests today — see
// scripts/check-package-visibility.test.mjs.
//
// EVERY PACKAGE, NOT JUST THE FIRST FAILURE
// --------------------------------------------
// Every declared package is checked and reported; a failure on one never
// short-circuits the rest. The worst status across all results decides the
// exit code: an error (2) dominates a finding (1), which dominates a clean
// pass or a not-yet-published report (0) — the same aggregation
// check-workspace-links.mjs and check-release-readiness.mjs already use.
//
// NEVER WIRED INTO LOCAL `npm run check`, WITH ONE OFFLINE EXCEPTION
// -----------------------------------------------------------------------
// The live half calls the public npm registry and needs an authenticated
// token to enumerate the organization's roster, so it stays out of the
// hermetic `npm run check` chain and runs in CI instead — see
// .github/workflows/package-visibility.yml's scheduled run. --declarations-only
// runs the pure offline half instead (no network, no token): it confirms the
// active release target actually resolves (the same
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

// One label per status, shared by BOTH report paths — see the GitHub-Packages
// version of this file for the incident that motivated splitting the
// display from the exit-code reducer. Kept in one place so the two paths
// cannot drift into disagreeing about what a status is called.
const STATUS_LABELS = { pass: "PASS ", finding: "FIND ", error: "ERROR", "not-published": "SKIP " };
const BENIGN_STATUSES = new Set(["pass", "not-published"]);

export function isFailureStatus(status) {
  return !BENIGN_STATUSES.has(status);
}

function statusLabel(status) {
  return STATUS_LABELS[status] ?? String(status).toUpperCase();
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
 *     succeeded: this package genuinely is public.
 *   - { state: "not-found" } — 404. Ambiguous on its own between "never
 *     published" and "private" — see this file's header. The caller
 *     resolves the ambiguity with the authenticated org/user roster below.
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
 * Enumerates every package name the npm organization (or, on a 404 from the
 * org endpoint, the personal npm account of the same name) actually holds —
 * `GET /-/org/<org>/package`, falling back to `/-/user/<org>/package` on a
 * first-page 404, the exact endpoints and fallback order `libnpmaccess`'s
 * own `getPackages` uses (what `npm access list packages` calls). An
 * actively invalid or expired token gets HTTP 401 here rather than a silent
 * empty list; an absent token never reaches this function, because main()
 * exits 2 before any network call. Note this endpoint answers anonymously
 * with HTTP 200 for a public organization, so its 401 is evidence about the
 * credential presented, not proof that the endpoint requires one.
 *
 * Returns one of:
 *   - { state: "found", packages: [fullScopedName, ...] }
 *   - { state: "error", detail } — an unreachable endpoint, an auth failure,
 *     a non-200/404 HTTP status, an unparseable response, or an org name
 *     neither endpoint recognises. Deliberately no "found: empty" read as
 *     clean on a total miss from both endpoints — an org that genuinely owns
 *     nothing is far less likely than a bad org name or a credential that
 *     cannot list packages.
 */
export async function fetchNpmOrgPackages({ scope, token, fetchImpl }) {
  const org = scope.startsWith("@") ? scope.slice(1) : scope;
  for (const kind of ["orgs", "users"]) {
    const url = kind === "orgs" ? `${PUBLIC_NPM_REGISTRY}/-/org/${encodeURIComponent(org)}/package` : `${PUBLIC_NPM_REGISTRY}/-/user/${encodeURIComponent(org)}/package`;
    let response;
    try {
      response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    } catch (error) {
      return { state: "error", detail: `network error calling the npm ${kind === "orgs" ? "organization" : "user"} package roster endpoint for "${org}": ${error.message}` };
    }
    if (response.status === 404) continue;
    if (response.status === 401 || response.status === 403) {
      return {
        state: "error",
        detail: `the npm ${kind === "orgs" ? "organization" : "user"} package roster endpoint for "${org}" returned HTTP ${response.status} — this credential cannot list this scope's packages. Confirm the token's scope, then re-run.`,
      };
    }
    if (!response.ok) {
      return { state: "error", detail: `the npm ${kind === "orgs" ? "organization" : "user"} package roster endpoint for "${org}" returned HTTP ${response.status} — could not enumerate registry packages.` };
    }
    let body;
    try {
      body = await response.json();
    } catch (error) {
      return { state: "error", detail: `the npm ${kind === "orgs" ? "organization" : "user"} package roster endpoint for "${org}" returned a response this gate could not parse as JSON: ${error.message}` };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { state: "error", detail: `the npm ${kind === "orgs" ? "organization" : "user"} package roster endpoint for "${org}" returned a non-object response — could not enumerate registry packages.` };
    }
    return { state: "found", packages: Object.keys(body) };
  }
  return {
    state: "error",
    detail: `neither the npm organization nor user package roster endpoint could enumerate registry packages for "${org}" — the credential may lack access, or the owner name is wrong. Refusing to report a reconciled set it never verified.`,
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
 * to its `{ reason, reviewBy }` declaration. Pure, no network. Unchanged
 * from the GitHub-Packages version of this file: this document's shape and
 * purpose did not change with the registry migration.
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
 * The forward direction: for every package the active release target
 * authorizes, look up its real public-npm visibility and compare it against
 * the target's declared `access`. Every package is checked — a failure on
 * one never stops the rest.
 *
 * `roster` is the authenticated org/user package set from fetchNpmOrgPackages
 * — the ground truth this direction uses to resolve the anonymous
 * not-found/private ambiguity (see this file's header).
 */
export async function checkDeclaredPackages({ target, roster, fetchImpl }) {
  const intendedVisibility = target.access === "public" ? "public" : "private";
  const results = [];
  const lookups = { attempted: 0, found: 0 };

  for (const directory of target.packages) {
    const name = `${target.scope}/${directory}`;
    lookups.attempted += 1;
    const outcome = await fetchNpmPackageVisibility({ registry: target.registry, name, fetchImpl });
    if (outcome.state === "error") {
      results.push({ package: name, status: "error", detail: `could not determine public npm visibility for "${name}": ${outcome.detail}` });
      continue;
    }
    if (outcome.state === "found") {
      lookups.found += 1;
      if (outcome.visibility === intendedVisibility) {
        results.push({ package: name, status: "pass", detail: `"${name}" is registry-${outcome.visibility} on public npm, matching the active release target's declared access.` });
      } else {
        results.push({
          package: name,
          status: "finding",
          detail: `"${name}" is registry-${outcome.visibility} but the active release target ("${target.id}") declares access "${intendedVisibility}".`,
        });
      }
      continue;
    }
    // not-found: ambiguous anonymously. The authenticated roster resolves it.
    if (roster.has(name)) {
      lookups.found += 1;
      results.push({
        package: name,
        status: "finding",
        detail:
          `"${name}" is registered under the ${target.scope} npm account but is NOT anonymously readable — it is private. npm ` +
          `defaults every scoped package to restricted access unless published with --access public; this is the exact incident ` +
          `this gate exists to catch. An owner must run \`npm access set status=public ${name}\` (see docs/PUBLISHING.md's ` +
          `"Public access and parity" section).`,
      });
    } else {
      results.push({
        package: name,
        status: "not-published",
        detail: `"${name}" has not been published to public npm yet (declared access: "${intendedVisibility}") — nothing to verify against a package that does not exist there.`,
      });
    }
  }

  return { results, lookups };
}

/**
 * The reverse direction: for every package the authenticated roster actually
 * holds, ask the declaration whether it agrees the package should be there.
 * A roster package the active target authorizes was already reconciled by
 * checkDeclaredPackages above and is skipped here. A roster package with a
 * "deprecated" lifecycle entry under the active scope is SATISFIED only when
 * `retentionByName` names it with an unexpired `reviewBy` (see this file's
 * header's "DEPRECATED IS NOT AUTOMATICALLY WRONG" section). Anything else —
 * an unauthorized package with no matching lifecycle entry, or one whose
 * status is neither the active target's authorization nor "deprecated" — is
 * a finding: it is live on the registry regardless of what this repository's
 * declaration says.
 */
export function reconcileRosterAgainstTarget(roster, target, lifecycle, retentionByName = new Map(), now = new Date()) {
  const declaredNames = new Set(target.packages.map((directory) => `${target.scope}/${directory}`));
  const statusByName = new Map();
  for (const entry of lifecycle.packages) {
    if (entry && typeof entry === "object" && typeof entry.name === "string" && entry.name.length > 0) statusByName.set(entry.name, entry.status);
  }

  const results = [];
  for (const name of roster) {
    if (declaredNames.has(name)) continue;
    const status = statusByName.get(name);

    if (status === "deprecated") {
      const retention = retentionByName.get(name);
      if (retention && !isRetentionExpired(retention.reviewBy, now)) {
        results.push({
          package: name,
          status: "pass",
          detail: `"${name}" is live on the registry and "deprecated", but ${DEFAULT_RETENTION_PATH} deliberately retains it (reviewBy ${retention.reviewBy}: ${retention.reason}). A deprecated package remaining installable is the intended state.`,
        });
        continue;
      }
      results.push({
        package: name,
        status: "finding",
        detail: retention
          ? `"${name}" is live on the registry and "deprecated", but its ${DEFAULT_RETENTION_PATH} entry expired on ${retention.reviewBy} and no longer justifies keeping it published. Renew it with a new reviewBy after review, or remove the package from the registry.`
          : `"${name}" is live on the registry and its ${DEFAULT_LIFECYCLE_PATH} status is "deprecated", with no entry in ${DEFAULT_RETENTION_PATH} declaring why it is deliberately still there. Add a retention entry (name, reason, reviewBy) if this is deliberate, or remove the package from the registry if it is not.`,
      });
      continue;
    }

    results.push({
      package: name,
      status: "finding",
      detail:
        typeof status === "string"
          ? `"${name}" is live on public npm but is not authorized by the active release target ("${target.id}") and its ${DEFAULT_LIFECYCLE_PATH} status is "${status}", not "deprecated" — either it should not be live, or its declaration is stale.`
          : `"${name}" is live on public npm but is not authorized by the active release target ("${target.id}") and has no entry at all in ${DEFAULT_LIFECYCLE_PATH}.`,
    });
  }
  return results;
}

/**
 * True when this run looked packages up and every single one came back
 * unresolved (neither anonymously public nor present in the authenticated
 * roster) — kept as defence in depth even though a bad credential now fails
 * loudly via fetchNpmOrgPackages's own 401/403 check: an organization that
 * has genuinely published nothing yet under this identity would otherwise
 * look identical to one the roster call quietly missed.
 */
export function isBlindCredential(lookups) {
  return Boolean(lookups) && lookups.attempted > 0 && lookups.found === 0;
}

/**
 * The full two-directional check, orchestrated as one pure-async function so
 * it is testable end-to-end with an injected `fetchImpl` — never through a
 * spawned CLI process, which cannot inject a fake network.
 */
export async function checkAllPackageVisibility({ target, lifecycle, retention, token, fetchImpl, now }) {
  if (target.registry !== PUBLIC_NPM_REGISTRY) {
    return { fatal: `the active release target ("${target.id}") registry is "${target.registry}", not ${PUBLIC_NPM_REGISTRY} — this gate only knows how to verify visibility on public npm.`, code: 2 };
  }
  if (!Array.isArray(target.packages) || target.packages.length === 0) {
    return { fatal: `the active release target ("${target.id}") authorizes no packages — refusing to report a clean pass on an empty scan`, code: 2 };
  }

  const rosterResult = await fetchNpmOrgPackages({ scope: target.scope, token, fetchImpl });
  if (rosterResult.state === "error") {
    return { fatal: `could not enumerate public npm packages for ${target.scope}: ${rosterResult.detail}`, code: 2 };
  }
  const roster = new Set(rosterResult.packages);

  const { results: declaredResults, lookups } = await checkDeclaredPackages({ target, roster, fetchImpl });

  if (isBlindCredential(lookups)) {
    return {
      fatal:
        `all ${lookups.attempted} declared package(s) returned neither an anonymous public read nor a match in the authenticated ` +
        `${target.scope} package roster. This cannot distinguish a set of packages none of which was ever published from a token ` +
        "that has lost read access — refusing to report a pass either way. Confirm the token's scope, then re-run.",
      code: 2,
    };
  }

  const { byName: retentionByName, findings: retentionFindings, fatal: retentionFatal } = selectRetentionDeclarations(retention ?? { packages: [] });
  if (retentionFatal) return { fatal: retentionFatal, code: 2 };

  const registryFindings = reconcileRosterAgainstTarget(roster, target, lifecycle, retentionByName, now ?? new Date());
  const allResults = [...declaredResults, ...retentionFindings, ...registryFindings];

  // Worst-of-three: an error anywhere dominates a finding, which dominates a
  // clean pass or a not-yet-published report. An UNRECOGNISED status is
  // treated as `error`, never falls through to a pass — see isFailureStatus.
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

  const retention = readJsonFile(options.retentionPath);

  if (options.declarationsOnly) {
    // The pure offline half: confirms the active target resolved above (a
    // network-free property this gate's live half depends on) and that
    // every "deprecated" package under the active scope has a valid,
    // unexpired retention declaration — the one piece of this gate's job
    // knowable before any registry call. See this file's header.
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
        console.log("Live registry visibility is NOT checked here; that half needs a credential and runs on schedule.");
      } else {
        console.log("");
        console.log("PACKAGE VISIBILITY DECLARATIONS FAIL — see FIND lines above. This is the offline half of the gate.");
      }
    }
    process.exit(findings.length === 0 ? 0 : 1);
  }

  // No token is exit 2, always — never a silent pass, and never even
  // attempted against the network.
  const token = process.env.NPM_PACKAGES_TOKEN;
  if (!token) {
    die(
      "NPM_PACKAGES_TOKEN is not set. This gate calls the live public npm registry and needs a token with read access to " +
        `${target.scope}'s packages to enumerate them — refusing to report a pass from a check that never ran. To run only ` +
        "the offline declaration check, pass --declarations-only.",
    );
  }

  const lifecycle = readJsonFile(options.lifecyclePath);

  const outcome = await checkAllPackageVisibility({ target, lifecycle, retention, token, fetchImpl: fetch });
  if (outcome.fatal) die(outcome.fatal, outcome.code);

  const { results: allResults, lookups, registryPackagesEnumerated, code: worst } = outcome;

  if (options.json) {
    console.log(JSON.stringify({ target: target.id, results: allResults, registryPackagesEnumerated }, null, 2));
  } else {
    for (const r of allResults) console.log(`  [${statusLabel(r.status)}] ${r.package} — ${r.detail}`);
  }

  if (!options.json) {
    console.log("");
    console.log(
      worst === 0
        ? `PACKAGE VISIBILITY OK — ${lookups.found} declared package(s) confirmed against their real public npm visibility, and ` +
            `${registryPackagesEnumerated} registry package(s) reconciled against the active release target. No mismatches found.`
        : worst === 2
          ? "PACKAGE VISIBILITY ERROR — could not determine at least one package's real visibility (see ERROR lines above). This is not a pass."
          : "PACKAGE VISIBILITY FAIL — at least one package's real registry state does not match what this repository declares — see FIND lines above.",
    );
  }
  process.exit(worst);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
}
