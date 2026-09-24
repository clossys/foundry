#!/usr/bin/env node
// apply-release-changesets — the release PR command (issue #1255), opened
// on the weekly calendar's Saturday release day (docs/RELEASING.md, owner
// decision 2026-09-23) but still versioning by plain semver bump level --
// the owner explicitly kept semver rather than a clock-driven scheme,
// because there is not necessarily a real content change every week and a
// version that moves on a date rather than on a change is not a useful
// signal.
//
//   node scripts/apply-release-changesets.mjs [--json] [--dry-run] [--out-of-band]
//
// Reads every pending changeset under .changesets/ (scripts/collect-
// changesets.mjs), groups them by named package, and for each named
// package:
//   - bumps packages/<dir>/package.json's version once, by the HIGHEST
//     bump level any of that package's changesets named;
//   - prepends an entry for the new version to docs/changelogs/<dir>.md
//     (the package changelog, kept in this public repository rather than
//     in the tarball -- see scripts/lib/changelog-location.mjs),
//     concatenating that package's changeset summaries as bullet points
//     (Keep a Changelog format, matching docs/PUBLISHING.md section 4),
//     with a "Breaking changes" subsection for any consumed changeset
//     whose level was `major`;
//   - deletes the changeset files it applied.
// Then, for every OTHER workspace package that depends on a bumped package
// via a range that no longer covers the new version (issue #1332), rewrites
// that dependency's declared range to `^<newVersion>` too, in the SAME
// package.json write -- see "SIBLING DEPENDENCY RANGES" below. Finally
// regenerates package-lock.json (`npm install --package-lock-only`, skipped
// under --dry-run) so every bumped workspace version, and every rewritten
// sibling range, is reflected there too.
//
// A PACKAGE WITH NO PENDING CHANGESET IS NOT TOUCHED, AND A WEEK WITH NO
// CHANGESETS AT ALL OPENS NO RELEASE PR
// -------------------------------------------------------------------------
// This script only ever bumps packages `namedPackages()` finds among
// pending changesets -- an unrelated active package sits still, same as
// before docs/RELEASING.md's weekly calendar existed. When there are no
// pending changesets anywhere, `applyReleaseChangesets()` returns
// `{ applied: [], ... }` without writing anything, without calling
// `runNpmInstall`, and (critically) without needing governance/
// release-calendar.json to even exist -- see the early return below. In
// .github/workflows/release-pr.yml, an empty `applied` array is exactly
// what makes the "Push branch and open pull request" step's `if:` skip: a
// quiet week produces no branch, no commit, and no pull request at all, not
// an empty one.
//
// Exit 0 = applied cleanly (or nothing was pending). Exit 1 = a package a
// changeset names does not exist, its current version is not a plain
// X.Y.Z, its manifest text could not be safely rewritten (issue #1327), or
// a sibling's dependency range on a bumped package could not be safely
// resolved (issue #1332 -- see below). Exit 2 = at least one changeset
// under .changesets/ is malformed (fix it before running a release -- this
// script never silently ignores one).
//
// --dry-run prints exactly what would change (every version bump, every
// dependency-range rewrite, every CHANGELOG entry, every deleted changeset
// file) without writing or deleting anything, and without invoking npm.
//
// --out-of-band RESTRICTS THIS RUN TO out-of-band CHANGESETS ONLY (second-
// opinion fix, https://github.com/clossys/foundry/pull/1316#issuecomment-5800188207,
// widened by owner decision 2026-09-23, #1187 comment 5800369031)
// --------------------------------------------------------------------------
// An out-of-band release (governance/release-calendar.json's
// outOfBandPolicy -- a security fix, a fix for a release that already
// shipped broken, or an owner-approved urgent update, never ordinary
// content) must consume ONLY changesets carrying `release: out-of-band` in
// their frontmatter. Without --out-of-band this script is the ordinary
// Saturday release: it consumes every pending changeset, out-of-band-
// flagged or not, same as always. WITH --out-of-band, every changeset that
// does NOT carry the flag is filtered out entirely BEFORE grouping by
// package -- an ordinary pending `minor` or `major` changeset for the same
// package an out-of-band `patch` changeset also names is left untouched in
// .changesets/, to be picked up by the next regular Saturday release
// exactly as if this run had never happened.
//
// LEVEL: patch by default, minor only with explicit owner approval, major
// never
// -------------------------------------------------------------------------
// An out-of-band changeset is patch-level by default. A `minor` bump is
// allowed ONLY when the changeset also carries `owner-approved: minor` in
// its frontmatter (scripts/collect-changesets.mjs enforces this per file,
// at parse time). `major` is never allowed out of band, with or without
// owner approval. This is also the second, defense-in-depth reason
// --out-of-band refuses (as a finding, not a silent downgrade) if the
// highest level among the out-of-band changesets it did consume for some
// NAMED package is not `patch`, or is `minor` without a consumed changeset
// carrying `owner-approved: minor` -- collect-changesets.mjs already makes
// both cases unreachable through this script's own public (file-based)
// surface; this check stays here anyway as the same "fail closed on a
// should-be-impossible state" discipline this repository's other gates use
// throughout.
//
// scripts/check-release-pr-shape.mjs is what proves, on the resulting pull
// request, that this is the only way an ordinary content pull request's
// version can legitimately move — see that script's own header, and the
// design comment linked below.
//
// COMPOSING OUT-OF-BAND FILTERING WITH SIBLING DEPENDENCY RANGES (re-review,
// https://github.com/clossys/foundry/pull/1316#issuecomment-5802195430 --
// #1316's out-of-band/breaking-change support and #1338's sibling-
// dependency-range rewriting both touched this function's core loop
// independently; T10's merge train dropped both rather than guess at how
// they compose. This is that composition, made explicit)
// -------------------------------------------------------------------------
// The two features interact at exactly one boundary, and the ordering
// below is the whole of that boundary:
//
//   1. OUT-OF-BAND FILTERING RUNS FIRST, AND DECIDES THE RELEASED SET.
//      `entries` (the changesets this run will ever look at) is computed by
//      filtering `allEntries` on `outOfBandOnly` BEFORE anything else --
//      before `namedPackages()`, before PHASE A, before PHASE B's
//      sibling-range scan. Every later phase only ever sees packages this
//      filtered set actually names. A package whose only pending changeset
//      was filtered out (an ordinary `minor` changeset left behind by an
//      `--out-of-band` run) is invisible to every downstream phase, exactly
//      as if it had never had a pending changeset at all.
//
//   2. SIBLING RANGE REWRITES ARE COMPUTED ONLY AGAINST RELEASED PACKAGES.
//      PHASE B's `bumpedVersions` map (the set of "new version" facts a
//      sibling's declared range is checked against) is built ONLY from
//      PHASE A's `namedPlans` -- i.e. only from packages the (already
//      out-of-band-filtered) `entries` set actually named and bumped. A
//      package this run does NOT release can never appear in
//      `bumpedVersions`, so a dependent can never be pointed at a version
//      this run doesn't publish -- there is no separate "is this an
//      out-of-band run" check needed in PHASE B at all; restricting what
//      PHASE A ever bumps is sufficient, because PHASE B only ever reacts
//      to what PHASE A actually did.
//
//   3. A DEPENDENT-ONLY PATCH BUMP COUNTS AS IN-BAND, ALWAYS -- this is the
//      one place this composition had to make a real design decision, not
//      just an ordering choice. A dependent-only bump (PHASE B/C's
//      `dependentOnlyPlans`) is never itself the direct product of
//      consuming a changeset -- it exists purely to keep a sibling's
//      declared range from lying about what it actually resolves to once
//      the package it depends on has been released at a new version. It is
//      UNCONDITIONALLY capped at `bump: "patch"` (see PHASE B below,
//      unchanged from #1338) -- the least disruptive level there is, and
//      structurally the SAME default level an out-of-band run itself uses.
//      So this run treats it as in-band and lets it through regardless of
//      `outOfBandOnly`: it is exempt from the per-package out-of-band
//      "patch, or owner-approved minor" gate PHASE A enforces on NAMED
//      packages, because it is never itself `minor` or `major` and so could
//      never violate that gate in the first place. It gets `outOfBand:
//      false` and `breaking: false` on its `applied` entry (never `true`)
//      -- it did not consume an out-of-band-flagged changeset, and it
//      cannot be a breaking change (a breaking change is major-only, and
//      this bump is never anything but patch) -- see PHASE C below and
//      .github/workflows/release-pr.yml's `applied.some((a) => a.outOfBand)`
//      labeling logic, which this leaves correct either way: an
//      out-of-band run's OWN named entries already carry `outOfBand: true`
//      on their own account, so the dependent-only entry's `false` never
//      changes whether the resulting PR gets labeled `release:out-of-band`.
//
// scripts/lib/release-pr-footprint.mjs's `evaluateReleasePrFootprint()` is
// what proves, on the resulting pull request, that the composed diff this
// function produces is EXACTLY this shape and nothing more -- see that
// module's own header.
//
// SIBLING DEPENDENCY RANGES (issue #1332)
// -----------------------------------------
// In 0.x semver (and, for a caret range, at any major) BOTH `^` and `~` are
// range-locked to the leading nonzero component -- see scripts/check-
// workspace-links.mjs's own header for the exact rule this reuses
// (rangeBounds()/satisfies(), imported from there rather than
// reimplemented, so this script's rewriter and that gate's checker can
// never quietly disagree about what "satisfies" means). The moment a
// bumped package's new version falls outside a sibling's declared range on
// it, that sibling's OWN packed manifest -- once published -- keeps citing
// a range a fresh install can no longer resolve to the version it was
// actually released alongside; check-workspace-links.mjs catches this
// AFTER the fact (as a FIND, at the next PR), this script now prevents it
// from ever being committed in the first place.
//
// For every workspace package (named by a changeset or not) that declares
// a `dependencies`, `peerDependencies`, or `optionalDependencies` entry
// naming a package this run bumps, with a range the new version no longer
// satisfies:
//   - the entry is rewritten, in place, to `^<newVersion>`, preserving
//     every other byte of the manifest (same byte-preserving discipline as
//     bumpManifestText() below -- see bumpDependencyRangeText());
//   - if the dependent is not itself named by any changeset, it gets its
//     OWN version bumped by one PATCH step -- its packed manifest changed,
//     so docs/PUBLISHING.md section 4 applies to it too -- with a
//     changelog entry whose bullet reads
//     "Updated dependency <name> to ^<newVersion>";
//   - if the dependent IS already named by a changeset (bumping for its
//     own, unrelated reason), the same bullet is appended to the CHANGELOG
//     entry that run was already going to write, and no second bump is
//     introduced -- one package.json write per package per run, always.
// A patch bump never crosses the boundary a caret/tilde range is locked
// to, so a dependent-only patch bump issued here can never itself put some
// THIRD package's range out of date -- this is a single pass over the
// packages a changeset actually named, never a fixed-point closure, and
// does not need to be one.
//
// A declared range this script cannot safely evaluate -- notably the
// `workspace:*` and `catalog:` protocols this repository's own AGENTS.md
// forbids outright, but also anything else outside a plain pin/caret/tilde
// x.y.z form -- is a finding, never a guess: this run refuses entirely
// rather than silently leave (or silently "fix") a range it cannot prove
// is now wrong. See forbiddenProtocolReason() and collectDependencyUpdates()
// below.
//
// devDependencies IS SCANNED AND REWRITTEN TOO, BUT NEVER TRIGGERS ITS OWN
// DEPENDENT BUMP (decision + fix, re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726)
// -------------------------------------------------------------------------
// An earlier draft of this header excluded devDependencies entirely, on
// the reasoning that npm never reads a PUBLISHED dependency's own
// devDependencies when resolving it as someone else's dependency --
// dependencies/peerDependencies/optionalDependencies alone affect what an
// EXTERNAL consumer resolves. That reasoning is still correct for an
// external consumer, but it missed a real case inside this monorepo
// itself: `npm install --package-lock-only` at THIS repository's own root
// (what runNpmInstall() above calls) DOES resolve every workspace member's
// devDependencies, same as any other npm workspaces install -- it is
// building the whole dev environment, not just each package's published
// output. `packages/controller`'s real devDependencies on
// `@clossys/advisor` (`^0.4.0`) is exactly this case: a minor bump of
// advisor that moves its version outside that range leaves the range
// stale, and the next `npm install --package-lock-only` either fails
// offline or resolves a registry copy online -- the same defect issue
// #1332 exists to prevent for dependencies/peerDependencies/
// optionalDependencies, just triggered through a devDependencies edge
// instead.
//
// So devDependencies IS now included in the scan below and rewritten the
// identical way (see DEV_DEPENDENCY_RANGE_SECTIONS) -- but it is scanned
// and rewritten SEPARATELY from dependencies/peerDependencies/
// optionalDependencies (DEPENDENCY_RANGE_SECTIONS), and a devDependencies
// rewrite BY ITSELF never triggers a dependent-only version bump the way a
// dependencies/peerDependencies/optionalDependencies rewrite does. A
// devDependencies range is never published or consumer-facing at all --
// there is nothing for a version bump to communicate to anyone outside
// this repository, and bumping (with a CHANGELOG entry and a version that
// looks like a real release) a package whose only change is an internal
// dev-environment detail would be actively misleading. A package that
// needs ONLY a devDependencies rewrite gets that rewrite written silently,
// with no version change, no CHANGELOG entry, and no `applied` entry of
// its own -- see `devDependencyOnlyPlans` below. A package that ALSO needs
// a dependencies/peerDependencies/optionalDependencies rewrite (or is
// independently named by its own changeset) still gets its own bump for
// THAT reason, and any devDependencies rewrite it also needs is folded
// into that same manifest write.
//
// scripts/check-workspace-links.mjs's own pre-existing sibling-range gate
// still scans only manifest.dependencies (issue #1340, not fixed here --
// see that issue for whether extending it to all four sections is small
// enough to do separately). That gate and this rewriter are allowed to
// disagree on SCOPE without disagreeing on MEANING: this rewriter fixing a
// devDependencies edge here does not depend on that gate also checking it,
// and that gate not yet checking it does not make this rewrite wrong.
//
// Design: https://github.com/clossys/foundry/issues/1255#issuecomment-5790113827
// Weekly calendar design (versioning unchanged): docs/RELEASING.md, refs #1187 #1265 #1266
// Refs: #1322, #1327, #1332.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { changesetsForPackage, highestBumpLevel, loadChangesets } from "./collect-changesets.mjs";
import { parseSemver } from "./check-release-pr-shape.mjs";
import { satisfies } from "./check-workspace-links.mjs";
import { changelogPath as changelogPathFor, changelogRelPath } from "./lib/changelog-location.mjs";

