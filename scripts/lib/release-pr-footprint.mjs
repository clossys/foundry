// release-pr-footprint — STRUCTURAL (content-level) proof that a set of
// changed files is exactly the shape scripts/apply-release-changesets.mjs's
// release PR produces (second re-review of #1316,
// https://github.com/clossys/foundry/pull/1316#issuecomment-5800566625,
// item 1).
//
// WHY PATH-AND-STATUS ALONE WAS NOT ENOUGH
// -------------------------------------------
// An earlier version of this exemption (scripts/lib/release-calendar.mjs's
// isReleasePrFootprint(), now removed) only checked each changed file's
// PATH and git STATUS (added/removed/modified) -- e.g. "packages/x/
// package.json, modified" passed regardless of WHAT changed inside it. A
// release PR whose package.json also added a dependency, a postinstall
// script, or any other field; whose CHANGELOG.md also rewrote an old
// entry; whose package-lock.json was hand-edited to point at a different
// tarball; or whose .changesets/ deletion was paired with a smuggled-in
// NEW changeset -- all of those passed the old check as long as the PATHS
// looked right. This module replaces "the path looks right" with "the
// CONTENT is exactly what the release PR command would have produced."
//
// WHAT EACH FILE CLASS MUST PROVE
// ----------------------------------
//   packages/<dir>/package.json  -- status "modified"; parsed as JSON on
//     both sides; every key OTHER than "version" is deep-equal (this
//     covers dependencies, scripts, bin, exports, and anything else in one
//     generic check, rather than an enumerated list of "watched" keys);
//     "version" itself must actually have changed.
//   packages/<dir>/CHANGELOG.md  -- status "modified" or "added"; the head
//     text must be the base text with ONE contiguous block of new text
//     INSERTED (isChangelogPurePrepend()) -- nothing in the base text may
//     be removed or altered, and the inserted block must itself open with
//     a "## " heading (a new version section).
//   package-lock.json  -- status "modified". Its CONTENT is not judged
//     file-by-file here (a lockfile is one file covering every package at
//     once, not a per-package unit) -- see verifyLockfileRegeneration()
//     below and this module's own evaluateReleasePrFootprint(), which
//     requires that separate proof whenever a lockfile change is present.
//   .changesets/<slug>.md  -- status "removed" ONLY. A git status of
//     "added" here is exactly "a new changeset smuggled in" and fails
//     immediately -- this module does not need to know what package a
//     changeset named to reject an added one on sight.
//   anything else -- fails outright, regardless of status.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

export const RELEASE_PR_FILE_PATTERNS = {
  packageManifest: /^packages\/([^/]+)\/package\.json$/,
  changelog: /^packages\/([^/]+)\/CHANGELOG\.md$/,
  lockfile: /^package-lock\.json$/,
  changeset: /^\.changesets\/[a-z0-9][a-z0-9-]*\.md$/,
};

// Deep-equal via a canonical (keys sorted, recursively) JSON string --
// good enough for package.json's plain-data shape (no functions, no
// cycles, no Dates) and immune to key-order noise a formatter might
// introduce.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Is the ONLY difference between these two package.json texts the
 * top-level "version" field? Parses both as JSON (a parse failure on
 * either side is itself a failure -- this proves nothing about malformed
 * input), strips "version" from each, and requires the rest to be
 * deep-equal. Also requires "version" to have actually changed -- a
 * no-op "change" is not a release PR either.
 */
export function isPackageManifestVersionOnlyChange(baseText, headText) {
  let baseJson, headJson;
  try {
    baseJson = JSON.parse(baseText);
  } catch {
    return false;
  }
  try {
    headJson = JSON.parse(headText);
  } catch {
    return false;
  }
  if (!baseJson || typeof baseJson !== "object" || !headJson || typeof headJson !== "object") return false;
  const { version: baseVersion, ...baseRest } = baseJson;
  const { version: headVersion, ...headRest } = headJson;
  if (baseVersion === headVersion) return false;
  if (typeof headVersion !== "string" || headVersion.length === 0) return false;
  return canonicalJson(baseRest) === canonicalJson(headRest);
}

