// release-pr-footprint — STRUCTURAL (content-level) proof that a set of
// changed files is exactly the shape scripts/apply-release-changesets.mjs's
// release PR produces. Third pass, after two rounds of re-review on #1316:
//   - https://github.com/clossys/foundry/pull/1316#issuecomment-5800566625
//     (path-and-status alone is not enough -- introduced this module)
//   - https://github.com/clossys/foundry/pull/1316#issuecomment-5800871586
//     (this module's own first draft had three further defects, fixed
//     here -- see each section below for exactly what and why)
//
// FULLY PURE -- NO npm, NO NETWORK, NO FILESYSTEM
// ---------------------------------------------------
// Every function in this module takes already-fetched text content and
// returns a plain boolean or `{ ok, reason }`. The first draft's lockfile
// check ran `npm install --package-lock-only` in a scratch directory and
// compared byte-for-byte -- which sounds robust but is NOT deterministic
// against an already-committed lockfile: a real regeneration drifts from
// what is actually committed (transitive resolution details an npm run
// years apart, or even the same day on a different registry state, does
// not reproduce identically), so that check could FAIL ON AN UNCHANGED
// TREE -- the exemption could never pass, ever, which is a defect in the
// opposite direction of the one this module exists to close (fails open
// on a stricter design, but was actually failing shut on EVERYTHING,
// including the legitimate case). isLockfilePureVersionBump() below
// replaces it with a pure base-vs-head DIFF instead of a regeneration:
// no npm invocation, so nothing here can ever drift from what a real npm
// run happens to produce today.
//
// WHAT EACH FILE CLASS MUST PROVE
// ----------------------------------
//   packages/<dir>/package.json  -- status "modified"; parsed as JSON on
//     both sides; every key OTHER than "version" is compared with ITS
//     ORIGINAL KEY ORDER PRESERVED (isPackageManifestVersionOnlyChange()
//     -- see its own header for why sorting keys before comparing, this
//     module's own first-draft mistake, is actively wrong for a field
//     like `exports`, whose condition order is resolution-significant,
//     not cosmetic); "version" itself is not merely required to differ --
//     it must be a validated single-step patch/minor/major semver bump
//     (isSingleStepSemverBump(), reusing check-release-pr-shape.mjs's own
//     computeBumpLevel() -- see re-review
//     https://github.com/clossys/foundry/pull/1339#issuecomment-5801890878
//     item 2: an earlier draft accepted ANY differing text here, including
//     a semver range, an arbitrary jump, a prerelease, or a downgrade).
//   packages/<dir>/CHANGELOG.md  -- status "modified" or "added"; must
//     contain EXACTLY ONE new section, inserted immediately before the
//     base text's first existing version heading (after any preamble),
//     whose own heading is the bumped package's own new version -- see
//     isChangelogPureNewSection()'s own header for the exact shape and
//     why "a valid split range" (this module's own first-draft approach)
//     was not strict enough.
//   package-lock.json  -- status "modified"; isLockfilePureVersionBump()
//     -- see above and that function's own header.
//   .changesets/<slug>.md  -- status "removed" ONLY, AND its content AT
//     BASE must name only packages this diff actually bumps -- deleting
//     an unrelated PENDING changeset (one that names some other package
//     entirely) is not "consuming" it, it is silently discarding someone
//     else's still-pending change, which is exactly what a release PR
//     must never do. isChangesetDeletionLegitimate() checks this by
//     parsing the changeset's own base content with scripts/collect-
//     changesets.mjs's own parser (reused, not reimplemented) and
//     requiring every package it names to be among this diff's bumped
//     set.
//   anything else -- fails outright, regardless of status.
import { parseChangesetText } from "../collect-changesets.mjs";
import { computeBumpLevel } from "../check-release-pr-shape.mjs";

export const RELEASE_PR_FILE_PATTERNS = {
  packageManifest: /^packages\/([^/]+)\/package\.json$/,
  changelog: /^packages\/([^/]+)\/CHANGELOG\.md$/,
  lockfile: /^package-lock\.json$/,
  changeset: /^\.changesets\/[a-z0-9][a-z0-9-]*\.md$/,
};

// dependencies/peerDependencies/optionalDependencies -- deliberately NOT
// devDependencies. See isPackageManifestVersionOnlyChange()'s own header,
// "THE ONE NARROW EXCEPTION", for why.
export const DEPENDENT_RANGE_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