function die(message, code = 1) {
  console.error(`apply-release-changesets: ${message}`);
  process.exit(code);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// Every package name named by at least one changeset, in first-seen order
// across the (already sorted-by-file) entries.
export function namedPackages(entries) {
  const seen = new Set();
  for (const entry of entries) for (const pkg of Object.keys(entry.packages)) seen.add(pkg);
  return [...seen];
}

// Applies exactly one bump step -- the inverse of check-release-pr-
// shape.mjs's computeBumpLevel(). Throws on anything that isn't a plain
// X.Y.Z, matching that script's own parseSemver() restriction.
export function bumpVersion(version, level) {
  const parsed = parseSemver(version);
  if (!parsed) throw new Error(`"${version}" is not a plain X.Y.Z semver -- cannot bump it`);
  const [major, minor, patch] = parsed;
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  if (level === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`unknown bump level "${level}"`);
}

// Replaces the top-level "version" field's value in a package.json's RAW
// TEXT, preserving every other byte -- deliberately not a JSON.parse/
// re-stringify round trip, which would silently reformat whatever the
// author's own formatting happened to be. Matches only a line indented by
// exactly two spaces (this repository's own package.json convention), so a
// "version" key nested deeper inside some other field (there is none today,
// but this stays narrow on purpose) can never be mistaken for the top-level
// one. Throws unless there is EXACTLY one match -- fail closed rather than
// bump the wrong field or silently do nothing. Every call site of this
// function during planning is wrapped in try/catch (issue #1327) -- a
// package.json that doesn't match this repository's own two-space
// convention (e.g. 4-space indented) is a finding, not an uncaught crash.
export function bumpManifestText(text, newVersion) {
  const re = /^( {2})"version": "[^"]*"/m;
  const matches = text.match(new RegExp(re.source, "gm")) ?? [];
  if (matches.length !== 1) throw new Error(`expected exactly one top-level "version" field, found ${matches.length}`);
  return text.replace(re, `$1"version": "${newVersion}"`);
}

