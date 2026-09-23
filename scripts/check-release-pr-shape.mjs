#!/usr/bin/env node
// check-release-pr-shape — for any package whose version this pull request
// changed relative to its merge base, is that change shaped like a release
// PR (issue #1255)?
//
//   node scripts/check-release-pr-shape.mjs [--json] [--base <ref>] [<packageDir> ...]
//
// With no positional arguments, every packages/*/package.json in this repo
// is checked. Exit 0 = every version-bumped package's bump is either
// justified by consumed changesets whose bump level matches, or is
// accompanied by a matching CHANGELOG.md entry (the pre-existing, documented
// convention -- see docs/PUBLISHING.md section 4). Exit 1 = at least one
// version-bumped package's bump is neither. Exit 2 = the question could not
// be answered for at least one package (a git failure, an unreadable
// changeset, a version field that is not a plain X.Y.Z semver triple).
//
// WHY THIS IS A SEPARATE SCRIPT FROM check-release-readiness.mjs
// -----------------------------------------------------------------
// check-release-readiness.mjs's own "version changed since merge-base" path
// already passes unconditionally, and stays that way -- every existing
// caller and test of that script keeps its exact current meaning. This
// script asks an ADDITIONAL, narrower question that only exists once a
// version has already changed: was the change released the way #1255's
// batching model expects, rather than an uncoordinated ad-hoc bump colliding
// with another lane's? Splitting it out mirrors check-qualification-record-
// required.mjs's own precedent (see that script's header) for the identical
// reason: two independently-true-or-false conditions with two different
// remedies should not share one exit code.
//
// Reuses check-release-readiness.mjs's own evaluatePackageDiff() for "did
// the version actually change relative to the merge base" -- the same
// merge-base computation and version comparison every other release gate in
// this repository already trusts -- rather than a second implementation of
// that join.
//
// WHAT COUNTS AS "RELEASE-PR SHAPED"
// -----------------------------------
// Either of two independent, mechanically checked conditions:
//
//   1. CONSUMED CHANGESETS. At least one changeset existed in .changesets/
//      at the merge base naming this package, and is gone from .changesets/
//      at HEAD (this pull request applied it) -- and the highest bump level
//      named across every such consumed changeset for this package equals
//      the bump level the actual version change represents (patch/minor/
//      major, computed structurally from the two version triples). This is
//      the shape scripts/apply-release-changesets.mjs's release PR produces.
//
//   2. A MATCHING CHANGELOG ENTRY. packages/<dir>/CHANGELOG.md, at HEAD,
//      has a heading for the new version ("## <version>" or
//      "## [<version>] ..."). This is the pre-existing, already-documented
//      requirement (docs/PUBLISHING.md section 4), which this script
//      mechanizes rather than invents -- so a direct, hand-authored bump
//      that already follows that convention keeps passing. This is
//      deliberately how an in-flight pull request that bumped a version
//      before this gate existed keeps working once it merges main and picks
//      this gate up, with no separate, time-based exemption coded here (see
//      the design comment linked below).
//
// A version change that is neither is refused: "a version change outside a
// release PR is refused" (issue #1255's own words). This is a NEW gate --
// nothing in this repository checked this before -- so by construction it
// cannot make anything that passed a PRE-EXISTING gate now fail; it only
// adds a new, independently justified refusal.
//
// Design: https://github.com/clossys/foundry/issues/1255#issuecomment-5790113827
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePackageDiff } from "./check-release-readiness.mjs";
import { parseChangesetText, CHANGESETS_DIR } from "./collect-changesets.mjs";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function discoverPackages() {
  const packagesDir = join(process.cwd(), "packages");
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(packagesDir, d.name))
    .filter((dir) => existsSync(join(dir, "package.json")))
    .sort();
}

