#!/usr/bin/env node
// check-qualification-record-required — for any package whose version this
// pull request bumps relative to its merge base, does the NEW version
// already have a retained, non-stale qualification record — or an
// explicitly acknowledged, issue-referenced deferral?
//
//   node scripts/check-qualification-record-required.mjs [--json] [--base <ref>] [<packageDir> ...]
//
// With no positional arguments, every packages/*/package.json in this repo
// is checked. Exit 0 = every version-bumped package has a matching record or
// an acknowledged deferral, and every declared deferral is still owed (see
// STALE DEFERRALS below). Exit 1 = at least one bumped package has neither.
// Exit 2 = the question could not be answered for at least one package or
// deferral (an unreadable manifest, an unparseable retained record, a git
// failure) — the same three-way split scripts/check-release-readiness.mjs
// and scripts/check-qualification-record-present.mjs already use.
//
// WHY THIS EXISTS (issue #863)
// -----------------------------
// scripts/check-qualification-record-present.mjs already asks "does the
// selected candidate have a retained, matching qualification record?" —
// but it is wired into publish.yml's `discover` job only, which runs at
// PUBLISH DISPATCH, long after a version bump has already merged to main
// with every pull-request check green. PR #860 bumped
// @clossys/controller and shipped no record; nothing in the pull-request
// check set read the record's absence, and the gap surfaced only through
// independent human review. This script asks the identical question at the
// point a merge can still be stopped: the pull request itself.
//
// WHY THIS IS A SEPARATE SCRIPT/JOB FROM check-release-readiness.mjs, NOT
// FOLDED INTO IT
// -----------------------------------------------------------------------
// check-release-readiness.mjs answers "did this package's packed content
// change without its version also changing" — its remedy is "bump the
// version." This script answers a different question that only exists
// AFTER a version has already been bumped: "does the new version have a
// retained record" — its remedy is "qualify the candidate and retain the
// record" (or acknowledge a deferral). Folding these into one script would
// conflate two independently-true-or-false conditions with two different
// remedies behind one exit code and one required-check name, and would
// require re-deriving the devDependencies exemption and identity-transition
// handling a second time inside a script that has nothing to do with either.
// Reusing evaluatePackageDiff()'s own merge-base computation (below) gets
// the shared part — "did the version actually change relative to the merge
// base" — for free, with no second implementation of that join to drift
// from the first.
//
// WHY THE devDependencies EXEMPTION (issue #269) NEEDS NO SEPARATE HANDLING
// HERE
// ---------------------------------------------------------------------------
// This gate's trigger condition — evaluatePackageDiff() reporting
// `versionChanged: true` — is strictly narrower than check-release-
// readiness.mjs's own trigger for requiring a bump (any packed-surface
// change). A devDependency-only edit never changes `version`, so
// `versionChanged` is never true for one, and this gate never fires on it
// at all, by construction — with no exemption logic to duplicate or drift.
// Verified against this repository's own real Dependabot pull requests
// (#800, #799, #866): every one of them edits `devDependencies` (or, for
// #866, only the workspace root and lockfile) and leaves every
// `packages/*/package.json`'s `version` field untouched.
//
// STALE DEFERRALS
// ----------------
// A deferral acknowledges that a specific package@version was bumped ahead
// of its qualification record, with a reason and a tracking issue — the
// same shape scripts/check-package-evidence.mjs already uses for `gaps`,
// and its key property is preserved here: a deferral must not outlive its
// reason. So EVERY declared deferral is re-checked on every run, regardless
// of whether the package it names is part of this run's diffed target set —
// once a retained, matching record exists for the exact package@version a
// deferral names, the deferral is stale and must be removed (see
// `stale-deferral` below), the same way check-package-evidence.mjs's
// `stale-gap` finding forces a satisfied gap out of the file.
//
// ONE FILE PER DEFERRAL, NOT ONE SHARED ARRAY (issue #1254)
// -----------------------------------------------------------
// Every deferral used to live as one entry in a single JSON array at
// governance/release-qualification-deferrals.json. Two unrelated pull
// requests each bumping a different package that could not reach the
// pinned release runtime (scripts/lib/release-runtime.mjs) both had to
// append to that one file, so an otherwise-unrelated pair of PRs collided
// on the same lines and conflicted on merge — a recorded, repeated hotspot
// (issue #1187, item 3; issue #1254). Splitting the store into one file per
// package@version — governance/release-qualification-deferrals/<package>@<version>.json —
// removes the shared line range entirely: two PRs adding deferrals for
// different package@version pairs now touch disjoint files and cannot
// conflict on the file's own account. Each entry file carries only
// {package, version, reason, issue}; the store's schemaVersion and the
// countdown-not-a-standing-exemption $comment that used to sit at the top
// of the single array now live once, in
// governance/release-qualification-deferrals/README.md, since they describe
// the store as a whole rather than any one entry.
//
// TRANSITION: THE OLD SINGLE-FILE PATH IS RETIRED, NOT REUSED
// --------------------------------------------------------------
// A pull request opened before this migration landed may still append to
// the old governance/release-qualification-deferrals.json path. Rebasing it
// onto a tree where that file no longer exists produces a real, one-time
// merge conflict — expected, not a bug. What this gate refuses to do is
// silently ignore the old file if it reappears (a conflict resolved the
// wrong way, or a stray restore): see `legacy-deferrals-file` below, which
// fails loudly with the new path and issue #1254 rather than letting a
// pre-migration deferral go unread.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePackageDiff } from "./check-release-readiness.mjs";
import { qualificationRecordPresenceForCandidate } from "./check-qualification-record-present.mjs";