// A value both sides of a neutralized dependency-range field get set to,
// so the generic whole-object comparison in isPackageManifestVersionOnlyChange()
// below treats that field as equal on both sides -- WITHOUT deleting the
// key (which would shift every later key's apparent position) and without
// touching any OTHER field's value or position. Any concrete value works
// here as long as it can never collide with something a real package.json
// author's manifest legitimately uses this way; a string this improbable
// is simplest.
const NEUTRALIZED_DEPENDENCY_FIELD = "__release-pr-footprint: verified elsewhere__";

// Does the SAME dependency-range map (`dependencies`, `peerDependencies`,
// or `optionalDependencies`) on both sides differ ONLY by rewriting
// existing entries' values to `^<newVersion>`, where each such entry names
// a package `bumpedVersionsByName` proves this SAME diff actually bumped
// to that exact version? No key may be added or removed, and no key may
// change position -- see isPackageManifestVersionOnlyChange()'s own header
// for why key order is checked, not just the key set.
function isAllowedDependencyRangeChange(baseMap, headMap, bumpedVersionsByName) {
  if (baseMap === undefined && headMap === undefined) return true;
  if (baseMap === undefined || headMap === undefined) return false; // the field's own presence may not change
  if (typeof baseMap !== "object" || baseMap === null || Array.isArray(baseMap)) return false;
  if (typeof headMap !== "object" || headMap === null || Array.isArray(headMap)) return false;

  const baseKeys = Object.keys(baseMap);
  const headKeys = Object.keys(headMap);
  if (baseKeys.length !== headKeys.length) return false;
  for (let i = 0; i < baseKeys.length; i += 1) {
    if (baseKeys[i] !== headKeys[i]) return false; // same keys, same order -- no add, remove, or reorder
  }

  for (const key of baseKeys) {
    if (baseMap[key] === headMap[key]) continue; // unchanged entry -- always fine
    const newVersion = Object.prototype.hasOwnProperty.call(bumpedVersionsByName, key) ? bumpedVersionsByName[key] : undefined;
    if (newVersion === undefined) return false; // this diff never proved `key` was bumped -- not this diff's business to touch it
    if (headMap[key] !== `^${newVersion}`) return false; // must land on EXACTLY ^<newVersion>, nothing looser or different
  }
  return true;
}

/**
 * Is the ONLY difference between these two package.json texts the
 * top-level "version" field -- OR "version" plus specific entries in a
 * dependency-range map, each rewritten to point at a package THIS SAME
 * diff also bumped (see below)? Parses both as JSON, strips "version"
 * from each, and compares the rest via plain `JSON.stringify` --
 * deliberately NOT a key-sorted "canonical" comparison. An earlier draft
 * of this function sorted object keys before comparing, reasoning that
 * key order was "formatter noise"; it is not, for every field: `exports`'
 * condition order is part of how Node resolves it
 * (`{"import":...,"require":...}` is not the same export map as
 * `{"require":...,"import":...}` to a resolver that returns the first
 * matching condition), so silently tolerating a reordered `exports` block
 * would have let a real behavior change ride through this check
 * unnoticed. `JSON.stringify` on a value parsed straight from JSON.parse
 * already preserves each object's original key insertion order at every
 * nesting level, so comparing the stringified form is exactly "same
 * structure, same order, same values" with no separate canonicalization
 * step needed.
 *
 * THE ONE NARROW EXCEPTION (issue #1332, PR #1338)
 * ----------------------------------------------------
 * A release PR that bumps a package outside a SIBLING workspace package's
 * declared `dependencies`/`peerDependencies`/`optionalDependencies` range
 * on it (the classic 0.x minor-lock case: `^0.9.0` does not cover
 * `0.10.0`) must rewrite that sibling's own range to `^<newVersion>` in
 * the SAME commit, or the sibling's packed manifest keeps citing a range
 * a fresh install can no longer resolve to what it actually shipped
 * alongside -- scripts/apply-release-changesets.mjs does exactly this,
 * bumping the sibling's own version (a patch, if it was not already being
 * bumped for its own reason) in the same package.json write.
 * `isAllowedDependencyRangeChange()` above is the ENTIRE width of what
 * this widens: a changed entry in one of the three fields is allowed ONLY
 * when `bumpedVersionsByName` (computed by evaluateReleasePrFootprint()
 * below from every OTHER package.json in this SAME diff, never trusted
 * from this file's own claim) proves the named package was actually
 * bumped, and the new value is EXACTLY `^` plus that proven new version --
 * not a looser range, not a different package, not a value this diff
 * cannot independently verify. `devDependencies` is deliberately excluded
 * (not one of the three fields checked): npm never reads a dependency's
 * own `devDependencies` when resolving it as someone else's dependency, so
 * a stale range there cannot reproduce #1332's actual defect, and
 * scripts/check-workspace-links.mjs's own pre-existing sibling-range gate
 * already draws the same line -- keeping this the same scope means the
 * gate that catches a stale range and this check that admits a fix for one
 * can never quietly disagree about what counts as a first-party dependency
 * edge. No key may be added, removed, or reordered in any of the three
 * fields, and every OTHER field (name, license, scripts, bin, exports,
 * devDependencies, anything else) must remain fully byte-identical --
 * `bumpedVersionsByName` defaults to `{}`, so a caller that never passes it
 * gets exactly the old, unwidened behavior.
 *
 * THE BUMPED VERSION ITSELF IS VALIDATED, NOT TRUSTED (re-review,
 * https://github.com/clossys/foundry/pull/1339#issuecomment-5801890878)
 * -------------------------------------------------------------------------
 * `baseVersion` -> `headVersion` must be a legitimate single-step semver
 * bump -- see isSingleStepSemverBump() below. Before this, the only check
 * was `baseVersion !== headVersion` plus "is a non-empty string", which
 * accepted an any-version range (`0.10.0 || >=0.0.0`), an arbitrary jump
 * (`0.9.0` -> `9.9.9`), a prerelease (`0.10.0-evil.1`), or a downgrade as
 * the "new version" a sibling's rewritten range would then cite via
 * `bumpedVersionsByName` -- masked, before the widened lockfile rule
 * below existed, only by the lockfile check's own then-total strictness.
 */