// Parses a version string into a [major, minor, patch] triple, or returns
// null for anything that isn't a plain X.Y.Z (no pre-release/build
// metadata) -- every version in this repository's manifests is currently
// this shape; a package that adopts something richer needs this script
// extended deliberately, not silently mis-measured.
export function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Structurally classifies old -> new as exactly one of "major"/"minor"/
// "patch", or null when it is not a clean forward bump of that shape (e.g.
// a minor bump that didn't reset patch to 0, or a version that went
// backwards or sideways).
export function computeBumpLevel(oldVersion, newVersion) {
  const oldV = parseSemver(oldVersion);
  const newV = parseSemver(newVersion);
  if (!oldV || !newV) return null;
  const [oMaj, oMin, oPat] = oldV;
  const [nMaj, nMin, nPat] = newV;
  if (nMaj === oMaj + 1 && nMin === 0 && nPat === 0) return "major";
  if (nMaj === oMaj && nMin === oMin + 1 && nPat === 0) return "minor";
  if (nMaj === oMaj && nMin === oMin && nPat === oPat + 1) return "patch";
  return null;
}

// Lists every non-README file under .changesets/ as it existed at `commit`,
// parsed leniently (no knownPackageDirs restriction -- a historical commit's
// package set is not this function's concern, only which packages a
// changeset named). Returns `{ file, packages }[]`; a file that fails to
// parse at that commit is skipped, not fatal -- collect-changesets.mjs's own
// gate is what enforces well-formedness at HEAD.
function changesetsAtCommit(gitRoot, commit) {
  let listing;
  try {
    listing = git(["ls-tree", "-r", "--name-only", commit, "--", CHANGESETS_DIR], gitRoot);
  } catch {
    return [];
  }
  const files = listing
    .split("\n")
    .filter(Boolean)
    .map((path) => path.slice(CHANGESETS_DIR.length + 1))
    .filter((name) => name !== "README.md" && !name.includes("/"));
  const out = [];
  for (const file of files) {
    let text;
    try {
      text = git(["show", `${commit}:${CHANGESETS_DIR}/${file}`], gitRoot);
    } catch {
      continue;
    }
    const result = parseChangesetText(text, {});
    if (!result.error) out.push({ file, packages: result.packages });
  }
  return out;
}

// The current working-tree .changesets/ file names (not parsed -- this is
// only used to ask "is this file still here", i.e. still pending).
function changesetFileNamesAtHead(gitRoot) {
  const dir = join(gitRoot, CHANGESETS_DIR);
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name));
}

// Does packages/<dir>/CHANGELOG.md, at HEAD, have a heading for `version`?
// Accepts "## <version>" and "## [<version>] ..." (Keep a Changelog), with
// or without a leading "v".
function hasChangelogEntry(absPkgDir, version) {
  const path = join(absPkgDir, "CHANGELOG.md");
  if (!existsSync(path)) return false;
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^##\\s*\\[?v?${escaped}\\]?(\\s|$)`, "m");
  return heading.test(readFileSync(path, "utf8"));
}

