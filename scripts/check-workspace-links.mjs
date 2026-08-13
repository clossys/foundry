#!/usr/bin/env node
// check-workspace-links — does every first-party dependency range in this
// workspace still cover the sibling's ACTUAL on-disk version, and does
// package-lock.json still resolve every first-party package locally?
//
//   node scripts/check-workspace-links.mjs [--json] [<packageDir> ...]
//
// With no positional arguments, every packages/*/package.json in this repo
// is checked, and package-lock.json at the repository root is scanned.
// Exit 0 = every first-party range is satisfied by its sibling's real
// version, and every first-party package.lock entry is a local workspace
// link. Exit 1 = at least one finding. Exit 2 = the check could not be
// completed (an unreadable/unparseable manifest or lockfile, or an empty
// scan — see EMPTY SCAN below). Same three-way split every gate in this
// repo uses — see CONTRIBUTING.md's "Gate CLIs exit 0/1/2" entry.
//
// THE DEFECT THIS EXISTS TO CATCH
// --------------------------------
// Packages here depend on each other with 0.x ranges — e.g.
// `"@vespeneventures/governance": "^0.3.0"`. In 0.x semver BOTH `^` and `~`
// are minor-locked: `^0.3.0` and `~0.3.0` both mean `>=0.3.0 <0.4.0`. The
// moment a package's minor version is bumped, every sibling that declared a
// range against the OLD minor stops being satisfiable by the local
// workspace copy.
//
// What happens next is the part that costs real time: npm does not error at
// that point. It silently stops linking the sibling locally and resolves it
// from the registry instead. In CI, the tokenless tarball-safety job then
// fails with something like:
//
//   npm error 401 Unauthorized - GET https://npm.pkg.github.com/download/@vespeneventures/<pkg>/<version>/...
//
// which names the symptom (no auth) and completely hides the cause (a range
// that no longer covers the sibling's version). Worse, on a machine that IS
// authenticated the build succeeds while silently testing a STALE PUBLISHED
// COPY of the sibling instead of the working tree — a green build that
// proves nothing about the code under review. This has already cost real
// time more than once in this repository's own history (see the commits
// that widened `surface`'s `copy` and `ui` ranges after exactly this
// happened) — a consumer integration is what first surfaced the pattern.
//
// This gate checks the same defect from two directions:
//   1. LINK CHECK — for every packages/*/package.json, for every
//      `dependencies` entry naming a first-party sibling that exists in
//      this workspace, does the sibling's real on-disk version satisfy the
//      declared range?
//   2. LOCKFILE CHECK — does package-lock.json resolve every first-party
//      package as a local workspace link, never a remote registry URL? This
//      catches the same defect from the other direction, and also catches a
//      stale lockfile that a range fix forgot to regenerate (link check 1
//      only reads package.json, so it cannot see that by itself).
//
// RANGE FORMS THIS GATE UNDERSTANDS
// ----------------------------------
// Hand-rolled on purpose — no semver dependency, see AGENTS.md's "no new
// dependencies" rule. Only the forms this repo actually uses are supported:
// an exact pin (`1.2.3`), a caret range (`^1.2.3`), and a tilde range
// (`~1.2.3`). For `0.y.z`, BOTH `^` and `~` are minor-locked
// (`>=0.y.z <0.(y+1).0`) — that rule is the entire point of this gate, see
// parseRange()/rangeBounds() below and check-workspace-links.test.mjs's 0.x
// cases specifically. Anything else this gate does not recognise — `>=`/`<`
// comparators, `x`/`*` wildcards, `||` unions, pre-release/build tags, a
// missing patch component, `workspace:`/`catalog:` protocols (already
// banned elsewhere in this repo, but not this gate's job to enforce) — is
// UNPARSEABLE. An unparseable range is a finding, not a pass: this gate
// never assumes the best about a form it could not evaluate.
//
// EMPTY SCAN
// ----------
// Discovering zero packages, OR discovering packages but finding zero
// first-party `dependencies` edges among them, is exit 2 — never a clean
// 0. scripts/check-release-readiness.mjs shipped exactly the opposite
// defect (fixed in commit 01bd520): an empty scan reported "every package
// is release-ready" on the strength of having examined none. A check that
// passes because it checked nothing is indistinguishable from a check that
// cannot fail, and this repo's own packages/*/dependencies graph is never
// actually empty, so an empty result here means the scan itself is broken,
// not that the workspace has no first-party links.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ------------------------------------------------------------- range parsing

