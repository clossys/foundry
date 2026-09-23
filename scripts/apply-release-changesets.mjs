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
// Then, for every OTHER workspace package that depends on a bumped package
// via a range that no longer covers the new version (issue #1332), rewrites
// that dependency's declared range to `^<newVersion>` too, in the SAME
// package.json write -- see "SIBLING DEPENDENCY RANGES" below. Finally
// regenerates package-lock.json (`npm install --package-lock-only`, skipped
// under --dry-run) so every bumped workspace version, and every rewritten
// sibling range, is reflected there too.
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
//     CHANGELOG.md entry whose bullet reads
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
// devDependencies is DELIBERATELY excluded from this scan. npm never reads
// a dependency's OWN devDependencies when resolving it as someone else's
// dependency -- only dependencies/peerDependencies/optionalDependencies
// affect what a consumer (or a sibling's packed manifest) resolves. A
// stale devDependencies range cannot reproduce this issue's actual defect;
// it is at most a within-this-repo development convenience, and
// scripts/check-workspace-links.mjs's own pre-existing sibling-range gate
// already draws the same line (it scans only manifest.dependencies -- see
// that script's evaluateLinks()). Keeping the same scope here means the
// one gate that checks this and the one script that fixes it agree on what
// "a first-party dependency edge" means.
//
// Design: https://github.com/clossys/foundry/issues/1255#issuecomment-5790113827
// Refs: #1322, #1327, #1332.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { changesetsForPackage, highestBumpLevel, loadChangesets } from "./collect-changesets.mjs";
import { parseSemver } from "./check-release-pr-shape.mjs";
import { satisfies } from "./check-workspace-links.mjs";

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

