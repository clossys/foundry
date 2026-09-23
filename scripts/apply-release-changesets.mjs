#!/usr/bin/env node
// apply-release-changesets — the release PR command (issue #1255), now
// versioning by the weekly calendar (docs/RELEASING.md, owner decision
// 2026-09-23) rather than by semver bump level.
//
//   node scripts/apply-release-changesets.mjs [--json] [--dry-run]
//
// Reads every pending changeset under .changesets/ (scripts/collect-
// changesets.mjs), groups them by named package, and for each named
// package:
//   - computes its next version from governance/release-calendar.json and
//     the release date (scripts/lib/release-calendar.mjs's
//     computeNextReleaseVersion -- see that module's header for the
//     calver-isoweek scheme and the one-time 0.x.y transition);
//   - prepends a packages/<dir>/CHANGELOG.md entry for the new version,
//     concatenating that package's changeset summaries as bullet points
//     (Keep a Changelog format, matching docs/PUBLISHING.md section 4),
//     with a "Breaking changes" subsection for any consumed changeset whose
//     `level` was `major` -- CalVer no longer encodes breakage in the
//     version itself, so `level` stays as that informational signal;
//   - deletes the changeset files it applied.
// Then regenerates package-lock.json (`npm install --package-lock-only`,
// skipped under --dry-run) so the bumped workspace versions are reflected
// there too.
//
// A package is bumped ONLY if it has a pending changeset -- an unrelated
// active package sits still this week, same as before this scheme existed.
// A package already released this ISO week is bumped a second time (N+1)
// ONLY when at least one of its consumed changesets is flagged
// `release: out-of-band` (governance/release-calendar.json's
// outOfBandPolicy); otherwise that collision is refused as a finding, not
// silently resolved.
//
// Exit 0 = applied cleanly (or nothing was pending). Exit 1 = a package a
// changeset names does not exist, its current version is not a plain
// X.Y.Z, or the calendar refused the requested version (e.g. an
// out-of-band changeset for a package not released this week). Exit 2 =
// at least one changeset under .changesets/ is malformed (fix it before
// running a release -- this script never silently ignores one).
//
// --dry-run prints exactly what would change (every version bump, every
// CHANGELOG entry, every deleted changeset file) without writing or
// deleting anything, and without invoking npm.
//
// scripts/check-release-pr-shape.mjs is what proves, on the resulting pull
// request, that this is the only way an ordinary content pull request's
// version can legitimately move — see that script's own header, and the
// design comment linked below.
//
// Design: https://github.com/clossys/foundry/issues/1255#issuecomment-5790113827
// Weekly calendar / CalVer design: docs/RELEASING.md, refs #1187 #1265 #1266
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { changesetsForPackage, loadChangesets } from "./collect-changesets.mjs";
import { computeNextReleaseVersion, loadReleaseCalendar, zonedDateParts } from "./lib/release-calendar.mjs";

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

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Pure-ish core: computes and (unless dryRun) applies every bump. Returns
// `{ applied, findings }` -- `applied` is one entry per named package
// (`{ package, fromVersion, toVersion, kind, level, outOfBand, breaking,
// changesetFiles }`), `findings` is one string per package that could not
// be applied (unknown package directory, unreadable manifest, non-semver
// current version, or a calendar refusal -- see computeNextReleaseVersion's
// own header). `runNpmInstall` and `now`/`calendar` are injectable so tests
// never need a real npm/network round trip or a real governance/
// release-calendar.json on disk.
export function applyReleaseChangesets({ root = process.cwd(), dryRun = false, runNpmInstall = defaultRunNpmInstall, now = () => new Date(), calendar } = {}) {
  const { entries, findings: changesetFindings } = loadChangesets(root);
  if (changesetFindings.length > 0) {
    return { applied: [], findings: [], changesetFindings };
  }
  if (entries.length === 0) {
    return { applied: [], findings: [], changesetFindings: [] };
  }

  const resolvedCalendar = calendar ?? loadReleaseCalendar(root);
  const releaseDate = now();
  const { year, month, day } = zonedDateParts(releaseDate, resolvedCalendar.timezone);
  const today = `${year}-${pad2(month)}-${pad2(day)}`;

  const applied = [];
  const findings = [];
  const toDelete = new Set();

  for (const pkg of namedPackages(entries)) {
    const matches = changesetsForPackage(entries, pkg);
    const level = matches.map((m) => m.bump).reduce((best, b) => (["patch", "minor", "major"].indexOf(b) > ["patch", "minor", "major"].indexOf(best) ? b : best), "patch");
    const outOfBand = matches.some((m) => m.outOfBand);
    const breakingBullets = matches.filter((m) => m.bump === "major").map((m) => m.summary);

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
    let newVersion, kind;
    try {
      ({ version: newVersion, kind } = computeNextReleaseVersion({ currentVersion: manifest.version, releaseDate, timeZone: resolvedCalendar.timezone, outOfBand }));
    } catch (error) {
      findings.push(`packages/${pkg}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const changelogPath = join(pkgDir, "CHANGELOG.md");
    const existingChangelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : null;
    const newChangelog = prependChangelogEntry(existingChangelog, { version: newVersion, date: today, bullets: matches.map((m) => m.summary), breakingBullets });

    if (!dryRun) {
      writeFileSync(manifestPath, bumpManifestText(manifestText, newVersion));
      writeFileSync(changelogPath, newChangelog);
    }
    for (const m of matches) toDelete.add(m.file);

    applied.push({
      package: pkg,
      fromVersion: manifest.version,
      toVersion: newVersion,
      kind,
      level,
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
  const root = process.cwd();

  let result;
  try {
    result = applyReleaseChangesets({ root, dryRun });
  } catch (error) {
    die(error instanceof Error ? error.message : String(error), 1);
    return;
  }
  const { applied, findings, changesetFindings } = result;

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
      console.log(`  ${a.package}: ${a.fromVersion} -> ${a.toVersion} (${a.kind}${a.breaking ? ", BREAKING" : ""}), consuming ${a.changesetFiles.join(", ")}`);
    }
    if (!dryRun) console.log("Regenerated package-lock.json and deleted the applied changesets.");
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
