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
//   docs/changelogs/<dir>.md  -- the package changelog, kept in this
//     public repository rather than the tarball (scripts/lib/changelog-
//     location.mjs); status "modified" or "added"; must
//     contain EXACTLY ONE new section, inserted immediately before the
//     base text's first existing version heading (after any preamble),
//     whose own heading is the bumped package's own new version -- see
//     isChangelogPureNewSection()'s own header for the exact shape and
//     why "a valid split range" (this module's own first-draft approach)
//     was not strict enough.
//   package-lock.json  -- status "modified"; isLockfilePureVersionBump()
//     -- see above and that function's own header. MUST APPEAR IN THE DIFF
//     AT ALL whenever any packages/<dir>/package.json bumps a version
//     (issue #1331) -- a version bump that never ran `npm install
//     --package-lock-only` at all has nothing here for isLockfilePureVersionBump()
//     to judge, and a footprint check that stays silent about an absent
//     file is not "no opinion", it is a pass by omission. See the absent-
//     lockfile check at the end of evaluateReleasePrFootprint() below.
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
import { DEPENDENCY_RANGE_SECTIONS, prependChangelogEntry } from "../apply-release-changesets.mjs";
import { CHANGELOG_REL_PATH_RE, changelogRelPath as changelogRelPathFor } from "./changelog-location.mjs";

