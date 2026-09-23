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
//   - prepends a packages/<dir>/CHANGELOG.md entry for the new version,
//     concatenating that package's changeset summaries as bullet points
//     (Keep a Changelog format, matching docs/PUBLISHING.md section 4),
//     with a "Breaking changes" subsection for any consumed changeset
//     whose level was `major`;
//   - deletes the changeset files it applied.
// Then regenerates package-lock.json (`npm install --package-lock-only`,
// skipped under --dry-run) so the bumped workspace versions are reflected
// there too.
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
// changeset names does not exist, or its current version is not a plain
// X.Y.Z. Exit 2 = at least one changeset under .changesets/ is malformed
// (fix it before running a release -- this script never silently ignores
// one).
//
// --dry-run prints exactly what would change (every version bump, every
// CHANGELOG entry, every deleted changeset file) without writing or
// deleting anything, and without invoking npm.
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
// package is not `patch`, or is `minor` without a consumed changeset
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
// Design: https://github.com/clossys/foundry/issues/1255#issuecomment-5790113827
// Weekly calendar design (versioning unchanged): docs/RELEASING.md, refs #1187 #1265 #1266
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { changesetsForPackage, highestBumpLevel, loadChangesets } from "./collect-changesets.mjs";
import { parseSemver } from "./check-release-pr-shape.mjs";

function die(message, code = 1) {
  console.error(`apply-release-changesets: ${message}`);
  process.exit(code);
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
// bump the wrong field or silently do nothing.
export function bumpManifestText(text, newVersion) {
  const re = /^( {2})"version": "[^"]*"/m;
  const matches = text.match(new RegExp(re.source, "gm")) ?? [];
  if (matches.length !== 1) throw new Error(`expected exactly one top-level "version" field, found ${matches.length}`);
  return text.replace(re, `$1"version": "${newVersion}"`);
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
// replacement.
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

const defaultRunNpmInstall = (root) => execFileSync("npm", ["install", "--package-lock-only"], { cwd: root, stdio: "inherit" });

// Pure-ish core: computes and (unless dryRun) applies every bump. Returns
// `{ applied, findings }` -- `applied` is one entry per named package
// (`{ package, fromVersion, toVersion, bump, outOfBand, breaking,
// breakingSummaries, changesetFiles }`), `findings` is one string per
// package that could not be applied (unknown package directory, unreadable
// manifest, non-semver current version). `runNpmInstall` is injectable so
// tests never need a real npm/network round trip. `outOfBand` on an applied
// entry is true when at least one consumed changeset was flagged
// `release: out-of-band` -- purely informational here (it does not change
// how the version is computed); .github/workflows/release-pr.yml reads it
// to decide whether to label the resulting pull request
// `release:out-of-band` so it can land outside the merge window.
export function applyReleaseChangesets({ root = process.cwd(), dryRun = false, runNpmInstall = defaultRunNpmInstall, today = () => new Date().toISOString().slice(0, 10), outOfBandOnly = false } = {}) {
  const { entries: allEntries, findings: changesetFindings } = loadChangesets(root);
  if (changesetFindings.length > 0) {
    return { applied: [], findings: [], changesetFindings };
  }
  // --out-of-band's whole enforcement is this one filter: an out-of-band
  // run never even SEES an ordinary changeset, so it cannot accidentally
  // group one into `namedPackages`/`changesetsForPackage` below -- see this
  // file's header for the full reasoning.
  const entries = outOfBandOnly ? allEntries.filter((e) => e.outOfBand === true) : allEntries;
  if (entries.length === 0) {
    // No pending changesets anywhere (or, under --out-of-band, no pending
    // out-of-band changesets) -- nothing is bumped, and nothing downstream
    // (governance/release-calendar.json included) is even read. See this
    // file's own header for why this is load-bearing, not incidental: it
    // is what keeps a quiet week from opening an empty release PR.
    return { applied: [], findings: [], changesetFindings: [] };
  }

  const applied = [];
  const findings = [];
  const toDelete = new Set();

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
      // past `minor`.
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
      findings.push(`packages/${pkg}/package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    let newVersion;
    try {
      newVersion = bumpVersion(manifest.version, bump);
    } catch (error) {
      findings.push(`packages/${pkg}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const changelogPath = join(pkgDir, "CHANGELOG.md");
    const existingChangelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : null;
    const newChangelog = prependChangelogEntry(existingChangelog, { version: newVersion, date: today(), bullets: matches.map((m) => m.summary), breakingBullets });

    if (!dryRun) {
      writeFileSync(manifestPath, bumpManifestText(manifestText, newVersion));
      writeFileSync(changelogPath, newChangelog);
    }
    for (const m of matches) toDelete.add(m.file);

    applied.push({
      package: pkg,
      fromVersion: manifest.version,
      toVersion: newVersion,
      bump,
      outOfBand,
      breaking: breakingBullets.length > 0,
      breakingSummaries: breakingBullets,
      changesetFiles: matches.map((m) => m.file),
    });
  }

  if (findings.length > 0) return { applied, findings, changesetFindings: [] };

  if (!dryRun) {
    for (const file of toDelete) rmSync(join(root, ".changesets", file));
    if (applied.length > 0) runNpmInstall(root);
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
      console.log(`  ${a.package}: ${a.fromVersion} -> ${a.toVersion} (${a.bump}${a.breaking ? ", BREAKING" : ""}${a.outOfBand ? ", out-of-band" : ""}), consuming ${a.changesetFiles.join(", ")}`);
    }
    if (!dryRun) console.log("Regenerated package-lock.json and deleted the applied changesets.");
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