// Rewrites a single dependency entry's declared range inside one top-level
// section object (`dependencies`, `peerDependencies`, or
// `optionalDependencies`), preserving every other byte -- the same
// byte-preserving, fail-closed discipline as bumpManifestText() above, just
// one level deeper. Requires the section to appear as a two-space-indented
// top-level block (`  "dependencies": {\n...\n  }`, this repository's own
// convention) with the named dependency appearing exactly once inside it,
// four-space indented (`    "<name>": "<range>"`, matching every
// packages/*/package.json in this repo today -- see packages/builder/
// package.json's own `dependencies` block for the exact shape). Throws --
// never silently no-ops -- if the section or the entry cannot be found
// exactly once; every call site during planning is wrapped in try/catch,
// same as bumpManifestText(), so a shape this cannot safely rewrite becomes
// a finding, not a corrupted or silently-skipped manifest.
export function bumpDependencyRangeText(text, section, depName, newRange) {
  const escSection = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockRe = new RegExp(`^( {2})"${escSection}": \\{\\n([\\s\\S]*?)\\n\\1\\}`, "m");
  const blockMatches = text.match(new RegExp(blockRe.source, "gm")) ?? [];
  if (blockMatches.length !== 1) {
    throw new Error(`expected exactly one top-level "${section}" block, found ${blockMatches.length}`);
  }
  const m = blockRe.exec(text);
  const indent = m[1];
  const body = m[2];
  const prefix = `${indent}"${section}": {\n`;
  const suffix = `\n${indent}}`;
  const escName = depName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lineRe = new RegExp(`^( {4})"${escName}": "[^"]*"`, "m");
  const lineMatches = body.match(new RegExp(lineRe.source, "gm")) ?? [];
  if (lineMatches.length !== 1) {
    throw new Error(`expected exactly one "${depName}" entry in "${section}", found ${lineMatches.length}`);
  }
  const newBody = body.replace(lineRe, `$1"${depName}": "${newRange}"`);
  const blockStart = m.index;
  const blockEnd = m.index + m[0].length;
  return text.slice(0, blockStart) + prefix + newBody + suffix + text.slice(blockEnd);
}