// Strict x.y.z only — no pre-release/build metadata, no leading "v", no
// extra whitespace inside the number groups. A version this repo's own
// package.json manifests do not actually use is not a version this gate
// pretends to understand.
function parseVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

// Parses ONLY an exact pin, a caret range, or a tilde range against a plain
// x.y.z. Returns null — "unparseable" — for anything else. The caller must
// treat null as a finding, never a silent pass: see this file's own header.
function parseRange(range) {
  const m = /^(\^|~)?(\d+)\.(\d+)\.(\d+)$/.exec(String(range).trim());
  if (!m) return null;
  const [, prefix, major, minor, patch] = m;
  return { prefix: prefix ?? "", major: Number(major), minor: Number(minor), patch: Number(patch) };
}

// The 0.x rule this gate exists to get right: for `0.y.z`, BOTH `^0.y.z` and
// `~0.y.z` are minor-locked (`>=0.y.z <0.(y+1).0`) — unlike `>=1.0.0`, where
// caret is major-locked (`^1.2.3` -> `>=1.2.3 <2.0.0`) and only tilde is
// minor-locked (`~1.2.3` -> `>=1.2.3 <1.3.0`). An exact pin has no range at
// all: only that literal version satisfies it.
function rangeBounds({ prefix, major, minor, patch }) {
  if (prefix === "") return { lower: { major, minor, patch }, upper: { major, minor, patch: patch + 1 } };
  if (major === 0) return { lower: { major, minor, patch }, upper: { major, minor: minor + 1, patch: 0 } };
  if (prefix === "^") return { lower: { major, minor, patch }, upper: { major: major + 1, minor: 0, patch: 0 } };
  return { lower: { major, minor, patch }, upper: { major, minor: minor + 1, patch: 0 } }; // "~"
}

// Returns { evaluated: false, reason } when either side could not be parsed
// (a finding, never assumed satisfied), or { evaluated: true, ok } once both
// sides parsed cleanly.
function satisfies(versionStr, rangeStr) {
  const range = parseRange(rangeStr);
  if (!range) {
    return {
      evaluated: false,
      reason: `"${rangeStr}" is not a range form this gate parses (only an exact pin, ^x.y.z, or ~x.y.z are supported)`,
    };
  }
  const version = parseVersion(versionStr);
  if (!version) {
    return {
      evaluated: false,
      reason: `the sibling's on-disk version "${versionStr}" is not a plain x.y.z semver this gate can compare`,
    };
  }
  const { lower, upper } = rangeBounds(range);
  const ok = compareVersions(version, lower) >= 0 && compareVersions(version, upper) < 0;
  return { evaluated: true, ok };
}

// ------------------------------------------------------------ manifest scan

// Resolved against the current working directory, not this script's own
// location — every caller (package.json's `check` script, CI, a developer's
// shell) runs this from the repository root, the same convention every
// other packages/*-iterating script here follows (see
// check-release-readiness.mjs's discoverPackages()).
function discoverPackages() {
  const packagesDir = join(process.cwd(), "packages");
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(packagesDir, d.name))
    .filter((dir) => existsSync(join(dir, "package.json")))
    .sort();
}

// An unreadable or unparseable package.json is always a result the caller
// sees — never a silent skip. See loadManifest()'s two callers below.
function loadManifest(pkgDir) {
  const manifestPath = join(pkgDir, "package.json");
  let raw;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (error) {
    return { pkgDir, error: `could not read ${manifestPath}: ${error.message}` };
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    return { pkgDir, error: `${manifestPath} is not valid JSON: ${error.message}` };
  }
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    return { pkgDir, error: `${manifestPath} has no valid "name" field` };
  }
  return { pkgDir, manifest };
}