export function isPackageManifestVersionOnlyChange(baseText, headText, bumpedVersionsByName = {}) {
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
  if (!isSingleStepSemverBump(baseVersion, headVersion)) return false;

  return compareRestAllowingDependencyRangeBumps(baseRest, headRest, bumpedVersionsByName);
}

// Shared by isPackageManifestVersionOnlyChange() above and
// isLockfilePureVersionBump() below: given each side's "version"-stripped
// rest object (a package.json with "version" removed, or one
// package-lock.json "packages" map ENTRY with its own "version" removed),
// is the only remaining difference an allowed dependency-range rewrite in
// one of DEPENDENT_RANGE_FIELDS? Mutates `baseRest`/`headRest` in place
// (neutralizing those fields once they've been separately validated) --
// both call sites already own throwaway destructured objects, never the
// original parsed manifest/lockfile, so this is safe.
function compareRestAllowingDependencyRangeBumps(baseRest, headRest, bumpedVersionsByName) {
  for (const field of DEPENDENT_RANGE_FIELDS) {
    if (!isAllowedDependencyRangeChange(baseRest[field], headRest[field], bumpedVersionsByName)) return false;
    // Neutralize the field in place (a plain property write on an
    // already-parsed object never moves an EXISTING key's position in
    // insertion-order iteration) so the generic comparison below no
    // longer sees the two sides' legitimately-different values there.
    if (Object.prototype.hasOwnProperty.call(baseRest, field)) baseRest[field] = NEUTRALIZED_DEPENDENCY_FIELD;
    if (Object.prototype.hasOwnProperty.call(headRest, field)) headRest[field] = NEUTRALIZED_DEPENDENCY_FIELD;
  }
  return JSON.stringify(baseRest) === JSON.stringify(headRest);
}

/**
 * Is `headVersion` a legitimate, single-step semver bump forward from
 * `baseVersion`? Reuses scripts/check-release-pr-shape.mjs's own
 * `computeBumpLevel()` -- the SAME function that script's separate,
 * pre-existing gate already uses to judge a version bump's shape -- rather
 * than a second implementation that could quietly disagree with it about
 * what counts as a valid bump.
 *
 * `computeBumpLevel()` requires both strings to match `/^(\d+)\.(\d+)\.(\d+)$/`
 * exactly (no range operators, no build/prerelease suffix, no leading/
 * trailing whitespace -- this repository's own versioning is plain X.Y.Z
 * only, confirmed by that same regex being the ONLY version shape any gate
 * in this repository accepts anywhere) and that the new triple is exactly
 * one clean patch/minor/major step forward from the old one -- which by
 * construction also refuses an equal version, a downgrade, and an
 * arbitrary multi-version jump (`0.9.0` -> `9.9.9` is not a single step of
 * anything). A `null` result (not a recognized single-step bump) is
 * refused here; this function does not itself distinguish WHICH of
 * patch/minor/major it was -- matching that to what the consumed
 * changesets actually claimed is scripts/check-release-pr-shape.mjs's own,
 * separate job (docs/RELEASING.md), deliberately not duplicated here.
 */