// Prepends a Keep-a-Changelog entry. If the file already has an existing
// "## " entry, the new one goes directly above the first one (below any
// "# Changelog" title and leading blank lines). If the file is brand new
// (created fresh per docs/PUBLISHING.md section 4) or has no "## " entry
// yet, the new entry is appended after whatever header text exists.
//
// `breakingBullets` (may be empty) renders as its own "### Breaking
// changes" subsection ABOVE the full bullet list -- `bullets` still
// includes every summary, breaking or not, so nothing is ever dropped from
// the plain changelog reading; the subsection is a highlight, not a
// replacement. `bullets` itself is the UNION of that package's own
// changeset summaries and any "Updated dependency <name> to ^<newVersion>"
// bullets a sibling dependency-range rewrite added (see this file's own
// "SIBLING DEPENDENCY RANGES" section) -- the caller composes that union
// before calling this function; a dependent-only bump (no changeset of its
// own) never has breaking bullets, since a breaking change is major-only
// and a dependent-only bump is always patch-only.
export function prependChangelogEntry(existingText, { version, date, bullets, breakingBullets = [] }) {
  const entryLines = [`## ${version} - ${date}`, ""];
  if (breakingBullets.length > 0) {
    entryLines.push("### Breaking changes", "", ...breakingBullets.map((b) => `- ${b}`), "");
  }
  entryLines.push(...bullets.map((b) => `- ${b}`), "");
  const entry = entryLines.join("\n");
  const text = existingText ?? "# Changelog\n\n";
  const firstEntryIndex = text.search(/^## /m);
  if (firstEntryIndex === -1) {
    return `${text.replace(/\n*$/, "\n\n")}${entry}`;
  }
  return `${text.slice(0, firstEntryIndex)}${entry}\n${text.slice(firstEntryIndex)}`;
}

// dependencies/peerDependencies/optionalDependencies -- a stale range in
// any of these needs a dependent-only version bump when nothing else is
// already bumping that package (they are published/consumer-facing). See
// DEV_DEPENDENCY_RANGE_SECTIONS just below for the separate,
// never-triggers-a-bump devDependencies scan, and this file's own header
// ("devDependencies IS SCANNED AND REWRITTEN TOO...") for why the two are
// kept separate.
export const DEPENDENCY_RANGE_SECTIONS = ["dependencies", "peerDependencies", "optionalDependencies"];

// devDependencies ALONE -- scanned and rewritten by the identical rule
// (bumpDependencyRangeText(), forbiddenProtocolReason(), satisfies()), but
// NEVER by itself the reason a package gets a dependent-only version bump.
// See this file's own header for why.
export const DEV_DEPENDENCY_RANGE_SECTIONS = ["devDependencies"];

// Is `range` a protocol this repository's own AGENTS.md forbids outright
// ("No workspace:* or catalog: dependency protocols")? If so, this script
// refuses to rewrite it -- and refuses the whole run, same as any other
// planning finding -- rather than paper over a range that already
// shouldn't exist. Checked before satisfies() below so the refusal message
// names the actual forbidden-protocol reason, not a generic "unparseable
// range" one.
export function forbiddenProtocolReason(range) {
  const trimmed = String(range).trim();
  if (trimmed.startsWith("workspace:")) {
    return `"${range}" uses the "workspace:" protocol, which this repository's AGENTS.md forbids outright -- refusing to rewrite it`;
  }
  if (trimmed.startsWith("catalog:")) {
    return `"${range}" uses the "catalog:" protocol, which this repository's AGENTS.md forbids outright -- refusing to rewrite it`;
  }
  return null;
}

// Scans one already-parsed workspace package manifest for dependency edges
// onto a bumped package whose declared range the new version no longer
// satisfies. `bumpedVersions` maps an npm package NAME (manifest.name, not
// a packages/<dir> directory -- a changeset names a directory, but a
// dependency range names the npm package, and the two are not always the
// same string, see collect-changesets.mjs's own header) to its new version
// string. Returns `{ updates, errors }`: `updates` is
// `{ section, name, fromRange, toRange }[]`, ready for
// bumpDependencyRangeText(); `errors` is one string per range this script
// refuses to touch (a forbidden protocol, or anything else satisfies()
// cannot evaluate) -- fail-closed, same as check-workspace-links.mjs's own
// "an unparseable range is a finding, never assumed satisfied" rule.
// `sections` defaults to DEPENDENCY_RANGE_SECTIONS (the three
// publish-relevant ones); callers pass DEV_DEPENDENCY_RANGE_SECTIONS to
// scan devDependencies instead, in a SEPARATE call -- the two are never
// mixed in one call, because whether an update came from one or the other
// decides whether the dependent needs its own version bump (see this
// file's own header).
export function collectDependencyUpdates(dependentDescription, manifest, bumpedVersions, sections = DEPENDENCY_RANGE_SECTIONS) {
  const updates = [];
  const errors = [];
  for (const section of sections) {
    const deps = manifest[section];
    if (!deps || typeof deps !== "object") continue;
    for (const [depName, range] of Object.entries(deps)) {
      if (depName === manifest.name) continue; // defensive: a package cannot depend on itself
      if (!Object.prototype.hasOwnProperty.call(bumpedVersions, depName)) continue;
      const newVersion = bumpedVersions[depName];

      const forbidden = forbiddenProtocolReason(range);
      if (forbidden) {
        errors.push(`${dependentDescription} "${section}"."${depName}": ${forbidden}`);
        continue;
      }

      const outcome = satisfies(newVersion, range);
      if (!outcome.evaluated) {
        errors.push(
          `${dependentDescription} "${section}"."${depName}": "${range}" -- ${outcome.reason}; cannot determine whether ${depName}@${newVersion} still satisfies it`,
        );
        continue;
      }
      if (outcome.ok) continue; // still satisfied by the new version -- no rewrite needed

      updates.push({ section, name: depName, fromRange: range, toRange: `^${newVersion}` });
    }
  }
  return { updates, errors };
}

function dependencyUpdateBullets(updates) {
  return updates.map((u) => `Updated dependency ${u.name} to ${u.toRange}`);
}

function applyDependencyRewrites(text, updates) {
  let result = text;
  for (const u of updates) result = bumpDependencyRangeText(result, u.section, u.name, u.toRange);
  return result;
}

// `npm install`'s own stdout ("up to date, audited N packages...", or far
// more under a real registry install) is sent to OUR OWN STDERR (fd 2),
// never our own stdout -- NOT `stdio: "inherit"` (fix, re-review,
// https://github.com/clossys/foundry/pull/1353#issuecomment-5803894960
// blocking item 2). `main()` below writes `--json` output to stdout with a
// single `console.log(JSON.stringify(...))`; `stdio: "inherit"` let npm's
// own chatter interleave into that SAME stdout stream, so
// `.github/workflows/release-pr.yml`'s `output="$(node ... --json)"; ...
// JSON.parse(process.argv[1])` (and this repository's own two callers of
// that pattern) throw on every release that actually has something to
// apply -- already true on `main`, reproduced with the workflow's own
// exact shell pattern. npm's stderr still goes to our stderr, so nothing
// about a real failure gets silently swallowed; only stdout stays pure
// JSON.
const defaultRunNpmInstall = (root) => execFileSync("npm", ["install", "--package-lock-only"], { cwd: root, stdio: ["ignore", 2, 2] });

// Every packages/<dir> directory that has its own package.json, sorted --
// deterministic order for both the dependency scan and any resulting
// dependent-only bumps.
function discoverWorkspacePackageDirs(root) {
  const packagesDir = join(root, "packages");
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(packagesDir, name, "package.json")))
    .sort();
}