export const RELEASE_PR_FILE_PATTERNS = {
  packageManifest: /^packages\/([^/]+)\/package\.json$/,
  // docs/changelogs/<dir>.md (never docs/changelogs/README.md). A
  // packages/<dir>/CHANGELOG.md matches no pattern here, so a release PR
  // that writes one fails as "not a release-PR-shaped change".
  changelog: CHANGELOG_REL_PATH_RE,
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
 * cannot independently verify. No key may be added, removed, or reordered
 * in any of the three fields, and every OTHER field (name, license,
 * scripts, bin, exports, anything else) must remain fully byte-identical
 * -- `bumpedVersionsByName` defaults to `{}`, so a caller that never
 * passes it gets exactly the old, unwidened behavior.
 *
 * `devDependencies` GETS THE IDENTICAL EXCEPTION TOO, BUT NEVER REQUIRES A
 * BUMP OF ITS OWN (decision + fix, re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726)
 * -------------------------------------------------------------------------
 * An earlier draft of this exception deliberately excluded devDependencies
 * on the reasoning that npm never reads a PUBLISHED dependency's own
 * devDependencies when resolving it as someone else's dependency. That
 * reasoning is correct for an external consumer, but misses that THIS
 * repository's own `npm install --package-lock-only` (what
 * apply-release-changesets.mjs's real `runNpmInstall` calls) resolves
 * every workspace member's devDependencies too, same as any npm workspaces
 * install -- a real case in this repository (`packages/controller`'s
 * devDependencies on `@clossys/advisor` at `^0.4.0`) breaks that install
 * the moment advisor's version moves outside the range, exactly #1332's
 * defect via a devDependencies edge instead. `compareRestAllowingDependency-
 * RangeBumps()` below checks `devDependencies` through the SAME
 * `isAllowedDependencyRangeChange()` rule as the other three fields --
 * same "exactly `^<the proven new version>`, no added/removed/reordered
 * key" width, no separate implementation. The one real difference: a
 * package whose package.json changes ONLY its devDependencies (no version
 * bump at all) is NOT this function's business -- see
 * `isDevDependenciesOnlyRewrite()` below for that separate, deliberately
 * bump-free case, and this file's own module header for why: a
 * devDependencies range is never published or consumer-facing, so there is
 * nothing for a version bump to communicate outside this repository, and
 * bumping a package whose only real change is an internal dev-environment
 * detail would be actively misleading.
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

/**
 * The devDependencies-only counterpart to isPackageManifestVersionOnlyChange()
 * above (decision + fix, re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726)
 * -- see that function's own header, "`devDependencies` GETS THE IDENTICAL
 * EXCEPTION TOO", for the full reasoning. Is `headText` the SAME as
 * `baseText` except for an allowed devDependencies rewrite -- `version`
 * UNCHANGED (never a bump; that is the OTHER function's job), and ONLY
 * `devDependencies` differing, via the identical `isAllowedDependencyRangeChange()`
 * rule (exactly `^<a version bumpedVersionsByName proves>`, no
 * added/removed/reordered key)? A package.json whose `version` DID change
 * is never this function's business -- evaluateReleasePrFootprint() below
 * tries isSingleStepSemverBump() FIRST and only reaches this function for
 * a package.json that did NOT bump, matching apply-release-changesets.mjs's
 * own producer-side rule that a devDependencies-only rewrite never
 * triggers its own version bump.
 */
export function isDevDependenciesOnlyRewrite(baseText, headText, bumpedVersionsByName = {}) {
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
  if (typeof baseJson.version !== "string" || baseJson.version.length === 0) return false;
  if (baseJson.version !== headJson.version) return false; // a real version change is isPackageManifestVersionOnlyChange()'s business, not this one's

  const { devDependencies: baseDevDependencies, ...baseRest } = baseJson;
  const { devDependencies: headDevDependencies, ...headRest } = headJson;
  if (!isAllowedDependencyRangeChange(baseDevDependencies, headDevDependencies, bumpedVersionsByName)) return false;

  return JSON.stringify(baseRest) === JSON.stringify(headRest);
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
// DEPENDENT_RANGE_FIELDS plus devDependencies -- see
// isPackageManifestVersionOnlyChange()'s own header, "`devDependencies`
// GETS THE IDENTICAL EXCEPTION TOO", for why devDependencies is checked
// here (in the shared helper both the manifest and lockfile bumped-entry
// checks call) rather than folded into DEPENDENT_RANGE_FIELDS itself --
// DEPENDENT_RANGE_FIELDS stays the three publish-relevant fields for
// every OTHER purpose (messaging, the devDependencies-only no-bump path
// below), and this is the one place all four are treated uniformly.
const REWRITABLE_ENTRY_FIELDS = [...DEPENDENT_RANGE_FIELDS, "devDependencies"];

// Same key set, same values -- but, deliberately UNLIKE
// isAllowedDependencyRangeChange() above, key ORDER does not matter (fix,
// re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803894960
// blocking item 1). This is used ONLY to cross-check a lockfile entry's
// dependency map against the REAL manifest's own map -- two independently
// formatted representations of conceptually the same data, where
// `npm install --package-lock-only` writes each `packages/<dir>` entry's
// maps in SORTED key order regardless of what order the source
// package.json declared them in (confirmed against this repository's own
// real `packages/publisher` -- unsorted `dependencies`/`devDependencies`
// -- and `packages/designer` -- unsorted `peerDependencies`). Requiring
// identical key order here, the same way isAllowedDependencyRangeChange()
// correctly does for a base-vs-head REWRITE within the lockfile's own
// history, made every real release that bumps either package fail this
// check outright -- not a security relaxation, a correction: the fields
// being compared here were never claimed to preserve source order in the
// first place, only to carry the same facts.
function isSameDependencyMapIgnoringKeyOrder(a, b) {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== "object" || a === null || Array.isArray(a)) return false;
  if (typeof b !== "object" || b === null || Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function compareRestAllowingDependencyRangeBumps(baseRest, headRest, bumpedVersionsByName) {
  for (const field of REWRITABLE_ENTRY_FIELDS) {
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
 * below, which cross-references each changelog against its own
 * package's version bump) closes the remaining gap: a structurally clean
 * insertion for the WRONG version number is not this package's release
 * note.
 *
 * `baseText` may be `null`/`undefined` for a brand-new changelog (git
 * status "added"), treated as empty -- the whole head text is then "the
 * insertion", which may itself carry one leading "# ...\n" preamble line
 * (scripts/apply-release-changesets.mjs writes "# Changelog\n\n" for a
 * from-scratch file) before its own "## <newVersion>" heading.
 *
 * A BASE WITH A TITLE BUT NO VERSION HEADING AT ALL IS THE SAME "NO
 * HEADING" CASE AS A BRAND-NEW FILE, NOT A SPLIT-POINT MISMATCH (fix,
 * re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726
 * item 5) -------------------------------------------------------------
 * `prependChangelogEntry()`'s own "no existing entry" branch does not
 * insert at exactly `base.length` when `base` is non-empty but has no
 * "## " heading (e.g. a fresh `"# Changelog\n"` with nothing published
 * yet) -- it NORMALIZES `base`'s own trailing whitespace to exactly one
 * blank line (`text.replace(/\n*$/, "\n\n")`) before appending, so the
 * bytes strictly before the new entry are `base` with trailing whitespace
 * TRIMMED, not `base` verbatim. Assuming `insertPos === base.length` here
 * (as an earlier draft did) made every real producer output for this
 * shape fail this check for any base that did not already end in exactly
 * `"\n\n"` -- an inconsistency between what the producer writes and what
 * this function accepts, never exercised until a package's changelog
 * genuinely had a title but no releases yet. Mirrored below by trimming
 * `base`'s own trailing whitespace the identical way before comparing,
 * for the no-heading case only -- the WITH-heading case (a real,
 * previously-released changelog, the security-relevant path with prior
 * entries to protect) is completely unaffected, still exactly as strict
 * as before.
 */
export function isChangelogPureNewSection(baseText, headText, newVersion) {
  if (typeof headText !== "string" || typeof newVersion !== "string" || newVersion.length === 0) return false;
  const base = baseText ?? "";
  if (headText.length <= base.length) return false;

  const headingMatch = /^## /m.exec(base);
  let insertPos, insertEnd;

  if (headingMatch) {
    insertPos = headingMatch.index;
    const insertLen = headText.length - base.length;
    insertEnd = insertPos + insertLen;

    // Everything strictly before and strictly after the insertion point
    // must be byte-for-byte the base text -- not "similar enough", not
    // "differs only in whitespace". This is what makes the insertion
    // point EXACT rather than a range: there is only one candidate split
    // (base's own first-heading position), and either the surrounding
    // text matches or it does not.
    if (headText.slice(0, insertPos) !== base.slice(0, insertPos)) return false;
    if (headText.slice(insertEnd) !== base.slice(insertPos)) return false;
  } else {
    // No "## " heading anywhere in base -- see this function's own header,
    // the item-5 fix. `trimmedBase` is base with ONLY trailing whitespace
    // removed (matching prependChangelogEntry()'s own normalization); the
    // new entry is APPENDED after it, so nothing follows the entry at all.
    const trimmedBase = base.replace(/\s+$/, "");
    insertPos = trimmedBase.length;
    insertEnd = headText.length;
    if (headText.slice(0, insertPos) !== trimmedBase) return false;
  }

  const inserted = headText.slice(insertPos, insertEnd);
  if (inserted.length === 0) return false;

  // `base.length === 0`: the producer's OWN default title ("# Changelog\n\n")
  // is baked into `inserted` itself (this caller never saw it -- the file
  // did not exist) -- strip it before checking the heading. A non-empty
  // base with no heading already had its real title excluded via
  // `trimmedBase` above; only the normalization whitespace remains to
  // strip. A base WITH a heading needs neither -- `inserted` already
  // starts exactly at the real "## " line.
  const contentToCheck = base.length === 0 ? stripOneLeadingTitleLine(inserted) : headingMatch ? inserted : inserted.replace(/^\s+/, "");
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
 *
 * THE LOCKFILE MUST MIRROR THE MANIFEST, NOT MERELY LOOK INTERNALLY
 * CONSISTENT (re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726)
 * -------------------------------------------------------------------------
 * Every check above this point only ever compares the lockfile against
 * ITSELF (base vs head) -- nothing required a bumped `packages/<dir>`
 * entry's `version` or dependency-range fields to actually MATCH the real
 * package.json this diff bumped it from. That gap meant a real diff could
 * carry `packages/core.version: "9.9.9"` in the lockfile while
 * `packages/core/package.json` genuinely bumped to `"0.10.0"` (or a
 * DELETED lockfile version, or one silently left at the base value, or a
 * lockfile with `^0.10.0` for a dependent while its own manifest still
 * said `^0.9.0`, or the reverse) and this function would still say `true`,
 * because every one of those still "looked like" one of the two allowed
 * shapes (an unconstrained version change, or an allowed-shaped range
 * rewrite) in isolation.
 *
 * `bumpedManifestsByName` closes this: it maps each bumped package's npm
 * NAME to `{ version, dependencies, peerDependencies, optionalDependencies }`
 * taken from the SAME parsed head package.json JSON
 * evaluateReleasePrFootprint() already validated in its own PASS 1 --
 * never trusted from the lockfile's own content, same discipline as
 * `bumpedVersionsByName`. For a bumped workspace entry (never a
 * `node_modules/<name>` link entry, which carries no version or dependency
 * fields of its own in this repository's lockfile shape): the entry's own
 * `name` must have a `bumpedManifestsByName` record at all (a workspace
 * entry `bumpedPackageDirs` claims is bumped, with no matching manifest
 * data, fails closed rather than skip the cross-check); its head `version`
 * must be EXACTLY that manifest's new version (a wrong version, a missing
 * one, or one left at the base version are all simply "not equal" here,
 * so all three fail the same way); and each of `dependencies`/
 * `peerDependencies`/`optionalDependencies`, if either side has it at all,
 * must be structurally EQUAL to the manifest's own field, not merely "a
 * shape `isAllowedDependencyRangeChange()` would have accepted" -- that
 * function's own check still runs too (via `compareRestAllowingDependency-
 * RangeBumps()` below), so a rewrite must satisfy BOTH "this is a
 * legitimate range-bump shape relative to the lockfile's own base" AND
 * "this is what the manifest actually says".
 */
export function isLockfilePureVersionBump(baseText, headText, bumpedPackageDirs, bumpedVersionsByName = {}, bumpedManifestsByName = {}, devDependencyOnlyDirs = [], devDependencyOnlyManifestsByName = {}) {
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
  const devOnlyWorkspaceKeys = new Set(Array.from(devDependencyOnlyDirs ?? []).map((d) => `packages/${d}`));

  for (const key of baseKeys) {
    const baseEntry = basePackages[key];
    const headEntry = headPackages[key];
    const isBumpedWorkspaceEntry = workspaceKeys.has(key);
    const isBumpedLinkEntry = isLinkToBumpedWorkspaceEntry(baseEntry, workspaceKeys) && isLinkToBumpedWorkspaceEntry(headEntry, workspaceKeys);
    const isDevDependencyOnlyWorkspaceEntry = !isBumpedWorkspaceEntry && devOnlyWorkspaceKeys.has(key);

    if (isBumpedWorkspaceEntry) {
      if (!baseEntry || typeof baseEntry !== "object" || !headEntry || typeof headEntry !== "object") return false;

      // Cross-check against the real manifest -- see this function's own
      // header, "THE LOCKFILE MUST MIRROR THE MANIFEST". Only the
      // `packages/<dir>` entry itself carries a name/version/dependency
      // fields to cross-check; a `node_modules/<name>` link entry (handled
      // below) does not, in this repository's lockfile shape.
      const name = typeof headEntry.name === "string" ? headEntry.name : undefined;
      if (!name || !Object.prototype.hasOwnProperty.call(bumpedManifestsByName, name)) return false;
      const manifestInfo = bumpedManifestsByName[name];
      if (headEntry.version !== manifestInfo.version) return false; // wrong, missing (undefined), or left at the base version -- all "not equal", all fail
      for (const field of REWRITABLE_ENTRY_FIELDS) {
        if (!isSameDependencyMapIgnoringKeyOrder(headEntry[field], manifestInfo[field])) return false;
      }

      const { version: baseVersion, ...baseEntryRest } = baseEntry;
      const { version: headVersion, ...headEntryRest } = headEntry;
      void baseVersion;
      void headVersion;
      if (!compareRestAllowingDependencyRangeBumps(baseEntryRest, headEntryRest, bumpedVersionsByName)) return false;
      continue;
    }

    if (isBumpedLinkEntry) {
      if (!baseEntry || typeof baseEntry !== "object" || !headEntry || typeof headEntry !== "object") return false;

      // A link entry's own `version` field, if it has one at all, must
      // match the REAL workspace entry it `resolved` points at -- never an
      // arbitrary, unconstrained value (should-fix, re-review,
      // https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726
      // and https://github.com/clossys/foundry/pull/1353#issuecomment-5803894960).
      // This repository's own real lockfile link entries carry no
      // `version` at all (see this module's own header); some other npm
      // version might still write one, so if either side HAS one, it must
      // be provably correct rather than merely ignored.
      if (typeof headEntry.resolved === "string") {
        const resolvedWorkspaceEntry = headPackages[headEntry.resolved];
        const expectedVersion = resolvedWorkspaceEntry && typeof resolvedWorkspaceEntry === "object" ? resolvedWorkspaceEntry.version : undefined;
        if (Object.prototype.hasOwnProperty.call(headEntry, "version") && headEntry.version !== expectedVersion) return false;
      }

      const { version: baseVersion, ...baseEntryRest } = baseEntry;
      const { version: headVersion, ...headEntryRest } = headEntry;
      void baseVersion;
      void headVersion;
      if (!compareRestAllowingDependencyRangeBumps(baseEntryRest, headEntryRest, bumpedVersionsByName)) return false;
      continue;
    }

    // DEVDEPENDENCIES-ONLY, NEVER BUMPED -- a `packages/<dir>` entry NOT
    // in `bumpedPackageDirs` at all (its version never changed anywhere in
    // this diff) but named in `devDependencyOnlyDirs`: only its
    // `devDependencies` field may differ, via the identical
    // isAllowedDependencyRangeChange() rule, and `version` must be
    // byte-identical (never a bump -- see this file's module header and
    // isDevDependenciesOnlyRewrite()'s own header). Also cross-checked
    // against the real manifest (re-review,
    // https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726
    // should-fix, closed here): an earlier round only proved this entry
    // was an internally-consistent devDependencies-only diff, never that
    // its rewritten range actually matched the manifest's own -- a
    // lockfile left at the stale range while the manifest was correctly
    // rewritten (or the reverse) both passed.
    if (isDevDependencyOnlyWorkspaceEntry) {
      if (!baseEntry || typeof baseEntry !== "object" || !headEntry || typeof headEntry !== "object") return false;
      if (baseEntry.version !== headEntry.version) return false;

      const name = typeof headEntry.name === "string" ? headEntry.name : undefined;
      if (!name || !Object.prototype.hasOwnProperty.call(devDependencyOnlyManifestsByName, name)) return false;
      const manifestInfo = devDependencyOnlyManifestsByName[name];
      if (headEntry.version !== manifestInfo.version) return false;
      if (!isSameDependencyMapIgnoringKeyOrder(headEntry.devDependencies, manifestInfo.devDependencies)) return false;

      const { devDependencies: baseDevDependencies, ...baseEntryRest } = baseEntry;
      const { devDependencies: headDevDependencies, ...headEntryRest } = headEntry;
      if (!isAllowedDependencyRangeChange(baseDevDependencies, headDevDependencies, bumpedVersionsByName)) return false;
      if (JSON.stringify(baseEntryRest) !== JSON.stringify(headEntryRest)) return false;
      continue;
    }

    if (JSON.stringify(baseEntry) !== JSON.stringify(headEntry)) return false;
  }

  return true;
}

/**
 * Was this deleted `.changesets/<slug>.md` file (its content AT BASE,
 * before deletion) at least a CANDIDATE for legitimate consumption --
 * every package it names is a member of `bumpedPackageDirs`? Parses
 * `baseContent` with scripts/collect-changesets.mjs's own
 * `parseChangesetText()` (reused, not reimplemented -- the SAME rules
 * that gate what a changeset is allowed to say at all). A changeset that
 * fails to parse at all, that names zero packages, or that names even ONE
 * package outside the bumped set, is refused outright here.
 *
 * THIS ALONE DOES NOT PROVE THE CHANGESET WAS ACTUALLY CONSUMED (re-review,
 * https://github.com/clossys/foundry/pull/1353#issuecomment-5803854341 --
 * membership is necessary but not sufficient)
 * -------------------------------------------------------------------------
 * `bumpedPackageDirs` includes EVERY package whose version changed in this
 * diff for ANY reason, so membership alone cannot distinguish a genuinely
 * consumed changeset from an unrelated, still-pending one that merely
 * happens to name a package this diff also bumped for some other reason.
 * An earlier round closed part of that gap with a SUBSTRING check against
 * the package's new CHANGELOG section (`section.includes(summary)`) --
 * itself spoofable (an identical-summary duplicate, a short summary that
 * is a substring of the real bullet, or the producer's own auto-generated
 * "Updated dependency ..." text reused verbatim as a fake summary all
 * passed). The real proof now lives in
 * reconstructExpectedChangelogText() below, called once per bumped
 * package from evaluateReleasePrFootprint(): it REBUILDS that package's
 * entire new CHANGELOG section, byte for byte, from EVERY deleted
 * changeset in this diff naming that package (using
 * apply-release-changesets.mjs's own `prependChangelogEntry()`, never a
 * second implementation) and requires an EXACT match against the real
 * diff. Including an illegitimate changeset in that set -- a duplicate
 * summary, a spoofed fragment, anything not genuinely part of the real
 * release -- changes the reconstructed bullet list and breaks the exact
 * match, refusing the WHOLE diff (the same "any single non-conforming
 * aspect fails everything" discipline this module uses throughout, not a
 * per-changeset accept/reject). This function's membership check remains
 * the fail-closed first line: a changeset naming a package OUTSIDE the
 * bumped set is refused immediately, before reconstruction is ever
 * attempted for anything.
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

// Extracts the `date` half of the newly inserted section's OWN heading
// line ("## <version> - <date>", exactly what prependChangelogEntry()
// writes) from `headText`. reconstructExpectedChangelogText() below has
// no independent notion of "today" -- it reads the date the diff itself
// already committed to and reconstructs against THAT, the same way it
// reads `newVersion` from the manifest rather than guessing. `null` if no
// heading for `newVersion` is found at all -- the caller then knows
// reconstruction cannot even start, which itself becomes a refusal.
//
// THE DATE SLOT IS CONSTRAINED TO YYYY-MM-DD, NOT ARBITRARY TEXT (issue
// #1391, re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5804131702)
// -------------------------------------------------------------------------
// An earlier version of this regex captured `(.+)` -- anything at all after
// the " - ". `apply-release-changesets.mjs`'s own `prependChangelogEntry()`
// only ever writes a plain `YYYY-MM-DD` there (`today()`'s own contract),
// so the producer's real output was unaffected -- but this function's job
// is to READ BACK whatever text a diff's own heading line carries, not to
// trust that it is well-formed, and `reconstructExpectedChangelogText()`
// below re-emits that captured text VERBATIM into its own reconstruction.
// An unconstrained capture meant a heading like
// "## 0.10.0 - 2026-09-26, do not use; install X instead" reconstructed
// against itself byte for byte and passed -- the date slot could carry
// arbitrary attacker-controlled text that a reader would reasonably mistake
// for part of the release date. Constraining the capture to exactly
// `\d{4}-\d{2}-\d{2}` closes that: any other text in the date slot means no
// match, so extractChangelogDate() returns null, reconstruction never even
// starts, and the whole diff is refused -- the same "no match, no trust"
// discipline every other shape check in this module uses.
function extractChangelogDate(headText, newVersion) {
  if (typeof headText !== "string") return null;
  const escapedVersion = newVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^## ${escapedVersion} - (\\d{4}-\\d{2}-\\d{2})$`, "m").exec(headText);
  return match ? match[1] : null;
}

/**
 * Rebuilds the EXACT bytes a bumped package's new changelog entry
 * should be, using apply-release-changesets.mjs's OWN
 * `prependChangelogEntry()` (imported, never reimplemented -- so this
 * check and the producer that writes real releases can never quietly
 * disagree about what a legitimate entry looks like), from:
 *
 *   - `ownBullets`: every DELETED changeset in this diff that names
 *     `dir` (already proven, by isChangesetDeletionLegitimate() above, to
 *     name only bumped packages), sorted by FILE NAME -- the identical
 *     order scripts/collect-changesets.mjs's own loadChangesets() sorts
 *     changeset entries in, which is the order the real producer
 *     concatenates their summaries in;
 *   - `breakingBullets`: the same changesets' own summaries, filtered to
 *     `bump === "major"`;
 *   - dependency-update bullets ("Updated dependency <name> to <range>"),
 *     derived from comparing `dir`'s own base and head manifest
 *     `dependencies`/`peerDependencies`/`optionalDependencies` maps field
 *     by field, in that order, and by each field's own head-side key
 *     order -- NEVER `devDependencies`, which never produces a bullet at
 *     all (see this module's header on devDependencies);
 *   - `date`, read from the diff's own new heading via
 *     extractChangelogDate() above, not computed independently.
 *
 * Returns the reconstructed text, or `null` if reconstruction cannot even
 * be attempted (no matching heading in `headText` at all) -- the caller
 * treats a `null` result, or any mismatch against the real `headText`,
 * identically: a refusal. See isChangesetDeletionLegitimate()'s own
 * header for why a byte-for-byte rebuild, not a text-containment check,
 * is what proves a changeset was genuinely consumed.
 */
function reconstructExpectedChangelogText({ status, baseText, headText, newVersion, deletedChangesetsForDir, baseManifestJson, headManifestJson }) {
  const date = extractChangelogDate(headText, newVersion);
  if (date === null) return null;

  const ownBullets = deletedChangesetsForDir.map((c) => c.summary);
  const breakingBullets = deletedChangesetsForDir.filter((c) => c.bump === "major").map((c) => c.summary);

  const dependencyUpdateBullets = [];
  for (const section of DEPENDENCY_RANGE_SECTIONS) {
    const baseMap = (baseManifestJson && typeof baseManifestJson[section] === "object" && baseManifestJson[section]) || {};
    const headMap = (headManifestJson && typeof headManifestJson[section] === "object" && headManifestJson[section]) || {};
    for (const name of Object.keys(headMap)) {
      if (baseMap[name] !== headMap[name]) dependencyUpdateBullets.push(`Updated dependency ${name} to ${headMap[name]}`);
    }
  }

  const bullets = [...ownBullets, ...dependencyUpdateBullets];
  return prependChangelogEntry(status === "added" ? null : baseText, { version: newVersion, date, bullets, breakingBullets });
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
 *      for cross-referencing a changelog/changeset against ITS OWN
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
 *      pass 1 -- a changelog is checked against ITS OWN package's
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
  // Maps each bumped package's npm NAME to the exact fields the lockfile
  // check cross-references against -- see isLockfilePureVersionBump()'s own
  // header, "THE LOCKFILE MUST MIRROR THE MANIFEST" (re-review,
  // https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726).
  // Built from the SAME parsed headJson this loop already validated as a
  // legitimate single-step bump -- never trusted from the lockfile itself.
  const bumpedManifestsByName = {};
  // dir -> { baseJson, headJson } for every BUMPED packages/<dir>/package.json
  // -- reconstructExpectedChangelogText() below reads dependency-map
  // changes straight from these, the SAME parsed JSON this loop already
  // validated, rather than re-parsing or trusting anything derived.
  const manifestJsonByDir = {};
  // packages/<dir>/package.json files that did NOT bump their own version
  // -- deferred rather than refused immediately, because a package.json in
  // this SHAPE is legal for exactly one reason (a devDependencies-only
  // sibling-range rewrite, see this file's module header and
  // isDevDependenciesOnlyRewrite()'s own header) and validating that needs
  // `bumpedVersionsByName` fully populated from every OTHER package.json in
  // this SAME diff first -- which this loop is still in the middle of
  // building. Checked in a second pass below, once this loop finishes.
  const unbumpedManifestFiles = [];
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
      unbumpedManifestFiles.push({ file, dir: match[1] });
      continue;
    }
    bumpedVersions[match[1]] = headVersion;
    manifestJsonByDir[match[1]] = { baseJson, headJson };
    if (typeof headJson.name === "string" && headJson.name.length > 0) {
      bumpedVersionsByName[headJson.name] = headVersion;
      bumpedManifestsByName[headJson.name] = {
        version: headVersion,
        dependencies: headJson.dependencies,
        peerDependencies: headJson.peerDependencies,
        optionalDependencies: headJson.optionalDependencies,
        devDependencies: headJson.devDependencies,
      };
    }
  }

  const bumpedDirs = Object.keys(bumpedVersions);
  if (bumpedDirs.length === 0) {
    return { ok: false, reason: "no packages/<dir>/package.json version bump present" };
  }

  // DEVDEPENDENCIES-ONLY REWRITES (decision + fix, re-review,
  // https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726)
  // -------------------------------------------------------------------------
  // Every deferred package.json above must now prove it is a legitimate
  // devDependencies-only rewrite -- `bumpedVersionsByName` is fully
  // populated at this point, so isDevDependenciesOnlyRewrite() can verify
  // any rewritten entry names a package this SAME diff really bumped.
  // `devDependencyOnlyDirs` is threaded into isLockfilePureVersionBump()
  // below so a NON-bumped workspace entry's lockfile record is allowed the
  // identical devDependencies-only exception.
  const devDependencyOnlyDirs = new Set();
  // name -> { version, devDependencies } for every devDependencies-only
  // rewritten package -- threaded into isLockfilePureVersionBump() below so
  // a NON-bumped workspace entry's lockfile record is cross-checked against
  // the real manifest too, not merely proven internally consistent
  // (re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803457726
  // should-fix, closed here).
  const devDependencyOnlyManifestsByName = {};
  for (const { file, dir } of unbumpedManifestFiles) {
    if (!isDevDependenciesOnlyRewrite(file.baseContent, file.headContent, bumpedVersionsByName)) {
      return {
        ok: false,
        reason: `"${file.path}" version did not change to a single-step patch/minor/major semver bump, and is not a pure devDependencies-only sibling-range rewrite either`,
      };
    }
    devDependencyOnlyDirs.add(dir);
    const headJson = JSON.parse(file.headContent); // already proven valid JSON by isDevDependenciesOnlyRewrite() above
    if (typeof headJson.name === "string" && headJson.name.length > 0) {
      devDependencyOnlyManifestsByName[headJson.name] = { version: headJson.version, devDependencies: headJson.devDependencies };
    }
  }

  for (const file of files) {
    const match = RELEASE_PR_FILE_PATTERNS.packageManifest.exec(file.path);
    if (!match) continue;
    if (devDependencyOnlyDirs.has(match[1])) continue; // already validated above -- isPackageManifestVersionOnlyChange() requires a version bump this file deliberately does not have
    if (!isPackageManifestVersionOnlyChange(file.baseContent, file.headContent, bumpedVersionsByName)) {
      return { ok: false, reason: `"${file.path}" changes more than its own version and any allowed sibling-dependency-range rewrites` };
    }
  }

  // Built BEFORE the main per-file loop below, so a changelog's
  // reconstruction check (below) can see every deleted changeset naming
  // its package regardless of which order `files` lists them in. Sorted by
  // FILE NAME first -- the identical order scripts/collect-changesets.mjs's
  // own loadChangesets() sorts entries in, and therefore the order the real
  // producer concatenates summaries in -- THEN grouped by named directory.
  // A changeset that fails to parse, or names a package outside the bumped
  // set, is left out here; isChangesetDeletionLegitimate() in the main loop
  // below still refuses that specific file on its own account.
  const deletedChangesetsByDir = {};
  const deletedChangesetFiles = files
    .filter((f) => RELEASE_PR_FILE_PATTERNS.changeset.test(f.path) && f.status === "removed")
    .map((f) => ({ file: f, name: f.path.slice(f.path.lastIndexOf("/") + 1) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const { file, name } of deletedChangesetFiles) {
    if (typeof file.baseContent !== "string") continue;
    const result = parseChangesetText(file.baseContent, {});
    if (result.error) continue;
    for (const [dir, bump] of Object.entries(result.packages)) {
      if (!Object.prototype.hasOwnProperty.call(bumpedVersions, dir)) continue;
      (deletedChangesetsByDir[dir] ??= []).push({ file: name, summary: result.summary, bump });
    }
  }

  // Set by the lockfile branch below the moment ANY file in this diff
  // matches RELEASE_PR_FILE_PATTERNS.lockfile -- checked once, after this
  // loop, against `bumpedDirs` (issue #1331: a version bump whose diff
  // never touches package-lock.json at all has nothing for the lockfile
  // branch to run against, so without this check the footprint's silence
  // on an absent file was indistinguishable from "nothing to object to").
  let sawLockfile = false;

  // Every `dir` whose docs/changelogs/<dir>.md appears in this diff at all
  // -- checked once, after this loop, against `bumpedDirs` (issue #1389:
  // a release PR that deletes an unconsumed changeset for a bumped package
  // while leaving that package's docs/changelogs/<dir>.md OUT of the diff
  // entirely has, again, nothing here for the changelog branch below to
  // run isChangelogPureNewSection()/reconstruction against -- the loop
  // simply never visits a file that was never in the diff, and silence
  // about a missing file is not the same as nothing being wrong).
  const changelogSeenForDir = new Set();

  for (const file of files) {
    if (RELEASE_PR_FILE_PATTERNS.packageManifest.test(file.path)) continue; // already validated above

    const changelogMatch = RELEASE_PR_FILE_PATTERNS.changelog.exec(file.path);
    if (changelogMatch) {
      const dir = changelogMatch[1];
      changelogSeenForDir.add(dir);
      const expectedVersion = bumpedVersions[dir];
      if (!expectedVersion) return { ok: false, reason: `"${file.path}" changed, but packages/${dir} was not bumped in this diff` };
      if (file.status !== "modified" && file.status !== "added") return { ok: false, reason: `"${file.path}" has status "${file.status}" -- expected modified or added` };
      if (!isChangelogPureNewSection(file.status === "added" ? null : file.baseContent, file.headContent, expectedVersion)) {
        return { ok: false, reason: `"${file.path}" is not exactly one new "${expectedVersion}" section, cleanly inserted at the top` };
      }
      // THE STRONGER PROOF (re-review, https://github.com/clossys/foundry/pull/1353#issuecomment-5803854341):
      // isChangelogPureNewSection() above proves the SHAPE is clean; this
      // proves the CONTENT is exactly what this diff's own consumed
      // changesets and dependency-range rewrites should have produced --
      // see reconstructExpectedChangelogText()'s own header.
      const expectedChangelog = reconstructExpectedChangelogText({
        status: file.status,
        baseText: file.baseContent,
        headText: file.headContent,
        newVersion: expectedVersion,
        deletedChangesetsForDir: deletedChangesetsByDir[dir] ?? [],
        baseManifestJson: manifestJsonByDir[dir]?.baseJson,
        headManifestJson: manifestJsonByDir[dir]?.headJson,
      });
      if (expectedChangelog === null || expectedChangelog !== file.headContent) {
        return {
          ok: false,
          reason: `"${file.path}" does not byte-for-byte match the CHANGELOG entry reconstructed from this diff's own consumed changesets and dependency-range rewrites`,
        };
      }
      continue;
    }

    if (RELEASE_PR_FILE_PATTERNS.lockfile.test(file.path)) {
      sawLockfile = true;
      if (file.status !== "modified") return { ok: false, reason: `"${file.path}" has status "${file.status}" -- expected modified` };
      if (!isLockfilePureVersionBump(file.baseContent, file.headContent, bumpedDirs, bumpedVersionsByName, bumpedManifestsByName, devDependencyOnlyDirs, devDependencyOnlyManifestsByName)) {
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

  // ABSENT LOCKFILE IS A REFUSAL, NOT SILENCE (issue #1331)
  // -----------------------------------------------------------------------
  // `bumpedDirs` is non-empty by construction at this point (checked right
  // after PASS 1 above). Every one of those bumps came from a real
  // `packages/<dir>/package.json` version change this diff makes, and
  // scripts/apply-release-changesets.mjs -- the only producer this shape is
  // ever checked against -- always regenerates package-lock.json in the
  // same run whenever it applies anything at all. A diff that bumps a
  // manifest's version but never touches package-lock.json in the same
  // diff (`sawLockfile` stays false) skipped that regeneration -- the
  // per-file loop above had nothing to run isLockfilePureVersionBump()
  // against, because there was no lockfile FILE to run it against, and
  // silently having "no opinion" about a missing file is exactly the gap
  // this closes: the footprint's whole job is to prove a diff is NOTHING
  // MORE than the producer's shape, and a diff with no lockfile change at
  // all is missing a piece the producer always writes, not merely quiet
  // about one. (check-lock-workspace-versions.mjs already refuses this
  // shape too, independently, in CI's separate "workspace link integrity"
  // job -- this is defense in depth for the SAME gap inside this module,
  // not the only place it is caught.)
  if (!sawLockfile) {
    return {
      ok: false,
      reason: `package-lock.json is absent from the diff, but ${bumpedDirs.map((d) => `packages/${d}`).join(", ")} bumped a version in this diff -- a release PR must regenerate the lockfile in the same diff`,
    };
  }

  // ABSENT CHANGELOG IS A REFUSAL, NOT SILENCE (issue #1389)
  // -----------------------------------------------------------------------
  // Same shape as the absent-lockfile check just above: `bumpedDirs` is
  // non-empty by construction, and apply-release-changesets.mjs -- the
  // only producer this shape is ever checked against -- always writes a
  // docs/changelogs/<dir>.md entry for every package it bumps, named or
  // dependent-only alike. A dir bumped in this diff whose changelog was
  // never touched at all (`changelogSeenForDir` stays without it) means a
  // release PR could delete an unconsumed changeset for that package while
  // leaving its changelog out of the diff entirely -- silently discarding
  // the pending change with no note of it anywhere -- and every OTHER gate
  // (isChangesetDeletionLegitimate() above included) has nothing to object
  // to, because none of them require the changelog FILE to be present, only
  // that IF one is present it reconstructs correctly.
  const bumpedDirsMissingChangelog = bumpedDirs.filter((d) => !changelogSeenForDir.has(d));
  if (bumpedDirsMissingChangelog.length > 0) {
    return {
      ok: false,
      reason: `${bumpedDirsMissingChangelog.map((d) => changelogRelPathFor(d)).join(", ")} absent from the diff, but ${bumpedDirsMissingChangelog.map((d) => `packages/${d}`).join(", ")} bumped a version in this diff -- a release PR must add or update the changelog entry in the same diff`,
    };
  }

  return { ok: true, reason: "every changed file is release-PR shaped" };
}