const DEFERRALS_DIR = "governance/release-qualification-deferrals";
const LEGACY_DEFERRALS_PATH = "governance/release-qualification-deferrals.json";

function deferralFilePath(packageKey, version) {
  return `${DEFERRALS_DIR}/${packageKey}@${version}.json`;
}

// Resolved against the current working directory, matching every other
// packages/*-iterating script here (see check-release-readiness.mjs's own
// discoverPackages(), which this intentionally mirrors rather than imports —
// it is five lines of directory listing, not a join that could drift).
function discoverPackages() {
  const packagesDir = join(process.cwd(), "packages");
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(packagesDir, d.name))
    .filter((dir) => existsSync(join(dir, "package.json")))
    .sort();
}

// Parses one entry file's raw JSON into a validated {package, version,
// reason, issue} entry, or a finding explaining why it could not be. Never
// throws — every failure mode here is reported as a `findings` entry
// against the specific FILE that caused it, so one malformed file can never
// hide the state of every other, already-valid deferral (a property the old
// single-array file could not offer: one bad line broke the whole parse).
function readDeferralFile(root, relPath) {
  const fileName = basename(relPath);
  let raw;
  try {
    raw = JSON.parse(readFileSync(resolve(root, relPath), "utf8"));
  } catch (error) {
    return { entry: null, finding: { severity: "error", rule: "unreadable-deferral-file", subject: relPath, message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` } };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { entry: null, finding: { severity: "error", rule: "unreadable-deferral-file", subject: relPath, message: "must be a JSON object with `package`, `version`, `reason`, and `issue`" } };
  }
  if (typeof raw.package !== "string" || raw.package === "") {
    return { entry: null, finding: { severity: "error", rule: "unreadable-deferral", subject: relPath, message: "needs a string `package` naming its packages/ directory" } };
  }
  if (typeof raw.version !== "string" || raw.version === "") {
    return { entry: null, finding: { severity: "error", rule: "deferral-without-version", subject: raw.package, message: `${relPath} needs a string \`version\` naming the exact bumped version being deferred` } };
  }
  if (typeof raw.reason !== "string" || raw.reason.trim().length < 20) {
    return { entry: null, finding: { severity: "error", rule: "deferral-without-reason", subject: raw.package, message: `the deferral at "${raw.version}" (${relPath}) needs a reason saying why the record is deferred` } };
  }
  if (!Number.isInteger(raw.issue)) {
    return { entry: null, finding: { severity: "error", rule: "deferral-without-issue", subject: raw.package, message: `the deferral at "${raw.version}" (${relPath}) needs an integer \`issue\` tracking it` } };
  }
  // The filename is not load-bearing for lookups below (entries are keyed by
  // their own `package`/`version` fields, the same as before) but it IS the
  // human-facing, merge-conflict-avoiding identity of the entry, so a file
  // whose name disagrees with its own contents is a real defect: it means
  // either the file was renamed without updating its contents, or copied
  // from a different entry and only partly edited.
  const expectedFileName = `${raw.package}@${raw.version}.json`;
  if (fileName !== expectedFileName) {
    return { entry: null, finding: { severity: "error", rule: "deferral-file-name-mismatch", subject: raw.package, message: `${relPath} names package "${raw.package}" version "${raw.version}", so it must be called ${expectedFileName}` } };
  }
  return { entry: { package: raw.package, version: raw.version, reason: raw.reason, issue: raw.issue }, finding: null };
}