function isSingleStepSemverBump(baseVersion, headVersion) {
  return computeBumpLevel(baseVersion, headVersion) !== null;
}

/**
 * Does `headText` contain EXACTLY ONE new CHANGELOG section, inserted
 * immediately before `baseText`'s first existing version heading (after
 * any preamble -- a "# Changelog" title, blank lines, anything above the
 * first "## " line), whose own heading opens with `## <newVersion>`, with
 * NOTHING else in the document changed and no duplicate heading line
 * anywhere in the result?
 *
 * This replaced an earlier "valid split range" version of this check
 * (search every position a pure insertion COULD have happened, accept if
 * any of them looks like a heading) with a single, EXACT expected
 * insertion point instead: scripts/apply-release-changesets.mjs's
 * prependChangelogEntry() only ever inserts at one place -- directly
 * before the first "## " heading in the pre-existing file (or at the end
 * of a from-scratch file's title, if there is no prior heading at all) --
 * so there is exactly one legitimate insertion point, not a range of
 * them, and checking a range was strictly more permissive than the real
 * release PR command ever produces. Requiring the inserted heading to
 * equal the SPECIFIC version this diff's own package.json bumped to
 * (`newVersion`, supplied by the caller -- see evaluateReleasePrFootprint()
 * below, which cross-references each CHANGELOG.md against its own
 * package's version bump) closes the remaining gap: a structurally clean
 * insertion for the WRONG version number is not this package's release
 * note.
 *
 * `baseText` may be `null`/`undefined` for a brand-new CHANGELOG.md (git
 * status "added"), treated as empty -- the whole head text is then "the
 * insertion", which may itself carry one leading "# ...\n" preamble line
 * (scripts/apply-release-changesets.mjs writes "# Changelog\n\n" for a
 * from-scratch file) before its own "## <newVersion>" heading.
 */