// LINK CHECK — see file header. `knownVersions` maps every successfully
// loaded workspace package's name to its own on-disk version string; a
// `dependencies` entry naming anything outside that map is not "a
// first-party sibling that exists in this workspace" and is not evaluated.
function evaluateLinks(loaded) {
  const results = [];
  const knownVersions = new Map();
  for (const l of loaded) {
    if (!l.error) knownVersions.set(l.manifest.name, l.manifest.version);
  }

  for (const l of loaded) {
    if (l.error) {
      results.push({ check: "link", package: l.pkgDir, status: "error", detail: l.error });
      continue;
    }
    const { manifest } = l;
    const deps = manifest.dependencies;
    if (!deps || typeof deps !== "object") continue;

    for (const [depName, range] of Object.entries(deps)) {
      if (depName === manifest.name) continue; // defensive: a package cannot depend on itself
      if (!knownVersions.has(depName)) continue; // not a sibling that exists in this workspace scan
      const actualVersion = knownVersions.get(depName);
      const outcome = satisfies(actualVersion, range);

      if (!outcome.evaluated) {
        results.push({
          check: "link",
          package: manifest.name,
          dependency: depName,
          range,
          actualVersion,
          status: "finding",
          detail:
            `${manifest.name} declares "${depName}": "${range}" — ${outcome.reason}. ` +
            "A range this gate cannot evaluate is reported as a finding, not assumed satisfied.",
        });
      } else if (!outcome.ok) {
        results.push({
          check: "link",
          package: manifest.name,
          dependency: depName,
          range,
          actualVersion,
          status: "finding",
          detail:
            `${manifest.name} declares "${depName}": "${range}", but ${depName}'s on-disk version is ` +
            `${actualVersion}, which that range does not cover. In 0.x semver both ^ and ~ are minor-locked, ` +
            `so a minor bump of ${depName} silently breaks this. npm will stop linking the local workspace ` +
            `copy of ${depName} and fall back to resolving it from the registry instead — the tokenless CI ` +
            "job then 401s, and an authenticated machine silently tests a stale published copy instead of " +
            `the working tree. Fix: widen ${manifest.name}'s declared range to cover ${actualVersion} (or pin ` +
            `${depName} back down), then bump ${manifest.name}'s own version too, since its package.json is ` +
            "packed content and the release-readiness gate will demand it.",
        });
      } else {
        results.push({
          check: "link",
          package: manifest.name,
          dependency: depName,
          range,
          actualVersion,
          status: "pass",
          detail: `${manifest.name} declares "${depName}": "${range}" — satisfied by ${depName}@${actualVersion}`,
        });
      }
    }
  }

  return { results, knownVersions };
}

// -------------------------------------------------------------- lockfile scan

// True when `key` (a key of package-lock.json's top-level "packages" map)
// is a node_modules resolution entry for `name` — either the root
// `node_modules/<name>` or a nested `<somewhere>/node_modules/<name>` for a
// package npm could not hoist. Deliberately excludes the workspace member's
// own manifest entry (e.g. "packages/copy", with no "node_modules" segment
// at all), which is not a resolution of anything.
function isNodeModulesEntryFor(key, name) {
  return key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`);
}

// LOCKFILE CHECK — see file header. `knownNames` is every workspace
// package's own name, from the same manifests the link check already
// loaded (not re-derived from package-scope.json, so this stays correct
// even for a first-party name that momentarily does not match the
// configured scope).
function checkLockfile(knownNames) {
  const lockPath = join(process.cwd(), "package-lock.json");
  if (!existsSync(lockPath)) {
    return [
      {
        check: "lockfile",
        package: "package-lock.json",
        status: "error",
        detail: `no package-lock.json found at ${lockPath} — cannot verify first-party packages resolve locally`,
      },
    ];
  }

  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (error) {
    return [
      { check: "lockfile", package: "package-lock.json", status: "error", detail: `${lockPath} is not valid JSON: ${error.message}` },
    ];
  }

  const packages = lock.packages;
  if (!packages || typeof packages !== "object") {
    return [
      {
        check: "lockfile",
        package: "package-lock.json",
        status: "error",
        detail: `${lockPath} has no "packages" key — not an npm lockfile (v2/v3) this gate can read`,
      },
    ];
  }

  const results = [];
  for (const [key, entry] of Object.entries(packages)) {
    const name = [...knownNames].find((n) => isNodeModulesEntryFor(key, n));
    if (!name) continue;

    if (entry && entry.link === true) {
      results.push({ check: "lockfile", package: name, status: "pass", detail: `${key} is a local workspace link` });
      continue;
    }

    const resolved = entry && typeof entry.resolved === "string" ? entry.resolved : undefined;
    if (resolved && /^https?:\/\//i.test(resolved)) {
      results.push({
        check: "lockfile",
        package: name,
        status: "finding",
        detail:
          `${key} resolves ${name} from a remote registry URL (${resolved}) instead of the local workspace ` +
          "link. This is the same defect the link check catches, from the other direction: whatever range " +
          `broke to produce this, \`npm ci\` will install this exact remote tarball for ${name} rather than ` +
          "the working tree, and the tokenless artifact-safety CI job will 401 trying to fetch it. Fix the " +
          `declaring package's range for ${name} (see the link-check findings above, if any) and regenerate ` +
          "the lockfile with a real `npm install` — a stale lockfile that a range fix forgot to regenerate " +
          "reproduces exactly this.",
      });
      continue;
    }

    // Neither a recognised local link nor a recognised remote URL. Treating
    // an unrecognised shape as a pass is exactly the failure mode this gate
    // exists to avoid — see the file header's "never assumed satisfied."
    results.push({
      check: "lockfile",
      package: name,
      status: "finding",
      detail:
        `${key} is neither a recognised local workspace link ("link": true) nor a recognised remote URL — ` +
        `resolved: ${JSON.stringify(resolved)}. Could not verify this resolves locally.`,
    });
  }

  return results;
}

