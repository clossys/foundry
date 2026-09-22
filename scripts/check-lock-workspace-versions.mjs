#!/usr/bin/env node
// check-lock-workspace-versions — does package-lock.json's own record of
// every packages/*/package.json's version still match that manifest's
// real, on-disk version?
//
//   node scripts/check-lock-workspace-versions.mjs [--json] [--no-allowlist] [--allowlist <path>]
//
// Package set is ALWAYS discovered from packages/*/package.json — never a
// hand-written list (issue #907's explicit rule: a literal list cannot
// notice the twentieth package). Exit 0 = every packages/* entry in
// package-lock.json records the same version its manifest declares (or the
// mismatch is a pre-existing, exactly-pinned entry in the ratchet file — see
// RATCHET below; a waived run is still exit 0, but says so, never silently).
// Exit 1 = at least one unwaived mismatch. Exit 2 = the check could not be
// completed (missing/unparseable package-lock.json, an unreadable/
// unparseable manifest, or an empty scan). Same three-way split every gate
// in this repo uses — see CONTRIBUTING.md's "Gate CLIs exit 0/1/2" entry.
//
// THE DEFECT THIS EXISTS TO CATCH (issue #917)
// ----------------------------------------------
// `npm --workspaces` writes each workspace member's OWN version into
// package-lock.json's "packages" map, at the same "packages/<dir>" key
// check-workspace-links.mjs already reads for the link check. A version bump
// PR that edits packages/<dir>/package.json's "version" field but does not
// run `npm install` (so the lock never regenerates) leaves that lock entry
// citing the pre-bump version — a false statement package-lock.json now
// makes about the workspace, silently, forever, until something regenerates
// the lock for an unrelated reason.
//
// Measured on `main` when #917 was filed: 3 of 19 packages stale, one by two
// releases. Of four version-bump PRs merged in one sitting, only one
// included a lock change. The owner decision recorded on #917 is that a
// workspace version bump MUST regenerate package-lock.json — declining to
// regenerate, and treating the lock's "packages/*": { "version": ... }
// entries as not load-bearing, were both considered and rejected. This gate
// is the mechanical enforcement of that decision, not a re-litigation of it.
//
// `check:qualification-record-required`'s lock-hash pin
// (`rootPackageLockSha256`, resolved via `qualificationJoinsRef`) is
// DELIBERATELY untouched by this gate: a `pre-publication` record's join
// resolves to the record's OWN `reviewedCommit`, so a later lock change on
// `main` can never invalidate an earlier record. This gate polices whether
// the lock is CURRENTLY truthful, not whether some past record's pin still
// holds — those are different questions with different answers.
//
// RATCHET
// -------
// A package.json version bump is packed content: fixing a stale lock entry
// here means moving a package tree, which needs its own version bump and
// qualification record (docs/PUBLISHING.md) and is not this gate's job to
// force in the same change that adds the gate. Pre-existing drift measured
// at the time this gate landed is recorded once in the allowlist below,
// keyed to the issue that tracks it, exactly pinned to the lock/manifest
// version PAIR observed. A pinned pair that no longer matches current drift
// — because the lock was regenerated, or the manifest moved again without
// the lock following it — is a waiver that has stopped tracking anything,
// and is ITSELF a finding: fixing the drift and deleting its entry are the
// same commit. See governance/known-lock-version-drift.json's own "note".
//
// EMPTY SCAN
// ----------
// Discovering zero packages is exit 2, never a clean 0 — same rule as
// check-workspace-links.mjs and check-release-readiness.mjs (commit
// 01bd520): a check that passes because it checked nothing is
// indistinguishable from a check that cannot fail, and this repository's own
// packages/ directory is never actually empty.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = process.cwd();

// ------------------------------------------------------------ manifest scan

// Resolved against the current working directory, not this script's own
// location — every caller (package.json's `check` script, CI, a developer's
// shell) runs this from the repository root, the same convention
// check-workspace-links.mjs's discoverPackages() and
// check-release-readiness.mjs's discoverPackages() both follow.
function discoverPackages() {
  const packagesDir = join(repoRoot, "packages");
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(packagesDir, name, "package.json")))
    .sort();
}

// An unreadable or unparseable package.json is always a result the caller
// sees — never a silent skip, same rule check-workspace-links.mjs's
// loadManifest() states for the same reason.
function loadManifest(dirName) {
  const manifestPath = join(repoRoot, "packages", dirName, "package.json");
  let raw;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (error) {
    return { dirName, error: `could not read ${manifestPath}: ${error.message}` };
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    return { dirName, error: `${manifestPath} is not valid JSON: ${error.message}` };
  }
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    return { dirName, error: `${manifestPath} has no valid "name" field` };
  }
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    return { dirName, error: `${manifestPath} has no valid "version" field` };
  }
  return { dirName, manifest };
}