/**
 * Is `headText` exactly `baseText` with ONE contiguous, non-empty block of
 * new text inserted somewhere -- nothing from `baseText` removed, nothing
 * altered? `baseText` may be `null`/`undefined` for a brand-new
 * CHANGELOG.md (git status "added"), treated as empty.
 *
 * THE SPLIT POINT IS A RANGE, NOT A SINGLE GREEDY GUESS
 * ---------------------------------------------------------
 * The naive version of this check -- take the longest common prefix, take
 * the longest common suffix, require they cover all of `baseText` between
 * them -- is not safe on its own: a real changelog's OLD and NEW entries
 * routinely share a run of identical characters right at the boundary
 * (e.g. inserting "## 1.0.1" directly above an existing "## 1.0.0" shares
 * the literal text "## 1.0." across both), which makes a single greedy
 * prefix walk overshoot PAST the true insertion point and misread the
 * split. Instead: compute the longest common prefix length and the
 * longest common suffix length independently (each bounded only by
 * `baseText`'s own length); every insertion point `i` with
 * `base.length - suffixLen <= i <= prefixLen` is mathematically a VALID
 * decomposition (`head === base.slice(0, i) + <insertLen bytes> +
 * base.slice(i)`, with `base` fully, byte-identically preserved either
 * side -- provable directly from what "common prefix"/"common suffix"
 * mean, independent of which point in that range is picked). If that
 * range is empty, no pure insertion exists and this returns false --
 * something in the middle of `baseText` was genuinely removed or altered.
 * If the range is non-empty, this accepts the input as long as AT LEAST
 * ONE point in that range yields an inserted block that itself opens with
 * a "## " heading -- a new version section, not arbitrary text prepended
 * above one. Every candidate in the range preserves `baseText` exactly by
 * construction, so trying more than one is not a laxer check, only a
 * correct read of a genuinely ambiguous (repeated-text) boundary.
 */
export function isChangelogPurePrepend(baseText, headText) {
  if (typeof headText !== "string" || headText.length === 0) return false;
  if (baseText === null || baseText === undefined) {
    // Brand-new file (git status "added"): there is no prior content to
    // preserve, so "pure insertion" is vacuous -- the only thing left to
    // require is that the file actually opens with a version heading,
    // optionally after the one-line "# Changelog" title
    // scripts/apply-release-changesets.mjs's prependChangelogEntry() writes
    // for a from-scratch file.
    return /^(#[^\n]*\n+)?##[ \t]/.test(headText);
  }

  const base = baseText;
  if (headText.length <= base.length) return false;
  const insertLen = headText.length - base.length;

  let prefixLen = 0;
  while (prefixLen < base.length && base[prefixLen] === headText[prefixLen]) prefixLen += 1;

  let suffixLen = 0;
  while (suffixLen < base.length && base[base.length - 1 - suffixLen] === headText[headText.length - 1 - suffixLen]) suffixLen += 1;

  const loI = Math.max(0, base.length - suffixLen);
  const hiI = Math.min(prefixLen, base.length);
  if (loI > hiI) return false; // no valid split -- something in the middle of base was removed or altered

  for (let i = loI; i <= hiI; i += 1) {
    const inserted = headText.slice(i, i + insertLen);
    if (/^##[ \t]/.test(inserted)) return true;
  }
  return false;
}

/**
 * Classifies ONE changed file against the release-PR shape. `status` is
 * the GitHub "list pull request files" vocabulary (added/removed/
 * modified/renamed/copied/changed/unchanged). `baseContent`/`headContent`
 * are that file's full text at the base and head commits respectively
 * (undefined/null where the file did not exist on that side -- e.g. a
 * brand-new CHANGELOG.md has no baseContent).
 *
 * package-lock.json is deliberately judged on path+status ONLY here --
 * see this module's header for why its content is verified separately,
 * by evaluateReleasePrFootprint()/verifyLockfileRegeneration() below, not
 * per-file.
 */
export function classifyReleasePrFile({ path, status, baseContent, headContent }) {
  if (RELEASE_PR_FILE_PATTERNS.packageManifest.test(path)) {
    return status === "modified" && isPackageManifestVersionOnlyChange(baseContent, headContent);
  }
  if (RELEASE_PR_FILE_PATTERNS.changelog.test(path)) {
    return (status === "modified" || status === "added") && isChangelogPurePrepend(status === "added" ? null : baseContent, headContent);
  }
  if (RELEASE_PR_FILE_PATTERNS.lockfile.test(path)) {
    return status === "modified";
  }
  if (RELEASE_PR_FILE_PATTERNS.changeset.test(path)) {
    return status === "removed";
  }
  return false;
}

/**
 * The full verdict over every changed file, PLUS the separate lockfile-
 * regeneration proof when a lockfile change is present. `files` is
 * `{ path, status, baseContent, headContent }[]`. `lockfileVerified` is
 * `null` when no package-lock.json appears in `files` (nothing to verify);
 * otherwise it is the boolean verifyLockfileRegeneration() (or an
 * equivalent) already computed -- this function does not itself touch npm
 * or the filesystem, keeping it a plain, fast, fully unit-testable
 * decision once content and the lockfile verdict are both in hand.
 *
 * Fails closed on every axis: an empty file list, a file that fails its
 * own classification, no package.json touched at all, or a present-but-
 * unverified lockfile all return `{ ok: false }` -- never a default pass.
 */
export function evaluateReleasePrFootprint({ files, lockfileVerified = null }) {
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, reason: "no changed files -- nothing to release" };
  }

  let touchedPackageManifest = false;
  let touchedLockfile = false;
  for (const file of files) {
    if (!classifyReleasePrFile(file)) {
      return { ok: false, reason: `"${file.path}" (${file.status}) is not a release-PR-shaped change` };
    }
    if (RELEASE_PR_FILE_PATTERNS.packageManifest.test(file.path)) touchedPackageManifest = true;
    if (RELEASE_PR_FILE_PATTERNS.lockfile.test(file.path)) touchedLockfile = true;
  }

  if (!touchedPackageManifest) {
    return { ok: false, reason: "no packages/<dir>/package.json version bump present" };
  }
  if (touchedLockfile && lockfileVerified !== true) {
    return { ok: false, reason: "package-lock.json changed but its regeneration could not be verified byte-for-byte" };
  }

  return { ok: true, reason: "every changed file is release-PR shaped" };
}