// Pure-ish core: computes and (unless dryRun) applies every bump. Returns
// `{ applied, findings }` -- `applied` is one entry per package this run
// changed (`{ package, fromVersion, toVersion, bump, outOfBand, breaking,
// breakingSummaries, changesetFiles, dependencyUpdates? }`;
// `dependencyUpdates` is present only when this package's own manifest also
// had a sibling dependency range rewritten -- see this file's own header).
// `findings` is one string per package that could not be applied (unknown
// package directory, unreadable manifest, non-semver current version, an
// unrewritable manifest or dependency-range shape, a dependency range this
// script refuses to touch, or -- under `outOfBandOnly` -- a bump level an
// out-of-band release is not allowed to ship). `runNpmInstall` is
// injectable so tests never need a real npm/network round trip. `outOfBand`
// on an applied entry is true when at least one consumed changeset was
// flagged `release: out-of-band` -- purely informational here (it does not
// change how the version is computed); .github/workflows/release-pr.yml
// reads it to decide whether to label the resulting pull request
// `release:out-of-band` so it can land outside the merge window. See this
// file's own header, "COMPOSING OUT-OF-BAND FILTERING WITH SIBLING
// DEPENDENCY RANGES", for exactly how `outOfBandOnly` interacts with the
// sibling-range phases below.
export function applyReleaseChangesets({
  root = process.cwd(),
  dryRun = false,
  runNpmInstall = defaultRunNpmInstall,
  today = () => new Date().toISOString().slice(0, 10),
  outOfBandOnly = false,
} = {}) {
  const { entries: allEntries, findings: changesetFindings } = loadChangesets(root);
  if (changesetFindings.length > 0) {
    return { applied: [], findings: [], changesetFindings };
  }
  // OUT-OF-BAND FILTERING RUNS FIRST, AND DECIDES THE RELEASED SET -- see
  // this file's header, item 1. `entries` is what every phase below sees;
  // a changeset filtered out here is invisible to namedPackages(), to PHASE
  // A, and (transitively, since PHASE B only reacts to what PHASE A
  // bumped) to PHASE B's sibling-range scan too.
  const entries = outOfBandOnly ? allEntries.filter((e) => e.outOfBand === true) : allEntries;
  if (entries.length === 0) {
    // No pending changesets anywhere (or, under --out-of-band, no pending
    // out-of-band changesets) -- nothing is bumped, and nothing downstream
    // (governance/release-calendar.json included) is even read. See this
    // file's own header for why this is load-bearing, not incidental: it
    // is what keeps a quiet week from opening an empty release PR.
    return { applied: [], findings: [], changesetFindings: [] };
  }

  // Three sub-phases, all before a single byte is written -- the same
  // "all-or-nothing" plan-then-write shape issue #1322 established: PHASE A
  // validates and computes the bump level for every package the (already
  // out-of-band-filtered) `entries` set actually NAMES; PHASE B, only
  // reachable once every named package has passed, scans EVERY workspace
  // package (named or not) for a stale dependency range onto one of PHASE
  // A's bumps; PHASE C, only reachable once PHASE B has found nothing it
  // cannot safely rewrite, computes the final manifest/CHANGELOG text for
  // every package either phase touched. Only once ALL THREE have passed
  // does the write phase run at all -- a single-pass write-as-you-go loop
  // that stopped partway through a later package's failure would leave
  // EARLIER packages' package.json/changelog already written on disk
  // with their changesets not yet deleted, so a rerun after fixing the
  // failure would re-bump and duplicate those earlier packages' entries
  // (issue #1322 item 1) -- and splitting the dependency-range rewrite into
  // its own later phase, still gated behind the very same write phase,
  // extends that same guarantee to issue #1332's sibling rewrites rather
  // than introducing a second, independent all-or-nothing boundary.
  const findings = [];

  // ---------------------------------------------------------- PHASE A
  const namedPlans = []; // { pkg, manifestPath, manifestText, manifest, newVersion, bump, outOfBand, breakingBullets, ownBullets, changesetFiles, changelogPath }

  for (const pkg of namedPackages(entries)) {
    const matches = changesetsForPackage(entries, pkg);
    const bump = highestBumpLevel(matches.map((m) => m.bump));
    const outOfBand = matches.some((m) => m.outOfBand);
    const ownerApprovedMinor = matches.some((m) => m.ownerApprovedLevel === "minor");
    const breakingBullets = matches.filter((m) => m.bump === "major").map((m) => m.summary);

    if (outOfBandOnly) {
      // Defense in depth -- see this file's header. Not covered by an
      // end-to-end test through the normal .changesets/ file surface
      // because scripts/collect-changesets.mjs already makes it
      // unreachable that way (it enforces the identical patch/owner-
      // approved-minor rule per file, before this script ever groups
      // matches across files); this refuses rather than silently ships an
      // unapproved bump through the out-of-band path if that invariant is
      // ever weakened. `major` is never allowed, with or without owner
      // approval -- there is no bump level this branch treats as escalating
      // past `minor`. This gate applies ONLY to a NAMED package's own bump
      // level -- a dependent-only patch bump (PHASE B/C below) is always
      // `patch` and is exempt, per this file's header item 3.
      const allowed = bump === "patch" || (bump === "minor" && ownerApprovedMinor);
      if (!allowed) {
        const reason = bump === "minor" ? 'a "minor" out-of-band bump needs a consumed changeset carrying "owner-approved: minor"' : `an out-of-band release must be "patch" (or owner-approved "minor"), not "${bump}"`;
        findings.push(`packages/${pkg}: ${reason} -- consumed changeset(s) ${matches.map((m) => m.file).join(", ")}`);
        continue;
      }
    }

    const pkgDir = resolve(root, "packages", pkg);
    const manifestPath = join(pkgDir, "package.json");
    if (!existsSync(manifestPath)) {
      findings.push(`packages/${pkg}/package.json does not exist, but a changeset names "${pkg}"`);
      continue;
    }
    let manifestText, manifest;
    try {
      manifestText = readFileSync(manifestPath, "utf8");
      manifest = JSON.parse(manifestText);
    } catch (error) {
      findings.push(`packages/${pkg}/package.json is not valid JSON: ${errorMessage(error)}`);
      continue;
    }
    let newVersion;
    try {
      newVersion = bumpVersion(manifest.version, bump);
    } catch (error) {
      findings.push(`packages/${pkg}: ${errorMessage(error)}`);
      continue;
    }

    namedPlans.push({
      pkg,
      manifestPath,
      manifestText,
      manifest,
      newVersion,
      bump,
      outOfBand,
      breakingBullets,
      ownBullets: matches.map((m) => m.summary),
      changesetFiles: matches.map((m) => m.file),
      changelogPath: changelogPathFor(root, pkg),
    });
  }

  if (findings.length > 0) return { applied: [], findings, changesetFindings: [] };

  // ---------------------------------------------------------- PHASE B
  // SIBLING RANGE REWRITES ARE COMPUTED ONLY AGAINST RELEASED PACKAGES --
  // see this file's header, item 2. `bumpedVersions` STARTS OUT built
  // EXCLUSIVELY from `namedPlans`, which itself only ever contains packages
  // the (already out-of-band-filtered) `entries` set named and PHASE A
  // accepted. A package filtered out above (or one that failed PHASE A)
  // can never appear here, so a dependent can never be rewritten to point
  // at a version this run does not actually publish. It then GROWS as this
  // phase discovers dependent-only bumps -- see the fixed-point loop below
  // (issue #1377).
  const bumpedVersions = {};
  for (const p of namedPlans) bumpedVersions[p.manifest.name] = p.newVersion;

  const namedPlanByDir = new Map(namedPlans.map((p) => [p.pkg, p]));
  const workspaceDirs = discoverWorkspacePackageDirs(root);

  // A FIXED POINT OVER DEPENDENT-ONLY BUMPS (issue #1377)
  // -----------------------------------------------------------------------
  // A single pass over `workspaceDirs` only ever checks a sibling's range
  // against `bumpedVersions` as PHASE A left it: a dependent-only patch
  // bump THIS pass produces was never fed back in, so a THIRD package
  // depending on a dependent-only-bumped package via an exact pin (or any
  // range a one-step patch bump does not already cover) was left stale.
  // This scans to a FIXED POINT instead: every round rescans every
  // workspace package's ORIGINAL manifest text against the CURRENT
  // `bumpedVersions`; a round that proves a brand-new dependent-only bump
  // grows `bumpedVersions` (so the NEXT round can see it) and the loop
  // runs again; a round that proves nothing new ends it. Each package's
  // own manifest is read at most once (`manifestInfoFor()` below, cached)
  // -- every round re-evaluates the SAME original text, never a
  // previously-rewritten one, so a dependent-only bump decided in an
  // earlier round is never double-applied: a dir that already has one
  // (`dependentOnlyVersionByDir`) is never bumped a second time, it only
  // ever accumulates MORE range-rewrite entries if a later round finds it
  // also depends on something bumped after its own round (`updatesByDir`/
  // `devUpdatesByDir`, keyed by section+name so rediscovering the identical
  // update in a later round is a harmless no-op, not a duplicate).
  const manifestInfoByDir = new Map(); // dir -> { manifestText, manifest } | null (null = unreadable, already a finding)
  function manifestInfoFor(dir) {
    if (manifestInfoByDir.has(dir)) return manifestInfoByDir.get(dir);
    const namedPlan = namedPlanByDir.get(dir);
    let info;
    if (namedPlan) {
      info = { manifestText: namedPlan.manifestText, manifest: namedPlan.manifest };
    } else {
      try {
        const manifestText = readFileSync(join(root, "packages", dir, "package.json"), "utf8");
        info = { manifestText, manifest: JSON.parse(manifestText) };
      } catch (error) {
        findings.push(`packages/${dir}/package.json is not valid JSON: ${errorMessage(error)}`);
        info = null;
      }
    }
    manifestInfoByDir.set(dir, info);
    return info;
  }

  const updateKey = (u) => `${u.section}\u0000${u.name}`;
  const updatesByDir = new Map(); // dir -> Map(updateKey -> update)  (dependencies/peerDependencies/optionalDependencies)
  const devUpdatesByDir = new Map(); // dir -> Map(updateKey -> update)  (devDependencies)
  const dependentOnlyVersionByDir = new Map(); // dir -> newVersion, assigned exactly once, the round its FIRST real update is found

  // Safety bound, per issue #1377's own suggested fix: a cycle should be
  // structurally impossible (a range can never resolve to a version of the
  // package that declares it), and at most one NEW package can be proven
  // bumped per round, so `workspaceDirs.length` rounds is already generous
  // -- this fails closed with a finding rather than loop indefinitely if
  // that assumption is ever wrong.
  const MAX_ROUNDS = workspaceDirs.length + 1;
  let round = 0;
  let grew = true;
  while (grew) {
    round += 1;
    if (round > MAX_ROUNDS) {
      findings.push(`apply-release-changesets: sibling dependency-range fixed point did not converge within ${MAX_ROUNDS} round(s) -- refusing rather than loop indefinitely`);
      break;
    }
    grew = false;

    for (const dir of workspaceDirs) {
      const info = manifestInfoFor(dir);
      if (!info) continue; // unreadable manifest -- already a finding

      const { updates, errors } = collectDependencyUpdates(`packages/${dir}/package.json`, info.manifest, bumpedVersions);
      const { updates: devUpdates, errors: devErrors } = collectDependencyUpdates(`packages/${dir}/package.json`, info.manifest, bumpedVersions, DEV_DEPENDENCY_RANGE_SECTIONS);
      if (errors.length > 0 || devErrors.length > 0) {
        findings.push(...errors, ...devErrors);
        continue;
      }
      if (updates.length === 0 && devUpdates.length === 0) continue;

      if (updates.length > 0) {
        const dirUpdates = updatesByDir.get(dir) ?? new Map();
        for (const u of updates) dirUpdates.set(updateKey(u), u);
        updatesByDir.set(dir, dirUpdates);
      }
      if (devUpdates.length > 0) {
        const dirDevUpdates = devUpdatesByDir.get(dir) ?? new Map();
        for (const u of devUpdates) dirDevUpdates.set(updateKey(u), u);
        devUpdatesByDir.set(dir, dirDevUpdates);
      }

      // A DEPENDENT-ONLY PATCH BUMP COUNTS AS IN-BAND, ALWAYS -- see this
      // file's header, item 3. No `outOfBandOnly` check here: this bump is
      // unconditionally `"patch"`, the same level an out-of-band run's own
      // default already permits, so it can never violate the out-of-band
      // level gate PHASE A enforces above, and it happens the same way on
      // every run regardless of `outOfBandOnly`. Assigned exactly once per
      // dir -- a named package (already bumped by PHASE A) never reaches
      // this branch at all, and a dir that already has a dependent-only
      // version from an earlier round is skipped here (it only gained MORE
      // update entries above, not a second bump).
      if (!namedPlanByDir.has(dir) && updates.length > 0 && !dependentOnlyVersionByDir.has(dir)) {
        let newVersion;
        try {
          newVersion = bumpVersion(info.manifest.version, "patch");
        } catch (error) {
          findings.push(`packages/${dir}: ${errorMessage(error)}`);
          continue;
        }
        dependentOnlyVersionByDir.set(dir, newVersion);
        bumpedVersions[info.manifest.name] = newVersion; // visible to the REST of this round, and every round after it
        grew = true; // a later round may now find a THIRD-level dependent on THIS new version
      }
    }

    // Same fail-closed contract as PHASE A/C -- a finding during scanning
    // stops the run; no further round can make a finding go away.
    if (findings.length > 0) break;
  }

  if (findings.length > 0) return { applied: [], findings, changesetFindings: [] };

  const namedExtraUpdates = new Map(); // pkg -> updates[] (dependencies/peerDependencies/optionalDependencies)
  const namedExtraDevUpdates = new Map(); // pkg -> updates[] (devDependencies)
  const dependentOnlyPlans = []; // { pkg, manifestPath, manifestText, manifest, newVersion, updates, devUpdates }
  const devDependencyOnlyPlans = []; // { pkg, manifestPath, manifestText, manifest, updates } -- devDependencies rewrite, no bump; see this file's header

  for (const dir of workspaceDirs) {
    const info = manifestInfoByDir.get(dir);
    if (!info) continue; // unreadable manifest -- already a finding, and findings.length === 0 was just proven above, so this cannot actually happen; guarded anyway

    const updates = [...(updatesByDir.get(dir)?.values() ?? [])];
    const devUpdates = [...(devUpdatesByDir.get(dir)?.values() ?? [])];
    if (updates.length === 0 && devUpdates.length === 0) continue;

    const manifestPath = join(root, "packages", dir, "package.json");

    if (namedPlanByDir.has(dir)) {
      if (updates.length > 0) namedExtraUpdates.set(dir, updates);
      if (devUpdates.length > 0) namedExtraDevUpdates.set(dir, devUpdates);
      continue;
    }

    const newVersion = dependentOnlyVersionByDir.get(dir);
    if (newVersion) {
      dependentOnlyPlans.push({ pkg: dir, manifestPath, manifestText: info.manifestText, manifest: info.manifest, newVersion, updates, devUpdates });
    } else {
      // DEVDEPENDENCIES-ONLY: never triggers a dependent bump -- see this
      // file's header, "devDependencies IS SCANNED AND REWRITTEN TOO, BUT
      // NEVER TRIGGERS ITS OWN DEPENDENT BUMP". Written silently, with no
      // version change and no CHANGELOG entry, in PHASE C below.
      devDependencyOnlyPlans.push({ pkg: dir, manifestPath, manifestText: info.manifestText, manifest: info.manifest, updates: devUpdates });
    }
  }

  // ---------------------------------------------------------- PHASE C
  const applied = [];
  const planned = []; // { manifestPath, newManifestText, changelogPath, newChangelog, changesetFiles }

  for (const p of namedPlans) {
    const updates = namedExtraUpdates.get(p.pkg) ?? [];
    const devUpdates = namedExtraDevUpdates.get(p.pkg) ?? [];
    let newManifestText;
    try {
      // #1327: bumpManifestText() throws on a manifest whose "version"
      // field this script cannot safely locate exactly once -- caught
      // here, same as bumpVersion() above, so it becomes a finding rather
      // than an uncaught exception.
      newManifestText = bumpManifestText(p.manifestText, p.newVersion);
      newManifestText = applyDependencyRewrites(newManifestText, [...updates, ...devUpdates]);
    } catch (error) {
      findings.push(`packages/${p.pkg}: ${errorMessage(error)}`);
      continue;
    }
    // devUpdates deliberately do NOT contribute a CHANGELOG bullet --
    // devDependencies is never published/consumer-facing, see this file's
    // own header.
    const bullets = [...p.ownBullets, ...dependencyUpdateBullets(updates)];
    const existingChangelog = existsSync(p.changelogPath) ? readFileSync(p.changelogPath, "utf8") : null;
    const newChangelog = prependChangelogEntry(existingChangelog, { version: p.newVersion, date: today(), bullets, breakingBullets: p.breakingBullets });

    planned.push({ manifestPath: p.manifestPath, newManifestText, changelogPath: p.changelogPath, newChangelog, changesetFiles: p.changesetFiles });
    const appliedEntry = {
      package: p.pkg,
      fromVersion: p.manifest.version,
      toVersion: p.newVersion,
      bump: p.bump,
      outOfBand: p.outOfBand,
      breaking: p.breakingBullets.length > 0,
      breakingSummaries: p.breakingBullets,
      changesetFiles: p.changesetFiles,
      changelog: changelogRelPath(p.pkg),
    };
    // `dependencyUpdates` carries BOTH kinds, for full transparency in the
    // JSON output -- only the non-dev ones ever produced a CHANGELOG
    // bullet above.
    if (updates.length > 0 || devUpdates.length > 0) appliedEntry.dependencyUpdates = [...updates, ...devUpdates];
    applied.push(appliedEntry);
  }

  for (const d of dependentOnlyPlans) {
    let newManifestText;
    try {
      newManifestText = bumpManifestText(d.manifestText, d.newVersion);
      newManifestText = applyDependencyRewrites(newManifestText, [...d.updates, ...d.devUpdates]);
    } catch (error) {
      findings.push(`packages/${d.pkg}: ${errorMessage(error)}`);
      continue;
    }
    const changelogPath = changelogPathFor(root, d.pkg);
    const existingChangelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : null;
    // devUpdates deliberately do NOT contribute a CHANGELOG bullet -- same
    // reasoning as the named-package path just above.
    const newChangelog = prependChangelogEntry(existingChangelog, { version: d.newVersion, date: today(), bullets: dependencyUpdateBullets(d.updates) });

    planned.push({ manifestPath: d.manifestPath, newManifestText, changelogPath, newChangelog, changesetFiles: [] });
    // outOfBand/breaking are always false here -- see this file's header,
    // item 3: a dependent-only bump never consumes an out-of-band-flagged
    // changeset (it consumes none at all), and it can never be breaking
    // (breaking is major-only; this bump is always patch).
    applied.push({
      package: d.pkg,
      fromVersion: d.manifest.version,
      toVersion: d.newVersion,
      bump: "patch",
      outOfBand: false,
      breaking: false,
      breakingSummaries: [],
      changesetFiles: [],
      dependencyUpdates: [...d.updates, ...d.devUpdates],
      changelog: changelogRelPath(d.pkg),
    });
  }

  // DEVDEPENDENCIES-ONLY: rewritten silently -- no version bump, no
  // CHANGELOG entry, no `applied` entry of its own (there is no "bump" to
  // report; see this file's own header). Still goes through the identical
  // all-or-nothing `planned`/write-phase machinery as everything else, so
  // a failure here still leaves nothing written, same as any other finding.
  for (const d of devDependencyOnlyPlans) {
    let newManifestText;
    try {
      newManifestText = applyDependencyRewrites(d.manifestText, d.updates);
    } catch (error) {
      findings.push(`packages/${d.pkg}: ${errorMessage(error)}`);
      continue;
    }
    planned.push({ manifestPath: d.manifestPath, newManifestText, changelogPath: null, newChangelog: null, changesetFiles: [] });
  }

  if (findings.length > 0) return { applied: [], findings, changesetFindings: [] };

  if (!dryRun) {
    // Every package validated: write phase. No step here can fail on a
    // per-package basis any more -- every check that could reject a
    // package already ran above, during planning.
    //
    // A CHANGESET NAMING SEVERAL PACKAGES IS DELETED ONCE, NOT ONCE PER
    // PACKAGE (re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726)
    // -----------------------------------------------------------------------
    // collect-changesets.mjs's own documented shape (see its header,
    // "controller: minor" / "writer: patch" in the SAME file) lets one
    // changeset name several packages. Each named package gets its own
    // `planned` step, and each of those steps carries that SAME shared
    // file in its own `changesetFiles` -- so a naive "delete every step's
    // own changesetFiles" loop deletes the identical file more than once,
    // and the second `rmSync` throws `ENOENT` AFTER every manifest and
    // CHANGELOG has already been written, breaking the all-or-nothing
    // contract this whole PHASE C exists to guarantee. #1316's own
    // producer (348e385b) got this right with a `Set` (`toDelete`) that
    // collects every step's changeset files before deleting anything;
    // #1338's later per-step rewrite of the write phase (needed for its
    // own all-or-nothing planning, see the write phase's own comment
    // above) dropped that dedupe. Restoring it here, inside #1338's
    // phases, fixes both: still all-or-nothing, and a shared file is
    // deleted exactly once.
    const toDelete = new Set();

    // THE MANIFEST/CHANGELOG WRITES ARE ATOMIC AGAINST AN NPM FAILURE
    // (issue #1390, fix -- was previously documented here as a known,
    // unfixed local-recovery trap)
    // -----------------------------------------------------------------------
    // `runNpmInstall()` shells out to real npm and can genuinely fail
    // (network, registry, a locally-broken npm) -- `execFileSync` throws on
    // a non-zero exit. Before this fix, that throw propagated straight out
    // of this function with every manifest/CHANGELOG it already wrote still
    // on disk: CI simply retries the whole job from a clean checkout, so
    // this was invisible there, but a developer running this script by hand
    // after a transient failure would see the manifests already bumped,
    // rerun without noticing, and get every affected package double-bumped
    // (two consecutive CHANGELOG entries, the version bumped twice) --
    // `.changesets/` staying untouched on failure (deliberate, see below)
    // did not help, because the SAME still-pending changesets re-plan
    // against the ALREADY-bumped manifests on a naive rerun.
    // `backupFile()`/`restoreBackups()` capture each file's PRE-WRITE state
    // (its exact prior text, or "did not exist yet") before this loop
    // writes anything, so a failure anywhere in the write phase -- a write
    // itself, or `runNpmInstall()` -- restores every file this run touched
    // to exactly what it was, and the thrown error is then RE-THROWN
    // unchanged: the failure is still visible to the caller (nothing here
    // papers over a real npm/network problem), it just no longer leaves the
    // working tree in a state a plain rerun would double-bump.
    const backups = []; // { path, existed, text }
    function backupFile(path) {
      const existed = existsSync(path);
      backups.push({ path, existed, text: existed ? readFileSync(path, "utf8") : null });
    }
    function restoreBackups() {
      for (const b of backups) {
        if (b.existed) writeFileSync(b.path, b.text);
        else rmSync(b.path, { force: true });
      }
    }

    try {
      for (const step of planned) {
        backupFile(step.manifestPath);
        writeFileSync(step.manifestPath, step.newManifestText);
        // A devDependencies-only step (see devDependencyOnlyPlans above) has
        // no changelogPath at all -- no version bump, nothing to log.
        if (step.changelogPath) {
          // docs/changelogs/ may not exist yet in a fresh checkout or
          // fixture; the changelog for a first release is created, never
          // skipped.
          backupFile(step.changelogPath);
          mkdirSync(dirname(step.changelogPath), { recursive: true });
          writeFileSync(step.changelogPath, step.newChangelog);
        }
        for (const file of step.changesetFiles) toDelete.add(file);
      }
      // npm RUNS BEFORE CHANGESETS ARE DELETED (should-fix, re-review,
      // https://github.com/clossys/foundry/pull/1353#issuecomment-5803894960)
      // -----------------------------------------------------------------------
      // Deleting the changesets BEFORE this possible failure would leave
      // every one of them gone from `.changesets/` with `package-lock.json`
      // never actually regenerated -- a rerun (this repository's own local
      // recovery path; CI is ephemeral and simply retries the whole job)
      // would then see NOTHING pending for these packages and silently do
      // nothing, even though the manifests were bumped without a matching
      // lockfile. Deleting them AFTER a successful npm run means a failure
      // instead leaves the changesets still present -- combined with the
      // rollback above, a rerun after a failure now sees EXACTLY the
      // pre-run state (unbumped manifests, untouched changelogs, the same
      // pending changesets) and re-plans cleanly, with no double bump.
      if (applied.length > 0) runNpmInstall(root);
    } catch (error) {
      restoreBackups();
      throw error;
    }
    for (const file of toDelete) rmSync(join(root, ".changesets", file));
  }

  return { applied, findings: [], changesetFindings: [] };
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const dryRun = argv.includes("--dry-run");
  const outOfBandOnly = argv.includes("--out-of-band");
  const root = process.cwd();

  const { applied, findings, changesetFindings } = applyReleaseChangesets({ root, dryRun, outOfBandOnly });

  if (changesetFindings.length > 0) {
    if (json) console.log(JSON.stringify({ error: "malformed changesets", changesetFindings }, null, 2));
    else {
      console.error("apply-release-changesets: refusing to run -- .changesets/ has malformed file(s); run `node scripts/collect-changesets.mjs` for detail:");
      for (const f of changesetFindings) console.error(`  ${f.file} -- ${f.message}`);
    }
    process.exit(2);
  }

  if (findings.length > 0) {
    if (json) console.log(JSON.stringify({ applied, findings }, null, 2));
    else {
      console.error("apply-release-changesets: could not apply every changeset:");
      for (const f of findings) console.error(`  ${f}`);
    }
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify({ applied, dryRun }, null, 2));
  } else if (applied.length === 0) {
    console.log("apply-release-changesets: no pending changesets -- nothing to apply.");
  } else {
    console.log(`apply-release-changesets: ${dryRun ? "would apply" : "applied"} ${applied.length} package bump(s):`);
    for (const a of applied) {
      const consuming = a.changesetFiles.length > 0 ? a.changesetFiles.join(", ") : "(no changeset -- sibling dependency update only)";
      const flags = [a.breaking ? "BREAKING" : null, a.outOfBand ? "out-of-band" : null].filter(Boolean).join(", ");
      console.log(`  ${a.package}: ${a.fromVersion} -> ${a.toVersion} (${a.bump}${flags ? `, ${flags}` : ""}), consuming ${consuming}`);
      console.log(`    changelog entry: ${a.changelog}`);
      for (const u of a.dependencyUpdates ?? []) {
        console.log(`    dependency ${u.name} (${u.section}): ${u.fromRange} -> ${u.toRange}`);
      }
    }
    if (!dryRun) console.log("Regenerated package-lock.json and deleted the applied changesets.");
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