// Loads every acknowledged deferral from governance/release-qualification-deferrals/,
// one file per package@version. Returns `{ entries, findings }`:
//   - `entries` is `null` only when the store as a WHOLE could not be read
//     (the retired single-file path has reappeared, or the directory itself
//     could not be listed) — the same "indeterminate, not empty" contract
//     the old single-array file used for a parse failure.
//   - Otherwise `entries` is the array of every well-formed entry found,
//     skipping (and separately reporting, via `findings`) any individual
//     file that failed to parse or validate — see readDeferralFile() above
//     for why a single bad file no longer takes every other entry down
//     with it.
function loadDeferrals(root) {
  if (existsSync(resolve(root, LEGACY_DEFERRALS_PATH))) {
    return {
      entries: null,
      findings: [
        {
          severity: "error",
          rule: "legacy-deferrals-file",
          subject: LEGACY_DEFERRALS_PATH,
          message: `${LEGACY_DEFERRALS_PATH} is retired — deferrals moved to ${DEFERRALS_DIR}/<package>@<version>.json, see #1254. Remove this file and add the equivalent per-version file(s) instead.`,
        },
      ],
    };
  }

  const dirPath = resolve(root, DEFERRALS_DIR);
  if (!existsSync(dirPath)) return { entries: [], findings: [] };

  let fileNames;
  try {
    fileNames = readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".json"))
      .map((d) => d.name)
      .sort();
  } catch (error) {
    return {
      entries: null,
      findings: [{ severity: "error", rule: "unreadable-deferrals-directory", subject: DEFERRALS_DIR, message: error instanceof Error ? error.message : String(error) }],
    };
  }

  const findings = [];
  const entries = [];
  // Kept as defense in depth, not because it is reachable today: a file
  // only becomes an `entry` once readDeferralFile() has already confirmed
  // its filename equals `${package}@${version}.json` (deferral-file-name-
  // mismatch otherwise), and two files cannot share a filename on any
  // filesystem this repository runs on -- so two ENTRIES colliding on the
  // same package@version key is not currently reachable through this loop.
  // Left in so a future relaxation of that filename requirement does not
  // silently reopen the exact hazard the old single-array file's own
  // duplicate-deferral check existed to catch.
  const seen = new Map();
  for (const fileName of fileNames) {
    const relPath = `${DEFERRALS_DIR}/${fileName}`;
    const { entry, finding } = readDeferralFile(root, relPath);
    if (finding) {
      findings.push(finding);
      continue;
    }
    const key = `${entry.package}\0${entry.version}`;
    if (seen.has(key)) {
      findings.push({ severity: "error", rule: "duplicate-deferral", subject: entry.package, message: `two deferral files declare version "${entry.version}": ${seen.get(key)} and ${relPath}` });
      continue;
    }
    seen.set(key, relPath);
    entries.push(entry);
  }
  return { entries, findings };
}