const defaultRunNpmInstall = (root) => execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], { cwd: root, stdio: "inherit" });

/**
 * Does `expectedLockfileText` byte-for-byte equal what `npm install
 * --package-lock-only --ignore-scripts` produces from `rootManifestText`
 * (this workspace's root package.json) and `packageManifestTexts`
 * (`{ [packages/<dir>]: package.json text }` for every workspace member)?
 * Builds a throwaway scratch directory containing only those manifests
 * (no source, no existing lockfile), runs the injected `runNpmInstall`
 * there, and compares. `runNpmInstall` defaults to the real `npm` CLI;
 * tests inject a fake that writes a canned lockfile instead of touching
 * the network.
 *
 * FAILS CLOSED: any error (a malformed manifest, npm itself failing --
 * network, a missing binary, anything) is caught and reported as
 * NOT verified (`false`), never thrown past this function -- callers
 * (evaluateReleasePrFootprint()) already treat `lockfileVerified !== true`
 * as a hard refusal, so "could not check" and "checked and it does not
 * match" have the identical, safe outcome.
 */
export function verifyLockfileRegeneration({ rootManifestText, packageManifestTexts, expectedLockfileText, runNpmInstall = defaultRunNpmInstall }) {
  let scratchRoot;
  try {
    scratchRoot = mkdtempSync(join(tmpdir(), "release-pr-footprint-lockfile-"));
    writeFileSync(join(scratchRoot, "package.json"), rootManifestText);
    for (const [pkgPath, text] of Object.entries(packageManifestTexts ?? {})) {
      const manifestPath = join(scratchRoot, pkgPath);
      mkdirSync(dirname(manifestPath), { recursive: true });
      writeFileSync(manifestPath, text);
    }
    runNpmInstall(scratchRoot);
    const lockPath = join(scratchRoot, "package-lock.json");
    if (!existsSync(lockPath)) return false;
    const regenerated = readFileSync(lockPath, "utf8");
    return regenerated === expectedLockfileText;
  } catch {
    return false;
  } finally {
    if (scratchRoot) rmSync(scratchRoot, { recursive: true, force: true });
  }
}
