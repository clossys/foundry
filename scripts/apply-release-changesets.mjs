#!/usr/bin/env node
// apply-release-changesets — the release PR command (issue #1255).
//
//   node scripts/apply-release-changesets.mjs [--json] [--dry-run]
//
// Reads every pending changeset under .changesets/ (scripts/collect-
// changesets.mjs), groups them by named package, and for each named
// package:
//   - bumps packages/<dir>/package.json's version once, by the HIGHEST
//     bump level any of that package's changesets named;
//   - prepends a packages/<dir>/CHANGELOG.md entry for the new version,
//     concatenating that package's changeset summaries as bullet points
//     (Keep a Changelog format, matching docs/PUBLISHING.md section 4);
//   - deletes the changeset files it applied.
// Then regenerates package-lock.json (`npm install --package-lock-only`,
// skipped under --dry-run) so the bumped workspace versions are reflected
// there too.
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
// scripts/check-release-pr-shape.mjs is what proves, on the resulting pull
// request, that this is the only way an ordinary content pull request's
// version can legitimately move — see that script's own header, and the
// design comment linked below.
//
// Design: https://github.com/clossys/foundry/issues/1255#issuecomment-5790113827
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
export function prependChangelogEntry(existingText, { version, date, bullets }) {
  const entryLines = [`## ${version} - ${date}`, "", ...bullets.map((b) => `- ${b}`), ""];
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
// (`{ package, fromVersion, toVersion, bump, changesetFiles }`), `findings`
// is one string per package that could not be applied (unknown package
// directory, unreadable manifest, non-semver current version). `runNpmInstall`
// is injectable so tests never need a real npm/network round trip.
export function applyReleaseChangesets({ root = process.cwd(), dryRun = false, runNpmInstall = defaultRunNpmInstall, today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const { entries, findings: changesetFindings } = loadChangesets(root);
  if (changesetFindings.length > 0) {
    return { applied: [], findings: [], changesetFindings };
  }
  if (entries.length === 0) {
    return { applied: [], findings: [], changesetFindings: [] };
  }

  // Two phases, deliberately: PLAN every package first, writing nothing;
  // only once every named package has passed does phase two write anything
  // at all. `exit 1` (a finding) has to mean "nothing was applied" -- a
  // single-pass write-as-you-go loop that stops partway through a later
  // package's failure would leave EARLIER packages' package.json/
  // CHANGELOG.md already bumped on disk with their changesets not yet
  // deleted, so a rerun after fixing the failure would re-bump and
  // duplicate those earlier packages' entries (issue #1322 item 1).
  const applied = [];
  const findings = [];
  const planned = [];

  for (const pkg of namedPackages(entries)) {
    const matches = changesetsForPackage(entries, pkg);
    const bump = highestBumpLevel(matches.map((m) => m.bump));
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
    const newChangelog = prependChangelogEntry(existingChangelog, { version: newVersion, date: today(), bullets: matches.map((m) => m.summary) });
    const newManifestText = bumpManifestText(manifestText, newVersion);

    planned.push({ manifestPath, newManifestText, changelogPath, newChangelog, changesetFiles: matches.map((m) => m.file) });
    applied.push({ package: pkg, fromVersion: manifest.version, toVersion: newVersion, bump, changesetFiles: matches.map((m) => m.file) });
  }

  if (findings.length > 0) return { applied: [], findings, changesetFindings: [] };

  if (!dryRun) {
    // Every package validated: write phase. No step here can fail on a
    // per-package basis any more -- every check that could reject a
    // package already ran above, during planning.
    for (const step of planned) {
      writeFileSync(step.manifestPath, step.newManifestText);
      writeFileSync(step.changelogPath, step.newChangelog);
    }
    for (const step of planned) for (const file of step.changesetFiles) rmSync(join(root, ".changesets", file));
    if (applied.length > 0) runNpmInstall(root);
  }

  return { applied, findings: [], changesetFindings: [] };
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const dryRun = argv.includes("--dry-run");
  const root = process.cwd();

  const { applied, findings, changesetFindings } = applyReleaseChangesets({ root, dryRun });

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
      console.log(`  ${a.package}: ${a.fromVersion} -> ${a.toVersion} (${a.bump}), consuming ${a.changesetFiles.join(", ")}`);
    }
    if (!dryRun) console.log("Regenerated package-lock.json and deleted the applied changesets.");
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
