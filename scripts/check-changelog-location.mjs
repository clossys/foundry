#!/usr/bin/env node
// check-changelog-location — every package's changelog lives in this public
// repository at docs/changelogs/<dir>.md, and none ships in a tarball.
//
//   node scripts/check-changelog-location.mjs [--json] [<repoRoot>]
//
// Exit 0 = every packages/<dir> passes all five rules below.
// Exit 1 = at least one rule failed for at least one package.
// Exit 2 = the question could not be answered (no packages/ directory, no
//          package found, or an unreadable or unparsable manifest).
//
// WHY THE CHANGELOG IS NOT IN THE TARBALL
// ---------------------------------------
// A file inside the tarball can never be corrected after publish; every edit
// to one is a packed-content change release readiness demands a changeset
// for; and every edit moves the packages/<dir> git tree hash a qualification
// record binds to. So a one-word correction to a release note used to cost a
// release. Kept at docs/changelogs/<dir>.md instead, a correction is an
// ordinary docs edit. scripts/lib/changelog-location.mjs holds the location;
// this gate holds the layout to it.
//
// THE FIVE RULES, per packages/<dir> with a package.json
// -------------------------------------------------------
//   1. docs/changelogs/<dir>.md exists. The changelog used to be required
//      in the tarball (docs/PUBLISHING.md section 4); the requirement moved
//      with the file rather than disappearing.
//   2. It has an entry heading for the manifest's current version
//      ("## <version>" or "## [<version>] ...", with or without a leading
//      "v" -- the same heading shape scripts/check-release-pr-shape.mjs
//      reads), so a version cannot be current with no release notes.
//   3. packages/<dir>/ holds no changelog of its own (CHANGELOG, CHANGELOG.md,
//      any case). One there would be a second, divergent copy -- and one
//      that ships.
//   4. The manifest's `files` array names no changelog. That is what put the
//      file in the tarball; with rule 3 it is what keeps one out.
//   5. packages/<dir>/README.md links to the changelog by its absolute public
//      URL, derived from the manifest's own `repository` field
//      (https://github.com/<owner>/<repo>/blob/main/docs/changelogs/<dir>.md).
//      The README ships; the changelog does not; the link is how a reader of
//      the installed package finds it. Not applied to a `private: true`
//      package, which is never installed; rules 1-4 still are.
//
// WHAT THIS DOES NOT CHECK
// ------------------------
// The changelog's CONTENT beyond rule 2's heading. The release PR's own
// entries are proven byte for byte by scripts/lib/release-pr-footprint.mjs;
// public safety and contamination are proven by check-public-safety.mjs (it
// walks docs/) and check-contamination-classes.mjs (it scans
// docs/changelogs/<dir>.md along with packages/<dir>).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { changelogPath, changelogPublicUrl, changelogRelPath } from "./lib/changelog-location.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

// A changelog by file name, the way npm's own `files` matching and a reader
// would recognise one: CHANGELOG or CHANGELOG.<ext>, any case.
const CHANGELOG_NAME_RE = /^changelog(?:\.[a-z0-9]+)?$/i;

function hasVersionHeading(text, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^##\\s*\\[?v?${escaped}\\]?(\\s|$)`, "m").test(text);
}

// Does a `files` entry name a changelog? Matched on the entry's last path
// segment, ignoring a leading "!" (an exclusion is fine -- it keeps one out)
// and a trailing "/".
function filesEntryNamesChangelog(entry) {
  if (typeof entry !== "string" || entry.startsWith("!")) return false;
  const last = entry.replace(/\/+$/, "").split("/").pop() ?? "";
  return CHANGELOG_NAME_RE.test(last);
}

export function evaluateChangelogLocation(root) {
  const rootAbs = resolve(root);
  const packagesDir = join(rootAbs, "packages");
  if (!existsSync(packagesDir)) throw new Error(`no packages/ directory under ${rootAbs}`);
  const dirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, "package.json")))
    .map((entry) => entry.name)
    .sort();
  if (dirs.length === 0) throw new Error(`found no packages under ${packagesDir} -- refusing to report a clean pass on an empty scan`);

  const findings = [];
  const checked = [];
  for (const dir of dirs) {
    const pkgDir = join(packagesDir, dir);
    const manifestPath = join(pkgDir, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(`cannot parse packages/${dir}/package.json: ${error instanceof Error ? error.message : String(error)}`);
    }
    const rel = changelogRelPath(dir);
    const fail = (rule, message) => findings.push({ package: dir, rule, message });

    const path = changelogPath(rootAbs, dir);
    if (!existsSync(path)) {
      fail("changelog-exists", `${rel} does not exist -- every package's changelog lives there`);
    } else if (typeof manifest.version !== "string") {
      fail("changelog-current-entry", `packages/${dir}/package.json has no string "version" to find in ${rel}`);
    } else if (!hasVersionHeading(readFileSync(path, "utf8"), manifest.version)) {
      fail("changelog-current-entry", `${rel} has no "## ${manifest.version}" entry for the manifest's current version`);
    }

    for (const name of readdirSync(pkgDir)) {
      if (CHANGELOG_NAME_RE.test(name)) {
        fail("no-in-package-changelog", `packages/${dir}/${name} exists -- the changelog lives only at ${rel}, outside the tarball`);
      }
    }

    const files = Array.isArray(manifest.files) ? manifest.files : [];
    for (const entry of files.filter(filesEntryNamesChangelog)) {
      fail("files-excludes-changelog", `packages/${dir}/package.json "files" names "${entry}" -- a changelog must not ship in the tarball`);
    }

    // Rule 5 is about the installed package's reader, so a `private: true`
    // package -- one that never publishes (a fresh scaffold, for one) --
    // has no such reader and no `repository` to derive a link from.
    if (manifest.private !== true) {
      const url = changelogPublicUrl(manifest.repository, dir);
      if (url === null) {
        fail("readme-links-changelog", `packages/${dir}/package.json "repository" is not a GitHub HTTPS URL this gate can derive the changelog link from`);
      } else {
        const readmePath = join(pkgDir, "README.md");
        const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
        if (!readme.includes(url)) fail("readme-links-changelog", `packages/${dir}/README.md does not link to ${url}`);
      }
    }
    checked.push(dir);
  }
  return { checked, findings };
}

export function main(argv) {
  const json = argv.includes("--json");
  const root = argv.find((value) => !value.startsWith("--")) ?? join(scriptDir, "..");
  let result;
  try {
    result = evaluateChangelogLocation(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: message }, null, 2));
    else console.error(`check-changelog-location: ${message}`);
    return 2;
  }
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) console.log(`FAIL ${f.rule} ${f.package} -- ${f.message}`);
    console.log(
      result.findings.length === 0
        ? `CHANGELOG LOCATION -- OK. ${result.checked.length} package(s): each changelog is at docs/changelogs/<dir>.md with a current entry, none ships, and each README links to it.`
        : `CHANGELOG LOCATION -- FAIL. ${result.findings.length} finding(s) across ${result.checked.length} package(s).`,
    );
  }
  return result.findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