// Resolves a deferral entry's {name, version} candidate from the CURRENT
// manifest at packages/<packageKey>/ — deferrals do not carry their own
// package name, because the directory-to-name join already exists in
// exactly one place (the manifest) and a second copy here could disagree
// with it after a rename.
function candidateForDeferral(root, entry) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(resolve(root, `packages/${entry.package}/package.json`), "utf8"));
  } catch {
    return null;
  }
  if (typeof manifest?.name !== "string") return null;
  return { name: manifest.name, version: entry.version };
}

// Re-checks every declared deferral against the record store, independent of
// this run's diffed target set — see STALE DEFERRALS above.
function checkStaleDeferrals(root, entries) {
  const findings = [];
  for (const entry of entries) {
    const candidate = candidateForDeferral(root, entry);
    if (candidate === null) {
      findings.push({
        severity: "error",
        rule: "unreadable-deferral",
        subject: entry.package,
        message: `packages/${entry.package}/package.json could not be read, so the deferral at "${entry.version}" cannot be joined against a package name`,
      });
      continue;
    }
    const presence = qualificationRecordPresenceForCandidate({ root, candidate });
    if (presence.state === "present") {
      findings.push({
        severity: "error",
        rule: "stale-deferral",
        subject: entry.package,
        message: `the deferral at "${entry.version}" (issue #${entry.issue}) is acknowledged but a retained, matching qualification record now exists at ${presence.path} — remove ${deferralFilePath(entry.package, entry.version)} and close its issue`,
      });
    }
  }
  return findings;
}