// Evaluates one package: reuses evaluatePackageDiff() for the version-change
// join, then judges the bump's shape when one occurred.
function evaluatePackage(pkgDir, requestedBase) {
  const diff = evaluatePackageDiff(pkgDir, requestedBase);
  if (diff.status === "error") return { package: diff.package, status: "error", detail: diff.detail };
  if (diff.status === "skip") return { package: diff.package, status: "skip", detail: diff.detail };
  if (diff.versionChanged !== true) {
    return { package: diff.package, status: "pass", detail: `no version change relative to the merge base -- nothing for this gate to judge (${diff.detail})` };
  }

  const { gitRoot, mergeBase, baseVersion, version } = diff;
  const bumpLevel = computeBumpLevel(baseVersion, version);
  if (bumpLevel === null) {
    return {
      package: diff.package,
      status: "error",
      detail: `version changed from ${baseVersion} to ${version}, which is not a clean single-step patch/minor/major semver bump -- cannot judge its shape`,
    };
  }

  const packageKey = basename(pkgDir);

  let baseChangesets;
  try {
    baseChangesets = changesetsAtCommit(gitRoot, mergeBase);
  } catch (error) {
    return { package: diff.package, status: "error", detail: `could not read ${CHANGESETS_DIR}/ at merge-base ${mergeBase.slice(0, 12)}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const headFiles = changesetFileNamesAtHead(gitRoot);
  const consumed = baseChangesets.filter((c) => Object.hasOwn(c.packages, packageKey) && !headFiles.has(c.file));

  if (consumed.length > 0) {
    const consumedLevel = consumed.reduce((best, c) => {
      const level = c.packages[packageKey];
      const order = ["patch", "minor", "major"];
      return order.indexOf(level) > order.indexOf(best) ? level : best;
    }, "patch");
    if (consumedLevel === bumpLevel) {
      return {
        package: diff.package,
        status: "pass",
        detail: `version bumped from ${baseVersion} to ${version} (${bumpLevel}), matching the consumed changeset(s) ${consumed.map((c) => c.file).join(", ")} -- release-PR shaped`,
      };
    }
    return {
      package: diff.package,
      status: "not-release-shaped",
      detail: `version bumped from ${baseVersion} to ${version} (${bumpLevel}), but the consumed changeset(s) ${consumed.map((c) => c.file).join(", ")} specify ${consumedLevel} -- levels must match`,
    };
  }

  if (hasChangelogEntry(pkgDir, version)) {
    return {
      package: diff.package,
      status: "pass",
      detail: `version bumped from ${baseVersion} to ${version} (${bumpLevel}) with a matching CHANGELOG.md entry -- accepted under the pre-existing docs/PUBLISHING.md convention`,
    };
  }

  return {
    package: diff.package,
    status: "not-release-shaped",
    detail:
      `version bumped from ${baseVersion} to ${version} (${bumpLevel}) since merge-base ${mergeBase.slice(0, 12)}, but no changeset naming "${packageKey}" was consumed and CHANGELOG.md has no entry for ${version}. ` +
      "A version change outside a release PR is refused (issue #1255) -- add a .changesets/<slug>.md instead of bumping directly, or add the CHANGELOG.md entry this bump requires.",
  };
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const baseIndex = argv.indexOf("--base");
  const requestedBase = baseIndex >= 0 ? argv[baseIndex + 1] : undefined;
  if (baseIndex >= 0 && requestedBase === undefined) {
    console.error("check-release-pr-shape: --base requires a value");
    process.exit(2);
  }
  const positional = argv.filter((a, i) => !a.startsWith("--") && i !== baseIndex + 1);
  const targets = positional.length > 0 ? positional : discoverPackages();

  if (targets.length === 0) {
    const message = "found no packages to check -- refusing to report a clean pass on an empty scan";
    if (json) console.log(JSON.stringify({ error: message, results: [] }, null, 2));
    else console.error(`check-release-pr-shape: ${message}`);
    process.exit(2);
  }

  const results = targets.map((dir) => evaluatePackage(dir, requestedBase));

  if (json) {
    console.log(JSON.stringify({ results }, null, 2));
  } else {
    const labels = { pass: "READY", skip: "SKIP ", "not-release-shaped": "FAIL ", error: "ERROR" };
    for (const r of results) console.log(`  [${labels[r.status]}] ${r.package} -- ${r.detail}`);
  }

  const worst = results.reduce((acc, r) => (r.status === "error" ? 2 : r.status === "not-release-shaped" && acc !== 2 ? 1 : acc), 0);

  if (!json) {
    console.log("");
    console.log(
      worst === 0
        ? "RELEASE PR SHAPE -- OK. Every version-bumped package's bump is release-PR shaped."
        : worst === 2
          ? "RELEASE PR SHAPE -- ERROR. Could not evaluate at least one package (see ERROR lines above)."
          : "RELEASE PR SHAPE -- FAIL. A version bump above is not release-PR shaped (see FAIL lines above).",
    );
  }
  process.exit(worst);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { changesetsAtCommit, discoverPackages, evaluatePackage, hasChangelogEntry };