export function isChangelogPureNewSection(baseText, headText, newVersion) {
  if (typeof headText !== "string" || typeof newVersion !== "string" || newVersion.length === 0) return false;
  const base = baseText ?? "";
  if (headText.length <= base.length) return false;

  const headingMatch = /^## /m.exec(base);
  const insertPos = headingMatch ? headingMatch.index : base.length;
  const insertLen = headText.length - base.length;
  const insertEnd = insertPos + insertLen;

  // Everything strictly before and strictly after the insertion point must
  // be byte-for-byte the base text -- not "similar enough", not "differs
  // only in whitespace". This is what makes the insertion point EXACT
  // rather than a range: there is only one candidate split (base's own
  // first-heading position), and either the surrounding text matches or it
  // does not.
  if (headText.slice(0, insertPos) !== base.slice(0, insertPos)) return false;
  if (headText.slice(insertEnd) !== base.slice(insertPos)) return false;

  const inserted = headText.slice(insertPos, insertEnd);
  if (inserted.length === 0) return false;

  const contentToCheck = base.length === 0 ? stripOneLeadingTitleLine(inserted) : inserted;
  const escapedVersion = newVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^## ${escapedVersion}(?:[ \\t\\n]|$)`).test(contentToCheck)) return false;

  // "Exactly one new section" -- the inserted block must carry precisely
  // one "## " heading line (its own), never a second one smuggled in
  // alongside it (which would otherwise pass the pure-insertion check
  // above while quietly duplicating or shadowing some other version's
  // entry inside the very same insertion).
  const insertedHeadingCount = (inserted.match(/^##[ \t]/gm) ?? []).length;
  if (insertedHeadingCount !== 1) return false;

  // Defense in depth: no two VERSION heading lines ("## ", exactly two
  // hashes) anywhere in the final document may be textually identical --
  // a fake duplicate heading that shadows a real one (whether or not it
  // could have snuck past the checks above) is refused outright. Matches
  // ONLY "##[ \t]" (two hashes), never three-or-more -- an earlier draft
  // used a bare `^##.*$`, which also matches every "### Added" / "### Fixed"
  // Keep-a-Changelog SUBSECTION heading this repository's own CHANGELOG
  // files already repeat entry after entry by convention, so that version
  // refused every genuine release PR outright (found by re-review: see
  // https://github.com/clossys/foundry/pull/1316#issuecomment-5801060575).
  const allHeadingLines = headText.match(/^##[ \t].*$/gm) ?? [];
  const seenHeadingLines = new Set();
  for (const line of allHeadingLines) {
    if (seenHeadingLines.has(line)) return false;
    seenHeadingLines.add(line);
  }

  return true;
}

function stripOneLeadingTitleLine(text) {
  const m = /^#[^\n]*\n+/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

// True if `entry` (a package-lock.json "packages" map value, or
// undefined) is a "link" pointer at a bumped workspace package -- npm
// writes one `node_modules/<name>` entry per workspace member alongside
// its real `packages/<dir>` entry, pointing back at it via `resolved`.
function isLinkToBumpedWorkspaceEntry(entry, workspaceKeys) {
  return Boolean(entry && typeof entry === "object" && typeof entry.resolved === "string" && workspaceKeys.has(entry.resolved));
}

/**
 * Is `headText` a plain base-vs-head DIFF of `baseText` (both
 * package-lock.json, lockfileVersion 3 shape: a top-level `packages`
 * object keyed by path) where the ONLY changes anywhere are the `version`
 * field of each bumped workspace package's own `packages/<dir>` entry, its
 * matching `node_modules/<name>` link entry (if npm wrote one), and --
 * mirroring isPackageManifestVersionOnlyChange()'s own "ONE NARROW
 * EXCEPTION" -- an allowed dependency-range rewrite inside a bumped
 * workspace entry's own `dependencies`/`peerDependencies`/
 * `optionalDependencies` sub-object? No npm is ever invoked -- see this
 * module's own header for why a regeneration-based check was replaced
 * with this pure comparison.
 *
 * WHY THE LOCKFILE NEEDS THE SAME EXCEPTION THE MANIFEST DOES (re-review,
 * https://github.com/clossys/foundry/pull/1339#issuecomment-5801890878)
 * -------------------------------------------------------------------------
 * `npm install --package-lock-only` writes each workspace package's
 * CURRENT manifest content into its own `packages/<dir>` entry -- so when
 * scripts/apply-release-changesets.mjs rewrites a dependent's
 * `dependencies["@x/core"]` from `^0.9.0` to `^0.10.0` in its
 * package.json, the regenerated lockfile's `packages/<dependent-dir>`
 * entry carries that identical rewrite too. An earlier version of this
 * function required every field but `version` to be byte-identical on a
 * bumped entry, which refused every real #1332/#1338-shaped release PR at
 * this step even after the manifest rule above was widened to accept it --
 * the relaxation was correct but inert, since the lockfile check still
 * blocked the exact same release. `isAllowedDependencyRangeChange()` (the
 * SAME function the manifest rule uses, not a second implementation of it)
 * is reused here for the identical reason both callers share: the two
 * checks can never quietly disagree about what a legitimate rewrite looks
 * like.
 *
 * `bumpedPackageDirs` is the list of `packages/<dir>` directory names this
 * diff's package.json changes actually bumped, and `bumpedVersionsByName`
 * maps each bumped package's own npm NAME to its new version (both
 * computed by evaluateReleasePrFootprint() below from the SAME diff, never
 * trusted from the lockfile's own content). Every other packages-map entry
 * -- every third-party dependency, every non-bumped workspace member, the
 * lockfile's own top-level fields (name, lockfileVersion, `requires`,
 * anything else) -- must still be byte-for-byte identical; a changed
 * `resolved`, `integrity`, an added dependency, a version bump on anything
 * NOT in `bumpedPackageDirs`, or a dependency-range rewrite that does not
 * meet the exact same rule the manifest check enforces (see that
 * function's own header) all fail this outright. An entry added or
 * removed from the `packages` map at all also fails.
 */
export function isLockfilePureVersionBump(baseText, headText, bumpedPackageDirs, bumpedVersionsByName = {}) {
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
  if (!baseJson.packages || typeof baseJson.packages !== "object" || !headJson.packages || typeof headJson.packages !== "object") return false;

  const { packages: basePackages, ...baseRest } = baseJson;
  const { packages: headPackages, ...headRest } = headJson;
  if (JSON.stringify(baseRest) !== JSON.stringify(headRest)) return false;

  const baseKeys = Object.keys(basePackages);
  const headKeySet = new Set(Object.keys(headPackages));
  if (baseKeys.length !== headKeySet.size) return false;
  for (const key of baseKeys) if (!headKeySet.has(key)) return false;

  const workspaceKeys = new Set((bumpedPackageDirs ?? []).map((d) => `packages/${d}`));

  for (const key of baseKeys) {
    const baseEntry = basePackages[key];
    const headEntry = headPackages[key];
    const isBumpedWorkspaceEntry = workspaceKeys.has(key);
    const isBumpedLinkEntry = isLinkToBumpedWorkspaceEntry(baseEntry, workspaceKeys) && isLinkToBumpedWorkspaceEntry(headEntry, workspaceKeys);

    if (isBumpedWorkspaceEntry || isBumpedLinkEntry) {
      if (!baseEntry || typeof baseEntry !== "object" || !headEntry || typeof headEntry !== "object") return false;
      const { version: baseVersion, ...baseEntryRest } = baseEntry;
      const { version: headVersion, ...headEntryRest } = headEntry;
      void baseVersion;
      void headVersion;
      if (!compareRestAllowingDependencyRangeBumps(baseEntryRest, headEntryRest, bumpedVersionsByName)) return false;
      continue;
    }

    if (JSON.stringify(baseEntry) !== JSON.stringify(headEntry)) return false;
  }

  return true;
}

/**
 * Was this deleted `.changesets/<slug>.md` file (its content AT BASE,
 * before deletion) actually about a package this diff bumps -- never an
 * unrelated, still-pending changeset silently discarded alongside a
 * legitimate one? Parses `baseContent` with scripts/collect-
 * changesets.mjs's own `parseChangesetText()` (reused, not reimplemented
 * -- the SAME rules that gate what a changeset is allowed to say at all)
 * and requires every package it names to be a member of
 * `bumpedPackageDirs`. A changeset that fails to parse at all, or that
 * names zero packages, or that names even ONE package outside the bumped
 * set, is not a legitimate deletion.
 */
export function isChangesetDeletionLegitimate(baseContent, bumpedPackageDirs) {
  if (typeof baseContent !== "string") return false;
  const result = parseChangesetText(baseContent, {});
  if (result.error) return false;
  const names = Object.keys(result.packages);
  if (names.length === 0) return false;
  const bumpedSet = new Set(bumpedPackageDirs ?? []);
  return names.every((name) => bumpedSet.has(name));
}

/**
 * The full verdict over every changed file in a candidate release PR.
 * `files` is `{ path, status, baseContent, headContent }[]` -- the caller
 * (scripts/check-release-calendar.mjs) is responsible for fetching every
 * file's content; this function touches no filesystem, git, or network
 * itself, and is fully synchronous and deterministic given its input.
 *
 * THREE passes, in order, because the second and third both need to know
 * the FULL bumped set before they can judge anything:
 *
 *   1. For every `packages/<dir>/package.json`, confirm it parses on both
 *      sides and its own "version" genuinely changed -- nothing more yet.
 *      Record the new version keyed BOTH by directory (`bumpedVersions`,
 *      for cross-referencing a CHANGELOG.md/changeset against ITS OWN
 *      package) and by the manifest's own `name` field (`bumpedVersionsByName`,
 *      since a `dependencies` entry names a package by its npm name, not
 *      its packages/<dir> directory -- collect-changesets.mjs's own header
 *      has the same directory-vs-name distinction). A diff with no bump at
 *      all is refused immediately (nothing to release).
 *   2. NOW that the full bumped set is known, each `package.json` is
 *      re-validated in full: `isPackageManifestVersionOnlyChange()`,
 *      passed `bumpedVersionsByName`, additionally allows a
 *      `dependencies`/`peerDependencies`/`optionalDependencies` entry to
 *      change ONLY when it names a package THIS SAME diff's pass 1 proved
 *      was bumped, landing on exactly `^<that new version>` -- see that
 *      function's own header, "THE ONE NARROW EXCEPTION" (issue #1332,
 *      PR #1338).
 *   3. Every OTHER changed file is validated against the bumped set from
 *      pass 1 -- a CHANGELOG.md is checked against ITS OWN package's
 *      specific new version (not just "some version-shaped heading"), the
 *      lockfile is checked against the full set of bumped directories at
 *      once (it is one file covering every package), and a deleted
 *      changeset must name only bumped packages. Any file that is not one
 *      of these four classes, or fails its own class's check, fails the
 *      whole PR immediately.
 */
export function evaluateReleasePrFootprint({ files }) {
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, reason: "no changed files -- nothing to release" };
  }

  const bumpedVersions = {};
  const bumpedVersionsByName = {};
  for (const file of files) {
    const match = RELEASE_PR_FILE_PATTERNS.packageManifest.exec(file.path);
    if (!match) continue;
    if (file.status !== "modified") return { ok: false, reason: `"${file.path}" has status "${file.status}" -- expected modified` };
    let baseJson, headJson;
    try {
      baseJson = JSON.parse(file.baseContent);
      headJson = JSON.parse(file.headContent);
    } catch {
      return { ok: false, reason: `"${file.path}" is not valid JSON on both sides` };
    }
    if (!baseJson || typeof baseJson !== "object" || !headJson || typeof headJson !== "object") {
      return { ok: false, reason: `"${file.path}" is not a JSON object on both sides` };
    }
    const { version: headVersion } = headJson;
    if (!isSingleStepSemverBump(baseJson.version, headVersion)) {
      return { ok: false, reason: `"${file.path}" version did not change to a single-step patch/minor/major semver bump ("${baseJson.version}" -> "${headVersion}")` };
    }
    bumpedVersions[match[1]] = headVersion;
    if (typeof headJson.name === "string" && headJson.name.length > 0) bumpedVersionsByName[headJson.name] = headVersion;
  }

  const bumpedDirs = Object.keys(bumpedVersions);
  if (bumpedDirs.length === 0) {
    return { ok: false, reason: "no packages/<dir>/package.json version bump present" };
  }

  for (const file of files) {
    if (!RELEASE_PR_FILE_PATTERNS.packageManifest.test(file.path)) continue;
    if (!isPackageManifestVersionOnlyChange(file.baseContent, file.headContent, bumpedVersionsByName)) {
      return { ok: false, reason: `"${file.path}" changes more than its own version and any allowed sibling-dependency-range rewrites` };
    }
  }

  for (const file of files) {
    if (RELEASE_PR_FILE_PATTERNS.packageManifest.test(file.path)) continue; // already validated above

    const changelogMatch = RELEASE_PR_FILE_PATTERNS.changelog.exec(file.path);
    if (changelogMatch) {
      const dir = changelogMatch[1];
      const expectedVersion = bumpedVersions[dir];
      if (!expectedVersion) return { ok: false, reason: `"${file.path}" changed, but packages/${dir} was not bumped in this diff` };
      if (file.status !== "modified" && file.status !== "added") return { ok: false, reason: `"${file.path}" has status "${file.status}" -- expected modified or added` };
      if (!isChangelogPureNewSection(file.status === "added" ? null : file.baseContent, file.headContent, expectedVersion)) {
        return { ok: false, reason: `"${file.path}" is not exactly one new "${expectedVersion}" section, cleanly inserted at the top` };
      }
      continue;
    }

    if (RELEASE_PR_FILE_PATTERNS.lockfile.test(file.path)) {
      if (file.status !== "modified") return { ok: false, reason: `"${file.path}" has status "${file.status}" -- expected modified` };
      if (!isLockfilePureVersionBump(file.baseContent, file.headContent, bumpedDirs, bumpedVersionsByName)) {
        return { ok: false, reason: `"${file.path}" changes are not limited to the bumped workspace packages' version fields` };
      }
      continue;
    }

    if (RELEASE_PR_FILE_PATTERNS.changeset.test(file.path)) {
      if (file.status !== "removed") return { ok: false, reason: `"${file.path}" has status "${file.status}" -- only a deletion is legal` };
      if (!isChangesetDeletionLegitimate(file.baseContent, bumpedDirs)) {
        return { ok: false, reason: `"${file.path}" does not name only packages bumped in this diff` };
      }
      continue;
    }

    return { ok: false, reason: `"${file.path}" (${file.status}) is not a release-PR-shaped change` };
  }

  return { ok: true, reason: "every changed file is release-PR shaped" };
}
