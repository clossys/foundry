#!/usr/bin/env node
// check-package-visibility — fail when a package this repository declares as
// active is NOT anonymously installable from public npm right now.
//
//   node scripts/check-package-visibility.mjs [--json] [--declarations-only]
//     [--catalog path] [--scope-file path] [--lifecycle path] [--retention path]
//
// Exit 0 = every declared package resolved with an anonymous 200. Exit 1 =
// at least one declared package did not (a finding). Exit 2 = the check
// could not be completed at all — an unresolvable release target, an
// unsupported registry or access mode, a network error, a non-200/404
// response, or an unparseable/non-object response. Same three-state
// contract every gate in this repo uses (see CONTRIBUTING.md's "Gate CLIs
// exit 0/1/2" entry): a check that cannot run must fail, never silently
// pass.
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
// THIS GATE RUNS WITH NO CREDENTIAL, DELIBERATELY (issue #817 follow-up)
// ---------------------------------------------------------------------------
// A prior revision of this gate authenticated to `GET /-/org/<scope>/package`
// with an `NPM_PACKAGES_TOKEN` to enumerate every package name the npm
// organization actually holds, public or private, so it could tell "went
// private" apart from "never published" for a package that came back 404 on
// the anonymous per-package read. That token was never created —
// the owner's decision, made explicitly when this gate was reworked: "no
// token, all pkg are public from foundry repo." Minting and storing a
// credential — even a read-only one — for a repository whose entire
// publishing model is "everything here is public" was judged not worth the
// standing secret, the rotation burden, and the blast radius of one more
// token that can leak. `.github/workflows/package-visibility.yml` had gone
// permanently red with no token to read: a gate that can never go green
// gets ignored, which is a worse state than an honest, narrower gate that
// actually runs. This is that narrower gate, not an oversight.
//
// WHAT THIS GATE CAN AND CANNOT DISTINGUISH, AND WHY THAT'S ENOUGH
// ---------------------------------------------------------------------------
// The only network call this gate makes is the same anonymous packument GET
// every other public-npm gate in this repository already uses
// (scripts/lib/public-npm-registry.mjs's fetchPublicNpmPackument):
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
// This gate DOES NOT try to resolve that ambiguity, and says so in its own
// output. It does not need to: this repository's actual invariant is
// narrower than "tell me why a package is hidden" — it is "every package
// governance/release-catalog.json's active target declares must be publicly
// installable right now." Under that invariant, "never published" and
// "published but private" are the SAME failure — both mean an external
// reader cannot `npm install` a package this repository says is live — so a
// single undifferentiated 404 finding is a complete, honest answer, not a
// weakened one. A 200 is a definitive pass either way: an anonymous read
// that actually succeeds is proof the package is genuinely public, no
// authenticated cross-check needed.
//
// (For completeness: `GET /-/org/<scope>/package` was independently
// re-verified anonymously too — with no Authorization header at all it
// returns HTTP 200 and the full package roster; only an actively INVALID
// token gets HTTP 401. That endpoint is nonetheless not used here — see
// "WHAT THIS GATE USED TO DO" below for why re-adding it was rejected
// rather than merely left unauthenticated.)
//
// WHAT THIS GATE USED TO DO, AND NO LONGER DOES
// ---------------------------------------------------------------------------
// The token-era version of this gate was two-directional: forward (every
// declared package's visibility matches the target's declared access) AND
// reverse (every package actually live under the scope is accounted for by
// a declaration, with a "deprecated" carve-out backed by
// docs/contracts/package-retention.json). The reverse direction existed
// specifically to catch a package left live on the registry that this
// repository no longer declares — a name nobody remembered to unpublish, or
// a stale "deprecated" retention window. That direction fundamentally
// requires enumerating the FULL package roster under the scope, not just
// checking the declared names one at a time.
//
// That enumeration is now known to work anonymously too (see above), so it
// could technically have been kept. It was deliberately cut instead, not
// merely left unauthenticated, because it answers a different question than
// the one this gate now exists to answer. "Every declared package is
// publicly installable" (what remains) needs one anonymous read per
// declared name. "No undeclared or stale-deprecated package is live" (what
// was cut) needs a full roster diff, a second document
// (package-retention.json) joined against package-lifecycle.json, and a
// second exit-code path — real, standing complexity in permanent service of
// a check this rework was not asked to keep, and retention.json is
// currently empty with no deprecated `@clossys` entries to protect. Reintroducing
// it — anonymously or not — belongs to a change that actually wants that
// property back, argued and reviewed on its own, not carried forward here
// by default. Concretely, this means: a package that is live under
// `@clossys` but not authorized by the active release target, and any
// "deprecated" package's retention window lapsing while still live, are no
// longer caught by the LIVE half of this gate. The OFFLINE
// `--declarations-only` half still confirms every "deprecated" package
// under the active scope carries a valid, unexpired retention declaration —
// see below — but it checks the declaration alone; it no longer cross-checks
// that state against the real registry roster.
//
// EVERY PACKAGE, NOT JUST THE FIRST FAILURE
// --------------------------------------------
// Every declared package is checked and reported; a failure on one never
// short-circuits the rest. The worst status across all results decides the
// exit code: an error (2) dominates a finding (1), which dominates a clean
// pass (0) — the same aggregation check-workspace-links.mjs and
// check-release-readiness.mjs already use.
//
// NEVER WIRED INTO LOCAL `npm run check`, WITH ONE OFFLINE EXCEPTION
// -----------------------------------------------------------------------
// The live half calls the live public npm registry over the network, so it
// stays out of the hermetic `npm run check` chain and runs in CI instead —
// see .github/workflows/package-visibility.yml's scheduled run — the same
// reason check:registry-parity is kept out of `check` (see its own comment
// in package.json). This is a network-access concern now, not a credential
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
 *     succeeded: this package genuinely is public. Definitive.
 *   - { state: "not-found" } — 404. Deliberately ambiguous between "never
 *     published" and "private" — see this file's header. This gate does not
 *     try to resolve that ambiguity; both are failures of the same
 *     invariant, so both are reported as one undifferentiated finding.
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
 * the offline --declarations-only half now — see this file's header for why
 * the live half no longer cross-checks retention against the real registry
 * roster.
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
 * For every package the active release target authorizes, look up whether
 * it is anonymously installable from public npm right now. Every package is
 * checked — a failure on one never stops the rest.
 *
 * A 404 is always a finding here, never a benign skip: this gate no longer
 * distinguishes "never published" from "private" (see this file's header),
 * and this repository's invariant is that every declared package must be
 * public right now, so an absence is not an expected steady state.
 */
export async function checkDeclaredPackages({ target, fetchImpl }) {
  const results = [];
  const lookups = { attempted: 0, found: 0 };

  for (const directory of target.packages) {
    const name = `${target.scope}/${directory}`;
    lookups.attempted += 1;
    const outcome = await fetchNpmPackageVisibility({ registry: target.registry, name, fetchImpl });
    if (outcome.state === "error") {
      results.push({ package: name, status: "error", detail: `could not determine whether "${name}" is publicly installable: ${outcome.detail}` });
      continue;
    }
    if (outcome.state === "found") {
      lookups.found += 1;
      results.push({ package: name, status: "pass", detail: `"${name}" is anonymously readable on ${target.registry} — publicly installable right now.` });
      continue;
    }
    // not-found: an anonymous 404. Deliberately undifferentiated — see this
    // file's header for why this gate does not try to tell "never
    // published" apart from "private", and why it does not need to.
    results.push({
      package: name,
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
 * The full check, orchestrated as one pure-async function so it is testable
 * end-to-end with an injected `fetchImpl` — never through a spawned CLI
 * process, which cannot inject a fake network. No credential is accepted or
 * required: every call this function makes is anonymous.
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

  const { results, lookups } = await checkDeclaredPackages({ target, fetchImpl });

  // Worst-of-three: an error anywhere dominates a finding, which dominates a
  // clean pass. An UNRECOGNISED status is treated as `error`, never falls
  // through to a pass — see isFailureStatus.
  const code = results.reduce((acc, r) => (isFailureStatus(r.status) && r.status !== "finding" ? 2 : r.status === "finding" && acc !== 2 ? 1 : acc), 0);

  return { fatal: null, code, results, lookups };
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
    // header for why that cross-check no longer exists.
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

  // No token required, ever — every call this gate makes is anonymous. See
  // this file's header for the owner's decision and why an anonymous
  // per-package check is a complete answer to this repository's invariant.
  const outcome = await checkAllPackageVisibility({ target, fetchImpl: fetch });
  if (outcome.fatal) die(outcome.fatal, outcome.code);

  const { results: allResults, lookups, code: worst } = outcome;

  if (options.json) {
    console.log(JSON.stringify({ target: target.id, results: allResults }, null, 2));
  } else {
    for (const r of allResults) console.log(`  [${statusLabel(r.status)}] ${r.package} — ${r.detail}`);
  }

  if (!options.json) {
    console.log("");
    console.log(
      worst === 0
        ? `PACKAGE VISIBILITY OK — all ${lookups.attempted} declared package(s) are anonymously installable from public npm right now. No credential was used or needed.`
        : worst === 2
          ? "PACKAGE VISIBILITY ERROR — could not determine at least one package's real visibility (see ERROR lines above). This is not a pass."
          : "PACKAGE VISIBILITY FAIL — at least one declared package is not publicly installable right now — see FIND lines above. " +
              "This gate cannot tell whether that is because it was never published or because it is private; see the detail on each finding.",
    );
  }
  process.exit(worst);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
}