// ------------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const positional = argv.filter((a) => a !== "--json");
  const targets = positional.length > 0 ? positional : discoverPackages();

  if (targets.length === 0) {
    // Scanning nothing is "could not run" (2), never a clean pass (0) — see
    // this file's EMPTY SCAN header section and 01bd520.
    const message = "found no packages to check — refusing to report a clean pass on an empty scan";
    if (json) console.log(JSON.stringify({ error: message, results: [] }, null, 2));
    else console.error(`check-workspace-links: ${message}`);
    process.exit(2);
  }

  const loaded = targets.map((dir) => loadManifest(resolve(dir)));
  const { results: linkResults, knownVersions } = evaluateLinks(loaded);

  const edgeCount = linkResults.filter((r) => r.status !== "error").length;
  if (edgeCount === 0) {
    // Packages were discovered, but zero first-party `dependencies` edges
    // were found among them (or every edge belonged to a package whose own
    // manifest failed to load, in which case those errors already dominate
    // the exit code below). This workspace's own packages/*/dependencies
    // graph is never actually empty — see EMPTY SCAN in the header — so this
    // is the same "the scan itself is broken" signal as zero packages.
    linkResults.push({
      check: "link",
      package: "(workspace)",
      status: "error",
      detail:
        "discovered packages but found zero first-party dependency edges among their \"dependencies\" " +
        "fields — refusing to report a clean pass on an empty scan (see this script's EMPTY SCAN header).",
    });
  }

  const lockResults = checkLockfile(new Set(knownVersions.keys()));

  const results = [...linkResults, ...lockResults];

  if (json) {
    console.log(JSON.stringify({ results }, null, 2));
  } else {
    const labels = { pass: "PASS ", finding: "FIND ", error: "ERROR" };
    for (const r of results) {
      const who = r.dependency ? `${r.package} -> ${r.dependency}` : r.package;
      console.log(`  [${labels[r.status]}] [${r.check}] ${who} — ${r.detail}`);
    }
  }

  // Same worst-of-three aggregation check-release-readiness.mjs uses: an
  // error anywhere dominates a finding, which dominates a clean pass.
  const worst = results.reduce((acc, r) => (r.status === "error" ? 2 : r.status === "finding" && acc !== 2 ? 1 : acc), 0);

  if (!json) {
    console.log("");
    console.log(
      worst === 0
        ? "WORKSPACE LINKS OK — every first-party dependency range is satisfied by its sibling's real version, and package-lock.json resolves every first-party package locally."
        : worst === 2
          ? "WORKSPACE LINKS ERROR — could not evaluate at least one package or the lockfile (see ERROR lines above)."
          : "WORKSPACE LINKS FAIL — the FIND lines above will silently stop resolving locally the moment npm re-links the tree (npm ci in particular): widen the declared range (and bump the declaring package's own version) or regenerate package-lock.json, then re-run this gate.",
    );
  }
  process.exit(worst);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { checkLockfile, discoverPackages, evaluateLinks, loadManifest, parseRange, rangeBounds, satisfies };