// Evaluates one package directory: did its version change relative to the
// merge base (reusing evaluatePackageDiff()'s own computation — see header
// comment), and if so, does the new version have a record or a deferral?
function evaluatePackage(pkgDir, requestedBase, deferralsByKey) {
  const packageKey = basename(pkgDir);
  const diff = evaluatePackageDiff(pkgDir, requestedBase);

  if (diff.status === "error") return { package: diff.package, status: "error", detail: diff.detail };
  if (diff.status === "skip") return { package: diff.package, status: "skip", detail: diff.detail };
  if (diff.versionChanged !== true) {
    return { package: diff.package, status: "pass", detail: `no version change relative to the merge base (${diff.detail}) — no new version to require a record for` };
  }

  const candidate = { name: diff.package, version: diff.version };
  // `diff.gitRoot` is the SAME repository root evaluatePackageDiff() itself
  // resolved for this package (via `git rev-parse --show-toplevel`), not a
  // second, independent `process.cwd()` guess — the two must never disagree
  // about which tree a candidate's record lives in.
  const presence = qualificationRecordPresenceForCandidate({ root: diff.gitRoot, candidate });

  if (presence.state === "present") {
    return { package: diff.package, status: "pass", detail: `version bumped to ${diff.version} since merge-base ${diff.mergeBase.slice(0, 12)}, and a retained, matching qualification record exists at ${presence.path}` };
  }

  const deferral = deferralsByKey.get(`${packageKey}\0${diff.version}`);
  if (deferral) {
    return {
      package: diff.package,
      status: "deferred",
      detail: `version bumped to ${diff.version} with no matching qualification record (${presence.state}), but issue #${deferral.issue} acknowledges the deferral: ${deferral.reason}`,
    };
  }

  if (presence.state === "indeterminate") {
    return { package: diff.package, status: "error", detail: `version bumped to ${diff.version} since merge-base ${diff.mergeBase.slice(0, 12)}, and the qualification record could not be evaluated: ${presence.reason}` };
  }

  const why =
    presence.state === "missing"
      ? `no retained record exists at ${presence.path}`
      : `the retained record at ${presence.path} no longer matches this candidate (stale: ${presence.staleFields.join(", ")})`;
  return {
    package: diff.package,
    status: "needs-record",
    detail:
      `version bumped to ${diff.version} since merge-base ${diff.mergeBase.slice(0, 12)} (base ${diff.baseVersion} → ${diff.version}), but ${why}. ` +
      `Qualify the candidate and retain a fresh record on this branch before merging, or add an acknowledged deferral naming an issue to ${deferralFilePath(packageKey, diff.version)}.`,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const baseIndex = argv.indexOf("--base");
  const requestedBase = baseIndex >= 0 ? argv[baseIndex + 1] : undefined;
  if (baseIndex >= 0 && requestedBase === undefined) {
    console.error("check-qualification-record-required: --base requires a value");
    process.exit(2);
  }
  const positional = argv.filter((a, i) => !a.startsWith("--") && i !== baseIndex + 1);
  const targets = positional.length > 0 ? positional : discoverPackages();

  if (targets.length === 0) {
    // Same "an empty scan is not a clean pass" discipline check-release-
    // readiness.mjs uses, for the identical reason: this gate exists to
    // catch a real absence, so scanning zero packages must not read as
    // "nothing was missing."
    const message = "found no packages to check — refusing to report a clean pass on an empty scan";
    if (json) console.log(JSON.stringify({ error: message, results: [], deferralFindings: [] }, null, 2));
    else console.error(`check-qualification-record-required: ${message}`);
    process.exit(2);
  }

  const root = process.cwd();
  const { entries: deferralEntries, findings: deferralFileFindings } = loadDeferrals(root);
  const deferralsByKey = new Map();
  for (const entry of deferralEntries ?? []) deferralsByKey.set(`${entry.package}\0${entry.version}`, entry);

  const results = targets.map((dir) => evaluatePackage(dir, requestedBase, deferralsByKey));
  const staleFindings = deferralEntries === null ? [] : checkStaleDeferrals(root, deferralEntries);
  const allDeferralFindings = [...deferralFileFindings, ...staleFindings];

  if (json) {
    console.log(JSON.stringify({ results, deferralFindings: allDeferralFindings }, null, 2));
  } else {
    const labels = { pass: "READY", deferred: "DEFER", skip: "SKIP ", "needs-record": "MISSING", error: "ERROR" };
    for (const r of results) console.log(`  [${labels[r.status]}] ${r.package} — ${r.detail}`);
    if (allDeferralFindings.length > 0) {
      console.log("");
      for (const f of allDeferralFindings) console.log(`  ${f.severity === "error" ? "FAIL" : "NOTE"}  ${f.rule}  ${f.subject} — ${f.message}`);
    }
  }

  // Same worst-of-three-way aggregation check-release-readiness.mjs and
  // check-qualification-record-present.mjs use: an error anywhere dominates
  // a real finding, which dominates a clean pass.
  const packageWorst = results.reduce((acc, r) => (r.status === "error" ? 2 : r.status === "needs-record" && acc !== 2 ? 1 : acc), 0);
  const deferralWorst = allDeferralFindings.length > 0 ? 1 : 0;
  const worst = Math.max(packageWorst, deferralWorst);

  if (!json) {
    console.log("");
    console.log(
      worst === 0
        ? "QUALIFICATION RECORD REQUIRED — OK. Every package whose version changed relative to the merge base has a retained, matching qualification record, or an acknowledged deferral naming an issue — and no acknowledged deferral has gone stale."
        : worst === 2
          ? "QUALIFICATION RECORD REQUIRED — ERROR. Could not evaluate at least one package or deferral (see ERROR lines above)."
          : "QUALIFICATION RECORD REQUIRED — FAIL. A version bump above has no retained, matching qualification record and no acknowledged deferral (see MISSING lines above), or a declared deferral is now stale (see FAIL lines above). Qualify and retain a record, add a deferral naming an issue, or remove a satisfied deferral.",
    );
  }
  process.exit(worst);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { candidateForDeferral, checkStaleDeferrals, deferralFilePath, discoverPackages, evaluatePackage, loadDeferrals, DEFERRALS_DIR, LEGACY_DEFERRALS_PATH };