// dependencies/peerDependencies/optionalDependencies -- deliberately NOT
// devDependencies. See this file's own header, "SIBLING DEPENDENCY RANGES",
// last paragraph, for why.
export const DEPENDENCY_RANGE_SECTIONS = ["dependencies", "peerDependencies", "optionalDependencies"];

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
export function collectDependencyUpdates(dependentDescription, manifest, bumpedVersions) {
  const updates = [];
  const errors = [];
  for (const section of DEPENDENCY_RANGE_SECTIONS) {
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

const defaultRunNpmInstall = (root) => execFileSync("npm", ["install", "--package-lock-only"], { cwd: root, stdio: "inherit" });

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
// changed (`{ package, fromVersion, toVersion, bump, changesetFiles,
// dependencyUpdates? }`; `dependencyUpdates` is present only when this
// package's own manifest also had a sibling dependency range rewritten --
// see this file's own header). `findings` is one string per package that
// could not be applied (unknown package directory, unreadable manifest,
// non-semver current version, an unrewritable manifest or dependency-range
// shape, or a dependency range this script refuses to touch). `runNpmInstall`
// is injectable so tests never need a real npm/network round trip.
export function applyReleaseChangesets({ root = process.cwd(), dryRun = false, runNpmInstall = defaultRunNpmInstall, today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const { entries, findings: changesetFindings } = loadChangesets(root);
  if (changesetFindings.length > 0) {
    return { applied: [], findings: [], changesetFindings };
  }
  if (entries.length === 0) {
    return { applied: [], findings: [], changesetFindings: [] };
  }

  // Three sub-phases, all before a single byte is written -- still the
  // same "all-or-nothing" plan-then-write shape issue #1322 established
  // (see that issue's own comment, referenced below): PHASE A validates
  // and computes the bump level for every package a changeset actually
  // NAMES; PHASE B, only reachable once every named package has passed,
  // scans EVERY workspace package (named or not) for a stale dependency
  // range onto one of PHASE A's bumps; PHASE C, only reachable once PHASE
  // B has found nothing it cannot safely rewrite, computes the final
  // manifest/CHANGELOG text for every package either phase touched. Only
  // once ALL THREE have passed does the write phase run at all -- a
  // single-pass write-as-you-go loop that stopped partway through a later
  // package's failure would leave EARLIER packages' package.json/
  // CHANGELOG.md already written on disk with their changesets not yet
  // deleted, so a rerun after fixing the failure would re-bump and
  // duplicate those earlier packages' entries (issue #1322 item 1) -- and
  // splitting the dependency-range rewrite into its own later phase, still
  // gated behind the very same write phase, extends that same guarantee to
  // issue #1332's sibling rewrites rather than introducing a second,
  // independent all-or-nothing boundary.
  const findings = [];

  // ---------------------------------------------------------- PHASE A
  const namedPlans = []; // { pkg, manifestPath, manifestText, manifest, newVersion, bump, ownBullets, changesetFiles, changelogPath }

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
      ownBullets: matches.map((m) => m.summary),
      changesetFiles: matches.map((m) => m.file),
      changelogPath: join(pkgDir, "CHANGELOG.md"),
    });
  }

  if (findings.length > 0) return { applied: [], findings, changesetFindings: [] };

  // ---------------------------------------------------------- PHASE B
  const bumpedVersions = {};
  for (const p of namedPlans) bumpedVersions[p.manifest.name] = p.newVersion;

  const namedPlanByDir = new Map(namedPlans.map((p) => [p.pkg, p]));
  const namedExtraUpdates = new Map(); // pkg -> updates[]
  const dependentOnlyPlans = []; // { pkg, manifestPath, manifestText, manifest, newVersion, updates }

  for (const dir of discoverWorkspacePackageDirs(root)) {
    const namedPlan = namedPlanByDir.get(dir);
    const manifestPath = join(root, "packages", dir, "package.json");

    let manifestText, manifest;
    if (namedPlan) {
      // Scan the ORIGINAL (pre-bump) text: this package's own dependency
      // ranges on OTHER packages are unaffected by its own version bump.
      manifestText = namedPlan.manifestText;
      manifest = namedPlan.manifest;
    } else {
      try {
        manifestText = readFileSync(manifestPath, "utf8");
        manifest = JSON.parse(manifestText);
      } catch (error) {
        findings.push(`packages/${dir}/package.json is not valid JSON: ${errorMessage(error)}`);
        continue;
      }
    }

    const { updates, errors } = collectDependencyUpdates(`packages/${dir}/package.json`, manifest, bumpedVersions);
    if (errors.length > 0) {
      findings.push(...errors);
      continue;
    }
    if (updates.length === 0) continue;

    if (namedPlan) {
      namedExtraUpdates.set(dir, updates);
      continue;
    }

    let newVersion;
    try {
      newVersion = bumpVersion(manifest.version, "patch");
    } catch (error) {
      findings.push(`packages/${dir}: ${errorMessage(error)}`);
      continue;
    }
    dependentOnlyPlans.push({ pkg: dir, manifestPath, manifestText, manifest, newVersion, updates });
  }

  if (findings.length > 0) return { applied: [], findings, changesetFindings: [] };

  // ---------------------------------------------------------- PHASE C
  const applied = [];
  const planned = []; // { manifestPath, newManifestText, changelogPath, newChangelog, changesetFiles }

  for (const p of namedPlans) {
    const updates = namedExtraUpdates.get(p.pkg) ?? [];
    let newManifestText;
    try {
      // #1327: bumpManifestText() throws on a manifest whose "version"
      // field this script cannot safely locate exactly once -- caught
      // here, same as bumpVersion() above, so it becomes a finding rather
      // than an uncaught exception.
      newManifestText = bumpManifestText(p.manifestText, p.newVersion);
      newManifestText = applyDependencyRewrites(newManifestText, updates);
    } catch (error) {
      findings.push(`packages/${p.pkg}: ${errorMessage(error)}`);
      continue;
    }
    const bullets = [...p.ownBullets, ...dependencyUpdateBullets(updates)];
    const existingChangelog = existsSync(p.changelogPath) ? readFileSync(p.changelogPath, "utf8") : null;
    const newChangelog = prependChangelogEntry(existingChangelog, { version: p.newVersion, date: today(), bullets });

    planned.push({ manifestPath: p.manifestPath, newManifestText, changelogPath: p.changelogPath, newChangelog, changesetFiles: p.changesetFiles });
    const appliedEntry = { package: p.pkg, fromVersion: p.manifest.version, toVersion: p.newVersion, bump: p.bump, changesetFiles: p.changesetFiles };
    if (updates.length > 0) appliedEntry.dependencyUpdates = updates;
    applied.push(appliedEntry);
  }

  for (const d of dependentOnlyPlans) {
    let newManifestText;
    try {
      newManifestText = bumpManifestText(d.manifestText, d.newVersion);
      newManifestText = applyDependencyRewrites(newManifestText, d.updates);
    } catch (error) {
      findings.push(`packages/${d.pkg}: ${errorMessage(error)}`);
      continue;
    }
    const changelogPath = join(root, "packages", d.pkg, "CHANGELOG.md");
    const existingChangelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : null;
    const newChangelog = prependChangelogEntry(existingChangelog, { version: d.newVersion, date: today(), bullets: dependencyUpdateBullets(d.updates) });

    planned.push({ manifestPath: d.manifestPath, newManifestText, changelogPath, newChangelog, changesetFiles: [] });
    applied.push({ package: d.pkg, fromVersion: d.manifest.version, toVersion: d.newVersion, bump: "patch", changesetFiles: [], dependencyUpdates: d.updates });
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
      const consuming = a.changesetFiles.length > 0 ? a.changesetFiles.join(", ") : "(no changeset -- sibling dependency update only)";
      console.log(`  ${a.package}: ${a.fromVersion} -> ${a.toVersion} (${a.bump}), consuming ${consuming}`);
      for (const u of a.dependencyUpdates ?? []) {
        console.log(`    dependency ${u.name} (${u.section}): ${u.fromRange} -> ${u.toRange}`);
      }
    }
    if (!dryRun) console.log("Regenerated package-lock.json and deleted the applied changesets.");
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