// -------------------------------------------------------------- lockfile scan

function loadLock() {
  const lockPath = join(repoRoot, "package-lock.json");
  if (!existsSync(lockPath)) return { error: `no package-lock.json found at ${lockPath} — cannot verify workspace versions` };
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (error) {
    return { error: `${lockPath} is not valid JSON: ${error.message}` };
  }
  if (!lock.packages || typeof lock.packages !== "object") {
    return { error: `${lockPath} has no "packages" key — not an npm lockfile (v2/v3) this gate can read` };
  }
  return { lock };
}

// ------------------------------------------------------------------ allowlist
//
// See this file's RATCHET header section. An entry with nothing tracking it
// is not a waiver — same refusal check-contamination-classes.mjs's
// loadAllowlist() applies to governance/known-dangling-citations.json.
const DEFAULT_ALLOWLIST = join(repoRoot, "governance", "known-lock-version-drift.json");

function loadAllowlist(argv) {
  if (argv.includes("--no-allowlist")) return { entries: new Map(), issue: null, path: null };
  const flagIndex = argv.indexOf("--allowlist");
  const explicit = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  const path = explicit ?? DEFAULT_ALLOWLIST;
  if (!existsSync(path)) {
    if (explicit) return { error: `no such allowlist: ${path}` };
    return { entries: new Map(), issue: null, path: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { error: `cannot parse allowlist ${path}: ${error.message}` };
  }
  const issue = parsed?.issue;
  if (typeof issue !== "string" || !issue) {
    return { error: `allowlist ${path} has no "issue" — a waiver with nothing tracking it is not a waiver` };
  }
  const entries = new Map();
  for (const [pkg, pin] of Object.entries(parsed.packages ?? {})) {
    if (!pin || typeof pin !== "object" || typeof pin.lockVersion !== "string" || typeof pin.manifestVersion !== "string") {
      return { error: `allowlist ${path}: packages["${pkg}"] must be { "lockVersion": "...", "manifestVersion": "..." }` };
    }
    entries.set(pkg, { lockVersion: pin.lockVersion, manifestVersion: pin.manifestVersion });
  }
  return { entries, issue, path };
}

// ------------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");

  const packageDirs = discoverPackages();
  if (packageDirs.length === 0) {
    const message = "found no packages under packages/ to check — refusing to report a clean pass on an empty scan";
    if (json) console.log(JSON.stringify({ error: message, results: [] }, null, 2));
    else console.error(`check-lock-workspace-versions: ${message}`);
    process.exit(2);
  }

  const { lock, error: lockError } = loadLock();
  if (lockError) {
    if (json) console.log(JSON.stringify({ error: lockError, results: [] }, null, 2));
    else console.error(`check-lock-workspace-versions: ${lockError}`);
    process.exit(2);
  }

  const allowlist = loadAllowlist(argv);
  if (allowlist.error) {
    if (json) console.log(JSON.stringify({ error: allowlist.error, results: [] }, null, 2));
    else console.error(`check-lock-workspace-versions: ${allowlist.error}`);
    process.exit(2);
  }

  const results = [];
  const waived = [];
  const allowlistUsed = new Set();

  for (const dirName of packageDirs) {
    const loaded = loadManifest(dirName);
    if (loaded.error) {
      results.push({ package: dirName, status: "error", detail: loaded.error });
      continue;
    }
    const { manifest } = loaded;
    const lockKey = `packages/${dirName}`;
    const lockEntry = lock.packages[lockKey];
    if (!lockEntry || typeof lockEntry !== "object") {
      results.push({
        package: manifest.name,
        status: "error",
        detail: `package-lock.json has no "${lockKey}" entry — this workspace member is not represented in the lock at all; run \`npm install\` to regenerate it`,
      });
      continue;
    }
    const lockVersion = lockEntry.version;
    if (typeof lockVersion !== "string" || lockVersion.length === 0) {
      results.push({
        package: manifest.name,
        status: "error",
        detail: `package-lock.json's "${lockKey}" entry has no "version" field this gate can compare`,
      });
      continue;
    }
    if (lockVersion === manifest.version) {
      results.push({ package: manifest.name, status: "pass", detail: `package-lock.json's "${lockKey}" records ${lockVersion}, matching the manifest` });
      continue;
    }

    const pin = allowlist.entries.get(dirName);
    const detail =
      `package-lock.json's "${lockKey}" records version ${lockVersion}, but packages/${dirName}/package.json declares ${manifest.version}. ` +
      "A fresh `npm ci` resolves workspace versions FROM the lock, so this is the exact command that trusts the stale number. " +
      "Regenerate package-lock.json (a plain `npm install` at the repository root updates every workspace entry) in the same " +
      "pull request as the version bump — the owner decision on issue #917 is that a workspace version bump MUST regenerate the lock.";

    if (pin && pin.lockVersion === lockVersion && pin.manifestVersion === manifest.version) {
      allowlistUsed.add(dirName);
      waived.push({ package: manifest.name, dirName, lockVersion, manifestVersion: manifest.version, issue: allowlist.issue });
      results.push({ package: manifest.name, status: "waived", detail: `${detail} (waived, tracked by ${allowlist.issue})` });
      continue;
    }

    results.push({ package: manifest.name, status: "finding", detail });
  }

  // A pin that no longer matches current drift — because the lock was
  // regenerated, or the manifest moved again without the lock following it
  // — is a waiver that has stopped tracking anything. Same self-cleaning
  // rule check-contamination-classes.mjs's reportStaleAllowlistEntries()
  // applies to governance/known-dangling-citations.json.
  for (const dirName of allowlist.entries.keys()) {
    if (allowlistUsed.has(dirName)) continue;
    if (!packageDirs.includes(dirName)) continue; // reported as a missing-package finding below if truly gone; see NOTE
    const pin = allowlist.entries.get(dirName);
    results.push({
      package: dirName,
      status: "error",
      detail:
        `${allowlist.path ? allowlist.path.replace(`${repoRoot}/`, "") : "the allowlist"} still waives packages/${dirName} at ` +
        `lock=${pin.lockVersion}/manifest=${pin.manifestVersion}, but this run found no such drift (the lock and manifest either ` +
        `now agree, or have moved to a different pair). A waiver that matches nothing is a waiver that has stopped tracking ` +
        `anything — delete it in the same commit as whatever changed (${allowlist.issue}).`,
    });
  }
  // NOTE: an allowlist entry naming a package directory that no longer
  // exists under packages/ at all is the same "matches nothing" case; the
  // loop above already reports it (packageDirs.includes(dirName) is false
  // only skips it from THIS loop, but such a directory can never have been
  // in allowlistUsed either, so make that case explicit rather than silent).
  for (const dirName of allowlist.entries.keys()) {
    if (packageDirs.includes(dirName)) continue;
    const pin = allowlist.entries.get(dirName);
    results.push({
      package: dirName,
      status: "error",
      detail:
        `${allowlist.path ? allowlist.path.replace(`${repoRoot}/`, "") : "the allowlist"} waives packages/${dirName} at ` +
        `lock=${pin.lockVersion}/manifest=${pin.manifestVersion}, but no such package exists under packages/ anymore — delete ` +
        `this entry (${allowlist.issue}).`,
    });
  }

  if (json) {
    console.log(JSON.stringify({ results, waived }, null, 2));
  } else {
    const labels = { pass: "PASS ", waived: "WAIVE", finding: "FIND ", error: "ERROR" };
    for (const r of results) console.log(`  [${labels[r.status]}] ${r.package} — ${r.detail}`);
    console.log("");
    if (waived.length) {
      console.log(`## KNOWN, WAIVED — ${waived.length} pre-existing lock/manifest version mismatch(es)`);
      for (const w of waived) console.log(`  ${w.dirName}: lock=${w.lockVersion} manifest=${w.manifestVersion} — waived, tracked by ${w.issue}`);
      console.log("");
    }
  }

  // Same worst-of-three aggregation check-workspace-links.mjs and
  // check-release-readiness.mjs use: an error anywhere dominates a finding,
  // which dominates a clean (possibly waived) pass.
  const worst = results.reduce((acc, r) => (r.status === "error" ? 2 : r.status === "finding" && acc !== 2 ? 1 : acc), 0);

  if (!json) {
    console.log(
      worst === 0
        ? (waived.length
          ? `PASS — every packages/* entry in package-lock.json matches its manifest version (${waived.length} known, waived mismatch(es) above; a waived run is not a clean one).`
          : "PASS — every packages/* entry in package-lock.json matches its manifest version.")
        : worst === 2
          ? "ERROR — could not evaluate at least one package, the lockfile, or the allowlist (see ERROR lines above)."
          : "FAIL — the FIND lines above mean package-lock.json is currently false about at least one workspace member's version: a fresh `npm ci` will trust the stale number. Regenerate package-lock.json (see detail above).",
    );
  }
  process.exit(worst);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { discoverPackages, loadAllowlist, loadLock, loadManifest };
