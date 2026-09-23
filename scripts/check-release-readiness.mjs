#!/usr/bin/env node
// check-release-readiness — did a package's published surface move since the
// point this change is being compared against, without the version moving
// too?
//
//   node scripts/check-release-readiness.mjs [--json] [--base <ref>] [<packageDir> ...]
//   node scripts/check-release-readiness.mjs --audit [--json] [<packageDir> ...]
//
// With no positional arguments, every packages/*/package.json in this repo
// is checked. Exit 0 = every checked package's version already covers what
// it would ship. Exit 1 = at least one package needs a version bump. Exit 2
// = the check could not be completed for at least one package (a git or npm
// failure, not a verdict — the same three-way split every gate in this repo
// uses).
//
// DEFAULT MODE ALSO CONSULTS THE RETAINED QUALIFICATION RECORD (issue #920,
// reported not enforced for unpacked-only drift as of the owner decision at
// issues #1187 / #1265)
// ---------------------------------------------------------------------------
// "No packed-file changes" is not the whole answer to "is the retained
// record for this version still accurate." A package can have no
// packed-content diff at all (this function's own `pass` verdict) while its
// CURRENT version's retained qualification record has already gone stale —
// the package directory moved (tests included) even though nothing PACKED
// moved. That happened for real and burned `@clossys/architect@0.1.7`, which
// could never be published: see `staleRetainedRecordDiagnosis()` below for
// the incident and why the two gates (this one comparing packed content,
// check-qualification-record-present.mjs comparing the whole tree) are each
// correct about what they measure.
//
// Issue #920's original fix treated ANY staleness here — packed or not — as
// a reason to fail this gate with `needs-bump`. The owner cadence rule
// (#1187 comment 5799002037) says a test, CI, or internal-docs-only change
// carries no changeset and causes no release; PR #1265's verification (see
// comment 5799141814) found the #920 fix violated that rule, because
// `packageTreeSha1` covers the whole package tree, so a test-only edit alone
// staled the record and forced a changeset for content nobody was
// publishing. The resolution (docs/PUBLISHING.md's "A retained record binds
// the whole tree..." section) keeps the record's own definition of
// staleness exactly as it was (this script never changes how a record is
// computed or validated) but narrows when unpacked-only staleness is a BUMP
// question, scoped to a second-opinion review's correction of this PR's
// first pass: it is reported in the `detail` string, with
// `staleRetainedRecord: true`, so the operator always sees it, but
// `evaluatePackageDiff()` only stops failing on it (`pass` instead of
// `needs-bump`) when `hasLocalPublicationEvidence()` shows the CURRENT
// version has ALREADY been published. For a qualified-but-unpublished
// version — most of them, today; publication is gated off entirely pre-W1E
// — this stays exactly as strict as #920's original fix, because an
// unpacked-only change to one of THOSE would otherwise silently and
// permanently strand a queued release with nothing forcing the new version
// that alone could recover it (records are immutable — see
// `staleRetainedRecordDiagnosis()` below). A stale record never lets
// anything ship either way: check-qualification-record-present.mjs and
// publish.yml's record-join are untouched and still compare the retained
// record against the whole tree at dispatch time.
//
// BUILD INPUTS COUNT AS PACKED (owner decision #1187/#1265, point 2)
// --------------------------------------------------------------------
// "No packed-file changes" is ALSO not the whole answer to "did the
// compiled output change" — `npm pack` never ships `tsconfig.json`, but
// every package here builds with `tsc -p tsconfig.json`, so a build-config
// edit (or a `typescript` devDependency bump) can change `dist/` with zero
// packed-source difference. See `buildInputFiles()` and
// `BUILD_TOOLCHAIN_DEV_DEPENDENCIES` below for the two places this is
// checked.
//
// THE devDependencies EXEMPTION (default mode only — see issue #269)
// --------------------------------------------------------------------
// A dependency-bump pull request (Dependabot or otherwise) that touches only
// `devDependencies` in `package.json`, with nothing else in the tarball
// changed, does not require a version bump: `devDependencies` shapes how the
// package is built and tested, never what a consumer receives when they
// install it. Any change to `dependencies`, `peerDependencies`,
// `optionalDependencies`, `version`, `exports`, `files`, any other manifest
// field, or any file besides `package.json` still requires one — see
// `isDevDependenciesOnlyChange()` below for the exact rule. This is a
// what-changed check, not a who-changed-it check: there is deliberately no
// bot-author exemption, so a human PR touching only devDependencies is
// exempt too, and a bot PR touching a runtime dependency is not.
//
// WHY THIS EXISTS
// ---------------
// scripts/select-publishable-packages.mjs's `discover` job decides what the
// Publish workflow actually uploads. As of issue #416 it selects by
// registry-versus-manifest (does the registry already have this exact
// version?), not by diffing one push — but that change only closed the
// eviction gap; it did nothing for a package whose SOURCE changed with no
// version bump at all, because a same-version manifest still looks
// identical to the registry regardless of which selection mechanism is
// asking. A package in that state produces an empty matrix and publishes
// NOTHING, silently, exactly as it always has. That happened for real: a
// consumer integration surfaced eight behavioural fixes across six packages
// that merged to main with no version bump, so the selector's matrix was
// empty, `publish` was skipped, and the fixes sat on main invisible to
// consumers for a day with nothing anywhere reporting it (issue #156).
// "Merged" and "consumable" were two different, unannounced states. This
// script is the check that makes that gap visible BEFORE merge, so it can't
// recur silently — see the `release-readiness` job it is wired into in
// .github/workflows/ci.yml.
//
// This is a PRE-MERGE, diff-scoped proxy for one narrow question — did THIS
// pull request change a package's shipped content without also bumping its
// version? It is deliberately independent of, and does not replace,
// scripts/check-registry-parity.mjs's POST-MERGE reconciliation against the
// live registry: that gate answers "did an already-bumped version actually
// arrive at the registry", which this one cannot, because a version that
// merges here has not been published anywhere yet to check against.
//
// DEFAULT MODE: diffed against the merge base
// ------------------------------------------------------------------------
// The default check asks a version of the same question
// select-publishable-packages.mjs used to ask on a push to main before
// #416 — did this package's version change between two fixed points? —
// using the SAME two points a pull request is actually being merged
// across: `git merge-base <base> HEAD` and HEAD/working tree.
// `--base` names the comparison point (a ref or a commit); it defaults to
// `origin/main`, falling back to a local `main` branch when no `origin`
// remote is configured (so this stays runnable offline, with no network).
// CI passes the pull request's real base SHA — see the workflow.
//
// This is diff-scoped and has NO false positives by construction: if the
// package's version already differs at HEAD from its version at the merge
// base, whatever changed is covered, full stop, regardless of what the
// package's OWN history looked like before the merge base. That last clause
// is exactly what the older, whole-repo AUDIT mode below got wrong for a
// real package in this repo (see AUDIT MODE'S BLIND SPOT).
//
// AUDIT MODE (`--audit`): a heuristic, not a verdict — read this before using it
// --------------------------------------------------------------------------------
// `--audit` answers a different, weaker question across the WHOLE repository,
// independent of any pull request: "has this package's packed content
// changed since the commit that last set its CURRENT version, with no
// further version change since?" It answers that by walking back from HEAD
// to find the OLDEST commit in the unbroken run of commits that all carry
// the current version (not just the newest commit that touched the
// manifest — see findBumpCommit's own comment for why), then diffing packed
// content between that commit and the working tree.
//
// AUDIT MODE'S BLIND SPOT: it has no way to see the npm registry, so it
// cannot tell "this version was never published" apart from "this version
// WAS published, after these very edits landed." Those look identical from
// inside a git checkout. This is not theoretical — it happened in this
// repository: `@example/comms` was bumped to 0.1.0, THEN edited
// twice more (still at 0.1.0), and 0.1.0 was published to the registry only
// AFTER those edits — so the published tarball already contains everything
// audit mode flags. Audit mode reports `comms` as needing a bump anyway,
// because from a pure git-history standpoint it cannot distinguish that
// sequence from PR #155's actual failure (bump, edit, edit, NEVER publish).
// A default-mode run scoped to any pull request whose merge base is at or
// after those edits reports `comms` clean, because nothing changed relative
// to that PR's own comparison point — which is the question that actually
// matters for gating a merge.
//
// Given that blind spot, `--audit` is NOT wired into CI (see the workflow's
// own comment) and is offered for manual, whole-repo investigation only —
// treat any `--audit` finding as "worth checking against the registry by
// hand," not as a merge-blocking verdict.
//
// WHAT COUNTS AS "PUBLISHED SURFACE" (both modes)
// -----------------------------------
// Not the git tree, and not a hand-rolled reading of the `files` field's
// glob-with-negation syntax: `npm pack --dry-run --json` is asked, on BOTH
// sides of the comparison, and its own file list is trusted. That is the
// same authority scripts/check-artifact-safety.mjs defers to, for the same
// reason — guessing at negation-pattern semantics is exactly how a package
// ships (or fails to ship) something nobody meant.
//
// dist/ is deliberately excluded from the comparison on both sides, and this
// is NOT the blind spot check-artifact-safety.mjs exists to close. dist/ is
// gitignored, so it is never present in ANY commit this script can
// git-archive out of history — there is no "old dist/" to diff against
// without actually invoking the build, and this check is not in the
// business of doing that: it needs to run in seconds, before build, on
// every pull request. Every package here ships src/ alongside dist/
// specifically so a source-level proxy exists for exactly this reason —
// dist/ is deterministic output of src/, so a real change to what would
// ship is caught upstream, in src/, every time. (check-artifact-safety.mjs's
// blind spot is the opposite shape: dist/ hiding CONTENT the tree scan never
// reads. Here dist/ can't be fairly compared at all, in either direction,
// because history never had it.)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  identityState,
  isIdentityTransitionControlSurface,
  lineDigest,
  loadTransitionPolicy,
  planIdentityTransition,
  validateHistoryInventory,
} from "./lib/package-identity-transition.mjs";
import { qualificationRecordPresenceForCandidate } from "./check-qualification-record-present.mjs";
import { changesetsForPackage, loadChangesets } from "./collect-changesets.mjs";
// Only the path CONSTANTS are imported here, never the heavy validators
// these two modules also export (`readValidatedLaterPublishedPackages`,
// and `check-package-evidence.mjs`'s `readValidatedPublishedPackages` which
// composes both) — see `hasLocalPublicationEvidence()` below for why this
// gate cannot afford to run that full proof chain.
import { TRIO_PUBLICATION_PATH } from "./lib/release-publication-cohort.mjs";
import { LATER_PUBLICATION_DIRECTORY } from "./lib/release-later-publication.mjs";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// Runs the real packer against a real directory and returns the set of paths
// it would ship, minus dist/ (see header comment). `--dry-run` never invokes
// lifecycle scripts (verified empirically: a probe package with a failing
// `prepublishOnly` still packs clean under `--dry-run`) and reads nothing
// from node_modules, so this works unmodified against a bare git-archive
// extraction that has never seen `npm install`.
//
// Reads every file's CONTENT eagerly, into the returned Map, rather than
// handing back paths to read later — packedFilesAtCommit() below calls this
// against a throwaway extraction it deletes as soon as it returns, so a
// lazy path would already be pointing at nothing by the time diffPackedFiles()
// got around to reading it.
function packedFiles(dir) {
  let out;
  try {
    out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(`npm pack --dry-run failed in ${dir}: ${(error.stderr ?? error.message).toString().trim()}`);
  }
  let entry;
  try {
    [entry] = JSON.parse(out);
  } catch {
    throw new Error(`npm pack --dry-run --json produced unparseable output in ${dir}`);
  }
  const files = new Map();
  for (const f of entry.files) {
    if (f.path === "dist" || f.path.startsWith("dist/")) continue;
    files.set(f.path, readFileSync(join(dir, ...f.path.split("/"))));
  }
  return files;
}

// Snapshots `relPkgDir` as it stood at `commit` into a throwaway extraction
// and hands the extracted package directory to `read(dir)` — shared by
// `packedFilesAtCommit()` (reads via `npm pack --dry-run`) and
// `buildInputFilesAtCommit()` (reads tsconfig*.json directly) below, so a
// commit is archived and extracted once per caller rather than duplicating
// the tar dance for each kind of file this script now diffs. Cleans up its
// own temp dir before returning.
function extractedPackageAtCommit(gitRoot, relPkgDir, commit, read) {
  const workDir = mkdtempSync(join(tmpdir(), "release-readiness-"));
  try {
    const archivePath = join(workDir, "archive.tar");
    git(["archive", "--format=tar", "-o", archivePath, commit, "--", relPkgDir || "."], gitRoot);
    const extractDir = join(workDir, "extracted");
    mkdirSync(extractDir, { recursive: true });
    execFileSync("tar", ["-xf", archivePath, "-C", extractDir], { stdio: ["ignore", "pipe", "pipe"] });
    const oldPkgDir = join(extractDir, ...relPkgDir.split("/"));
    if (!existsSync(join(oldPkgDir, "package.json"))) {
      throw new Error(`${relPkgDir || "."} had no package.json at ${commit.slice(0, 12)}`);
    }
    return read(oldPkgDir);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// Purely so `npm pack --dry-run` can be pointed at a historical commit — see
// header comment for why the comparison happens at the pack layer rather
// than by hand-walking `files` globs.
function packedFilesAtCommit(gitRoot, relPkgDir, commit) {
  return extractedPackageAtCommit(gitRoot, relPkgDir, commit, packedFiles);
}

// BUILD INPUTS COUNT AS PACKED (owner decision #1187/#1265, point 2)
// --------------------------------------------------------------------
// `packedFiles()` above is deliberately source-level and trusts `npm pack`'s
// own file list — but that list, by design, never includes `tsconfig.json`
// (or a sibling `tsconfig.*.json`): it drives the build, it is not shipped.
// Every package here builds with `tsc -p tsconfig.json` (verified directly
// against every `packages/*/package.json`'s own `scripts.build`), so a
// `tsconfig.json` edit — `target`, `module`, `lib`, `strict`, anything the
// compiler reads — can change the compiled `dist/` a consumer receives with
// `src/` completely untouched, which is exactly the "dist/ is deterministic
// output of src/" premise the header comment's dist/-exclusion rests on. It
// breaks silently: `diffPackedFiles()` sees nothing, because nothing packed
// moved. So a build input is read and diffed as its own axis, independent of
// `packedFiles()`, and `evaluatePackageDiff()` below treats any difference
// on it exactly like a packed-content change for the bump question — see
// `isDevDependenciesOnlyChange()`'s `BUILD_TOOLCHAIN_DEV_DEPENDENCIES` carve-out
// for the parallel case (a build-TOOL version, not a build-config file).
//
// GENERAL CASE: A LOCAL SCRIPT `scripts.build` INVOKES DIRECTLY (owner
// decision #1187/#1265, Opus re-review at 6f6372c7)
// --------------------------------------------------------------------
// `tsconfig.json` is not the only build input `npm pack` never ships.
// `@clossys/launcher`'s `scripts.build` is
// `node scripts/pack-skills.mjs && tsc -p tsconfig.json` — `pack-skills.mjs`
// itself is not packed (`scripts/` is not in launcher's `files`), but it
// GENERATES `skill-catalogue/`, which IS packed (and gitignored, like
// `dist/`). So an edit to `pack-skills.mjs` alone changes what a consumer
// installs with no packed-file trace — the identical blind spot
// `tsconfig.json` has, one layer removed. Fixed generally, not only for
// launcher: `buildScriptInvokedFiles()` below parses ANY package's
// `scripts.build` for the local script files it runs directly, and those
// are read and diffed exactly like `tsconfig*.json`.
function buildScriptInvokedFiles(buildScript) {
  if (typeof buildScript !== "string") return [];
  const paths = [];
  // Not a shell parser — split only on the boundaries a build script can
  // safely be split on (`&&`, `;`, `|`), and recognize only a bare
  // `node <relative-path>` invocation, which is what every build script in
  // this repository actually uses. A build script shaped more exotically
  // than that (a wrapper binary, an inline `-e` snippet) contributes no
  // extra paths here — this narrows the existing tsconfig*.json check, it
  // never claims to parse every possible build script.
  for (const segment of buildScript.split(/&&|;|\|/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    if (words.length < 2 || words[0] !== "node") continue;
    for (const arg of words.slice(1)) {
      if (arg.startsWith("-")) continue; // a node flag, not a script path
      if (arg.includes("..")) break; // never resolve outside the package directory
      if (/\.(mjs|cjs|js|ts)$/.test(arg) && !arg.startsWith("/")) paths.push(arg);
      break; // the first non-flag argument is the script node runs
    }
  }
  return paths;
}

function buildInputFiles(dir) {
  const out = new Map();
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/^tsconfig(\.[\w-]+)?\.json$/.test(entry.name)) continue;
    out.set(entry.name, readFileSync(join(dir, entry.name)));
  }
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    // No readable manifest here — buildScriptInvokedFiles(undefined) below
    // returns [], so this just contributes tsconfig*.json, same as before.
  }
  for (const relPath of buildScriptInvokedFiles(manifest?.scripts?.build)) {
    try {
      out.set(relPath, readFileSync(join(dir, ...relPath.split("/"))));
    } catch {
      // Named but unreadable/absent on this side — diffPackedFiles() below
      // reports that as added/removed itself; nothing to do here.
    }
  }
  return out;
}

function buildInputFilesAtCommit(gitRoot, relPkgDir, commit) {
  return extractedPackageAtCommit(gitRoot, relPkgDir, commit, buildInputFiles);
}

// Structural equality, key-order independent — used below to compare two
// package.json manifests with `devDependencies` stripped out of both, so a
// change that merely reordered an unrelated field (or was re-serialized with
// different key order upstream) can never masquerade as "nothing else
// changed." Plain values compare with `===` (which also covers `NaN !==
// NaN`, matching JSON's own equality — `NaN` cannot occur in parsed JSON at
// all, so that's moot, but it keeps this correct as a general-purpose
// helper); objects/arrays compare recursively by key set.
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

// THE devDependencies EXEMPTION
// ------------------------------
// Operator decision (issue #269): a dependency bump PR the bot cannot itself
// version-bump should not be permanently unmergeable. The narrowest correct
// exemption is drawn at what actually ships: a `devDependencies` edit changes
// how the package is built and tested, never what a consumer receives when
// they install it, so it does not need a version bump. Every other kind of
// manifest change — `dependencies`, `peerDependencies`,
// `optionalDependencies`, `version`, `exports`, `files`, anything else in the
// manifest, or any change to a file besides `package.json` — genuinely can
// alter shipped content and must keep requiring one. This is deliberately
// NOT an author check (no `dependabot[bot]` special case): the question is
// what changed, never who changed it, matching the working rule this issue
// records.
//
// BUILD-TOOLCHAIN CARVE-OUT (owner decision #1187/#1265, point 2)
// -------------------------------------------------------------------
// The devDependencies exemption above assumes "how the package is built"
// and "what a consumer receives" are independent — true for a test runner
// or a lint config, false for the compiler itself. Every package here
// builds with `tsc -p tsconfig.json` (see `buildInputFiles()`'s header
// comment for the same measurement), so a `typescript` version bump can
// change the compiled `dist/` a consumer receives — a stricter or looser
// default under a new TypeScript release is exactly this shape — with
// `src/` and every other packed file untouched. Enumerated directly from
// what every package's own build script invokes, not guessed: only the
// compiler binary itself changes emitted output; a type-only package like
// `@types/node` affects type-CHECKING, never what `tsc` emits. A
// devDependency named here disqualifies the whole change from the
// exemption, the same fail-closed way a `dependencies` edit already does.
const BUILD_TOOLCHAIN_DEV_DEPENDENCIES = new Set(["typescript"]);

// Returns true only when `changed` names package.json and NOTHING else, and
// the two manifests are structurally identical except for
// `devDependencies` (which must itself actually differ — a package.json that
// was merely re-saved by a formatter with no field changed at all is not
// something this function is asked to classify; `changed` already being
// non-empty means diffPackedFiles() saw different bytes, so in practice this
// only returns false there for a change this function correctly refuses to
// call devDependencies-only), and none of the devDependencies that actually
// changed are in `BUILD_TOOLCHAIN_DEV_DEPENDENCIES`. Returns false for every
// other shape, INCLUDING when the manifests fail to parse as JSON — a parse
// failure is "cannot prove this is exempt," not "assume it is," so the
// caller falls through to requiring a bump, the fail-closed side.
function isDevDependenciesOnlyChange(changed, oldFiles, newFiles) {
  if (changed.length !== 1 || changed[0] !== "modified: package.json") return false;

  let oldManifest, newManifest;
  try {
    oldManifest = JSON.parse(oldFiles.get("package.json").toString("utf8"));
    newManifest = JSON.parse(newFiles.get("package.json").toString("utf8"));
  } catch {
    return false;
  }
  if (typeof oldManifest !== "object" || oldManifest === null) return false;
  if (typeof newManifest !== "object" || newManifest === null) return false;

  const { devDependencies: oldDevDeps, ...oldRest } = oldManifest;
  const { devDependencies: newDevDeps, ...newRest } = newManifest;
  if (!deepEqual(oldRest, newRest)) return false;

  const oldDD = oldDevDeps ?? {};
  const newDD = newDevDeps ?? {};
  if (deepEqual(oldDD, newDD)) return false;

  const changedDevDependencyNames = new Set([...Object.keys(oldDD), ...Object.keys(newDD)].filter((name) => oldDD[name] !== newDD[name]));
  for (const name of changedDevDependencyNames) {
    if (BUILD_TOOLCHAIN_DEV_DEPENDENCIES.has(name)) return false;
  }
  return true;
}

// Set-compares two packedFiles() maps (path -> file content Buffer) and
// returns a sorted, human-labelled list of everything that differs. Shared
// by both modes — only WHICH commit supplies `oldFiles` differs between
// them. Content is already in memory (see packedFiles()'s own comment), so
// this never touches the filesystem — it cannot be affected by either
// side's temp directory having already been cleaned up.
function diffPackedFiles(oldFiles, newFiles) {
  const changed = [];
  for (const p of new Set([...oldFiles.keys(), ...newFiles.keys()])) {
    const inOld = oldFiles.has(p);
    const inNew = newFiles.has(p);
    if (inOld && !inNew) changed.push(`removed: ${p}`);
    else if (!inOld && inNew) changed.push(`added: ${p}`);
    else if (!oldFiles.get(p).equals(newFiles.get(p))) changed.push(`modified: ${p}`);
  }
  return changed.sort();
}

const transitionStateCache = new Map();

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fileAtCommit(gitRoot, commit, path) {
  const rel = relative(gitRoot, path).split("\\").join("/");
  return git(["show", `${commit}:${rel}`], gitRoot);
}

function exactCandidateHistoryFindings(gitRoot, policy) {
  const inventory = readJson(join(gitRoot, policy.historyInventory));
  const findings = validateHistoryInventory(inventory, policy);
  const expected = new Set(inventory.references.map((item) => `${item.path}\0${item.lineSha256}`));
  const observed = new Set();
  const needles = [policy.current.scope, policy.current.registry, policy.current.repository];
  const paths = git(["ls-files", "-z"], gitRoot).split("\0").filter(Boolean);
  for (const path of paths) {
    if (isIdentityTransitionControlSurface(path)) continue;
    const text = readFileSync(join(gitRoot, path), "utf8").replace(/[\u0000\u200B\u200C\u200D\u2060\u180E\u00AD\uFEFF]/g, "");
    for (const line of text.split(/\r?\n/)) {
      if (!needles.some((needle) => line.includes(needle))) continue;
      const key = `${path}\0${lineDigest(line)}`;
      observed.add(key);
      if (!expected.has(key)) findings.push(`${path}: unclassified historical identity line`);
    }
  }
  for (const key of expected) if (!observed.has(key)) findings.push(`unused historical identity record: ${key.split("\0")[0]}`);
  return [...new Set(findings)];
}

function exactTransitionState(gitRoot, mergeBase) {
  const cacheKey = `${gitRoot}\0${mergeBase}`;
  if (transitionStateCache.has(cacheKey)) return transitionStateCache.get(cacheKey);
  let result;
  try {
    const policyPath = join(gitRoot, "governance", "package-identity-transition.json");
    const policy = loadTransitionPolicy(policyPath);
    const baseScope = JSON.parse(fileAtCommit(gitRoot, mergeBase, join(gitRoot, "package-scope.json")));
    const candidateScope = readJson(join(gitRoot, "package-scope.json"));
    if (identityState(baseScope, policy) !== "current" || identityState(candidateScope, policy) !== "candidate" || policy.candidate.access !== "public") {
      throw new Error("base/current package identity declarations are not the exact reviewed current-to-public-candidate tuple");
    }

    // Returning an empty plan in candidate state is itself a full structured
    // validation: all manifests, dependency maps, lock workspace joins/local
    // links, release catalogue, registry, repository and public-access fields
    // must agree with the closed candidate policy.
    if (planIdentityTransition({ root: gitRoot, policy }).length !== 0) {
      throw new Error("candidate structured state still has unapplied transition changes");
    }

    const projected = planIdentityTransition({
      root: gitRoot,
      policy,
      readFile: (path, encoding) => fileAtCommit(gitRoot, mergeBase, path),
    });
    const packageDirectories = readdirSync(join(gitRoot, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(gitRoot, "packages", entry.name, "package.json")))
      .map((entry) => entry.name)
      .sort();
    const required = new Set([
      "package-scope.json",
      "package-lock.json",
      "governance/release-catalog.json",
      ...packageDirectories.map((directory) => `packages/${directory}/package.json`),
    ]);
    const projectedPaths = new Set();
    for (const change of projected) {
      const rel = relative(gitRoot, change.path).split("\\").join("/");
      projectedPaths.add(rel);
      if (readFileSync(change.path, "utf8") !== change.after) throw new Error(`${rel} is not the exact projected candidate bytes`);
    }
    if (projectedPaths.size !== required.size || [...required].some((path) => !projectedPaths.has(path))) {
      throw new Error("the transition does not project the complete manifest/lock/catalog/declaration set");
    }

    const historyFindings = exactCandidateHistoryFindings(gitRoot, policy);
    if (historyFindings.length) throw new Error(historyFindings.join("; "));

    const lifecycle = readJson(join(gitRoot, "docs", "contracts", "package-lifecycle.json"));
    if (!Array.isArray(lifecycle.packages)) throw new Error("package lifecycle has no packages array");
    result = { ok: true, policy, packageDirectories: new Set(packageDirectories), lifecycle };
  } catch (error) {
    result = { ok: false, detail: error.message };
  }
  transitionStateCache.set(cacheKey, result);
  return result;
}

function exactIdentityTransitionForPackage({ gitRoot, mergeBase, relPkgDir, baseManifest, manifest }) {
  const state = exactTransitionState(gitRoot, mergeBase);
  if (!state.ok) return state;
  const directory = relPkgDir.split("/").at(-1);
  const oldName = `${state.policy.current.scope}/${directory}`;
  const newName = `${state.policy.candidate.scope}/${directory}`;
  if (baseManifest.name !== oldName || manifest.name !== newName || baseManifest.version !== manifest.version || manifest.publishConfig?.access !== "public") {
    return { ok: false, detail: "package name/version/public-access tuple is not the exact W1D identity transition" };
  }
  const oldEntries = state.lifecycle.packages.filter((entry) => entry?.name === oldName);
  const newEntries = state.lifecycle.packages.filter((entry) => entry?.name === newName);
  if (oldEntries.length !== 1 || oldEntries[0].status !== "published" || Object.keys(oldEntries[0]).sort().join("\0") !== "name\0status" ||
      newEntries.length !== 1 || newEntries[0].status !== "active" || Object.keys(newEntries[0]).sort().join("\0") !== "name\0status") {
    return { ok: false, detail: "lifecycle must retain one exact old published identity and one exact new source-active identity" };
  }
  return { ok: true };
}

// Returns the oldest commit, walking back from HEAD, in the unbroken run of
// commits whose package.json carries `currentVersion` — see the AUDIT MODE
// header comment for why the OLDEST commit in that run, not the newest, is
// the boundary this mode diffs against, and for why that boundary is
// exactly the thing default mode replaces with the merge base instead.
function findBumpCommit(gitRoot, relManifestPath, currentVersion) {
  let shas;
  try {
    shas = git(["log", "--format=%H", "--follow", "--", relManifestPath], gitRoot)
      .split("\n")
      .filter(Boolean);
  } catch {
    // A repository with zero commits at all (`git log` on it fails outright,
    // rather than returning empty) is the same "nothing to compare against
    // yet" case as a path with no history — not a real error.
    shas = [];
  }
  if (shas.length === 0) return { commit: null, reason: "no-history" };

  let bumpCommit = null;
  for (const sha of shas) {
    let version;
    try {
      version = JSON.parse(git(["show", `${sha}:${relManifestPath}`], gitRoot)).version;
    } catch {
      break; // the manifest did not exist at this shape/path at this commit — stop at the boundary
    }
    if (version !== currentVersion) break;
    bumpCommit = sha;
  }
  return bumpCommit === null ? { commit: null, reason: "version-unprecedented" } : { commit: bumpCommit, reason: "ok" };
}

// Picks the comparison ref for default mode. An explicit `--base` must
// resolve or this is a configuration error (loud failure, not a silent
// fallback). With no `--base`, `origin/main` is tried first and a local
// `main` second — returning null (not throwing) when NEITHER resolves,
// because that shape (no remote, no main branch) is "nothing to compare
// against yet," the same benign case as a package with no git history,
// rather than a real error.
function resolveBaseRef(gitRoot, requestedBase) {
  if (requestedBase) {
    try {
      git(["rev-parse", "--verify", `${requestedBase}^{commit}`], gitRoot);
    } catch {
      throw new Error(`--base ${requestedBase} does not resolve to a commit in ${gitRoot}`);
    }
    return requestedBase;
  }
  for (const candidate of ["origin/main", "main"]) {
    try {
      git(["rev-parse", "--verify", `${candidate}^{commit}`], gitRoot);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// Shared preamble for both modes: load the manifest, decide private/skip,
// and resolve this package's location within its git repository. Returns
// either `{ error }`, `{ skip: true, label }`, or the full context object.
function loadPackageContext(pkgDir) {
  const absPkgDir = resolve(pkgDir);
  const manifestPath = join(absPkgDir, "package.json");
  if (!existsSync(manifestPath)) return { error: `no package.json at ${absPkgDir}` };

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return { error: `${manifestPath} is not valid JSON: ${error.message}` };
  }
  const label = manifest.name ?? pkgDir;

  if (manifest.private === true) {
    return { skip: true, label };
  }

  // Both resolved from git itself, in the same invocation context, rather
  // than combined with node's own path.relative(): on macOS $TMPDIR sits
  // under a symlink (/var -> /private/var), so git's resolved --show-toplevel
  // and the unresolved absPkgDir this process was handed can disagree enough
  // that path.relative() walks outside the repository entirely. --show-prefix
  // sidesteps that by asking git for cwd's own path within the repo root it
  // just resolved, so both answers come from the same resolution.
  let gitRoot, relPkgDir;
  try {
    gitRoot = git(["rev-parse", "--show-toplevel"], absPkgDir).trim();
    const prefix = git(["rev-parse", "--show-prefix"], absPkgDir).trim();
    relPkgDir = prefix.replace(/\/$/, "");
  } catch {
    return { error: `${absPkgDir} is not inside a git repository`, label };
  }
  const relManifestPath = relPkgDir ? `${relPkgDir}/package.json` : "package.json";

  return { absPkgDir, manifest, label, gitRoot, relPkgDir, relManifestPath };
}

// IS THE CURRENT VERSION ALREADY PUBLISHED? (owner decision #1187/#1265,
// point 1 — the second-opinion review's correction to this PR's first pass)
// -------------------------------------------------------------------------
// The first version of this change relaxed `needs-bump` to `pass` for EVERY
// unpacked-only staleness. That reopens exactly the case issue #920 exists
// to catch: MOST retained current-version records belong to versions that
// have never been published (`package-scope.json` gates publication off
// entirely pre-W1E) — qualified, staged, waiting. For one of those, an
// unpacked-only change still permanently strands the version (records are
// immutable), and silently skipping the changeset that alone would move the
// package off it compounds the damage under #1265's changesets flow. The
// relaxation is only correct once the version has ALREADY shipped: nothing
// will ever try to publish it again, so a stale record for it is
// historical, not a stranding in progress.
//
// This asks that question from LOCAL, git-tracked evidence only — never the
// live registry (this gate has no network budget; see the header comment)
// — using the same two stores `docs/LIFECYCLE.md`'s `published` state and
// `check-package-evidence.mjs`'s `readValidatedPublishedPackages()` treat as
// authoritative: the sealed Trio first-publication record
// (`governance/release-publications/clossys-npmjs-trio.json`) and a later
// publication's own evidence file
// (`governance/release-publications/later/<key>-<version>.json`, named
// after the exact identity it proves — see that file's own header). This
// deliberately does NOT run `readValidatedPublishedPackages()` itself: that
// function replays the full cryptographic proof chain (candidate joins,
// catalogue closure, provenance, registry-proof) for every retained record,
// measured at roughly 70 SECONDS against this repository's current evidence
// set — utterly incompatible with a gate that must answer on every pull
// request in seconds, before build. Instead this reads each evidence file's
// own declared `candidate.name`/`candidate.version` — an existence-and-identity
// check, not a re-proof. That is a deliberately narrower guarantee, and it is
// safe to be narrower here: this signal only ever softens THIS gate's own
// advisory note. It is never read by check-qualification-record-present.mjs,
// by publish.yml's record-join, or by validate-candidate-publish.mjs's
// tarball reverification — none of which are in this diff — and
// check-package-evidence.mjs independently fails on any evidence file that
// does not survive ITS full validation. A forged or stale file here can only
// wrongly skip one pull request's advisory note; it can never let anything
// unqualified ship, and a real audit of it (check-package-evidence.mjs, or a
// human) catches it on its own separate gate regardless.
function hasLocalPublicationEvidence(gitRoot, name, version) {
  const key = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
  const laterPath = resolve(gitRoot, LATER_PUBLICATION_DIRECTORY, `${key}-${version}.json`);
  if (existsSync(laterPath)) {
    try {
      const record = JSON.parse(readFileSync(laterPath, "utf8"));
      if (record?.candidate?.name === name && record?.candidate?.version === version) return true;
    } catch {
      // Unreadable or malformed — fall through to the Trio check; a
      // separate gate (check-package-evidence.mjs) is where a genuinely
      // broken evidence file gets reported as a finding, not here.
    }
  }
  const trioPath = resolve(gitRoot, TRIO_PUBLICATION_PATH);
  if (!existsSync(trioPath)) return false;
  try {
    const trio = JSON.parse(readFileSync(trioPath, "utf8"));
    for (const member of trio?.members ?? []) {
      const qualPath = member?.qualification?.path;
      if (typeof qualPath !== "string") continue;
      const qualAbs = resolve(gitRoot, qualPath);
      if (!existsSync(qualAbs)) continue;
      const record = JSON.parse(readFileSync(qualAbs, "utf8"));
      if (record?.candidate?.name === name && record?.candidate?.version === version) return true;
    }
  } catch {
    // Same reasoning as above — an unreadable Trio publication file is a
    // finding for a different gate, not evidence of publication here.
  }
  return false;
}

// ISSUE #920 — THE RETAINED-RECORD RECONCILIATION (scope narrowed by the
// #1187 / #1265 owner decision — see the header comment above)
// ---------------------------------------------------
// A package can report "no bump required" by packed-content diffing alone
// (the two `status: "pass"` returns below that this function reaches when
// `changed.length === 0` or the change is devDependencies-only) while its
// CURRENT version's retained qualification record has already gone stale —
// the package directory moved (tests included; see
// check-qualification-record-present.mjs's own header for the prior
// incident that makes `packageTreeSha1` cover tests deliberately) even
// though nothing PACKED moved. This gate and that one are each correct
// about what they measure; the gap issue #920 closed is that nothing told a
// contributor about the second gate's answer before this one reported
// clean.
//
// The incident that motivated #920: `@clossys/architect@0.1.7` was already
// bumped and had a retained record. A follow-up pull request fixed a test so
// it stopped mutating the real `dist/cli.js` — a test-only change, correctly
// EXCLUDED from packed content by `files`. That same edit moved the
// package's tree, and qualification records are immutable (one introduction
// per path, never corrected in place), so 0.1.7's retained record went stale
// the moment that edit landed. Nothing said so until publish, and 0.1.7
// could never be published — see issue #920 for the full incident.
//
// #920's own fix reported that staleness as `needs-bump` UNCONDITIONALLY,
// which is what PR #1265's verification found violates the owner cadence
// rule at #1187: a test-only change (exactly the architect 0.1.7 shape)
// forces a changeset every time, for content nobody is about to publish.
// This function keeps computing the identical diagnosis — it does not
// change what "stale" means, or weaken check-qualification-record-present.mjs's
// own whole-tree comparison at publish time — but now ALSO reports whether
// the current version is already published (`hasLocalPublicationEvidence()`
// above), so the two call sites below can tell the harmless case (already
// shipped; a stale record is historical) from the one #920 exists to catch
// (still queued; a stale record silently strands it).
//
// This reuses check-qualification-record-present.mjs's own present/missing/
// stale join (`qualificationRecordPresenceForCandidate`) rather than a
// second, looser notion of "stale" invented here — the same "one join, two
// callers" discipline check-qualification-record-required.mjs already
// follows for the SAME function, just asked at a different moment (that
// script asks about a version THIS pull request just bumped; this asks
// about the version already sitting in the manifest, whether or not this
// pull request touched it at all). The two can therefore never disagree
// about what "stale" means, only about which candidate they're asking
// about.
//
// Returns `{ path, version, diagnoses, published }` when the CURRENT
// version's retained record no longer matches the tree, or null when there
// is no retained record for this version at all (an ordinary, unpublished
// in-progress package — not a finding) or the record still matches.
function staleRetainedRecordDiagnosis(gitRoot, manifest) {
  const presence = qualificationRecordPresenceForCandidate({
    root: gitRoot,
    candidate: { name: manifest.name, version: manifest.version },
  });
  if (presence.state !== "stale") return null;
  const diagnoses = [];
  if (presence.staleFields.includes("packageManifestSha256")) {
    diagnoses.push(`its package.json has changed (recorded candidate.packageManifestSha256 ${presence.recordedManifestDigest}, current ${presence.currentManifestDigest})`);
  }
  if (presence.staleFields.includes("packageTreeSha1")) {
    diagnoses.push(`its package directory has changed (recorded candidate.packageTreeSha1 ${presence.recordedTreeDigest}, current ${presence.currentTreeDigest})`);
  }
  const published = hasLocalPublicationEvidence(gitRoot, manifest.name, manifest.version);
  return { path: presence.path, version: manifest.version, diagnoses, published };
}

// ISSUE #1255 — A PENDING CHANGESET IS AN ALTERNATIVE TO BUMPING DIRECTLY
// --------------------------------------------------------------------------
// A pull request that changes a package's packed content no longer needs to
// bump that package's version itself: adding a `.changesets/<slug>.md` file
// naming the package (see scripts/collect-changesets.mjs) is equally
// sufficient, and lets scripts/apply-release-changesets.mjs batch the actual
// bump into a periodic release PR instead of every content PR colliding on
// the same package's next version. This is purely additive to the existing
// pass conditions below (a direct version bump still passes, exactly as
// before) — it only widens what ALSO counts as ready, so it cannot make
// anything that passed before fail now.
//
// Reads the working tree's current .changesets/ (the same side of the diff
// packedFiles(absPkgDir) itself reads), not the merge-base's — a changeset
// added anywhere in this pull request's history, still pending at HEAD,
// counts, matching how a direct version bump is judged by its value at HEAD
// too.
function pendingChangesetDetail(gitRoot, relPkgDir) {
  const packageKey = relPkgDir.split("/").at(-1);
  let entries;
  try {
    ({ entries } = loadChangesets(gitRoot));
  } catch {
    return null;
  }
  const matches = changesetsForPackage(entries, packageKey);
  if (matches.length === 0) return null;
  return `a pending changeset covers it: ${matches.map((m) => `${m.file} (${m.bump})`).join(", ")} — scripts/apply-release-changesets.mjs will bump it in the next release PR`;
}

// DEFAULT MODE — diff-scoped against the merge base. See header comment.
function evaluatePackageDiff(pkgDir, requestedBase) {
  const ctx = loadPackageContext(pkgDir);
  if (ctx.error) return { package: ctx.label ?? pkgDir, status: "error", detail: ctx.error };
  if (ctx.skip) return { package: ctx.label, status: "skip", detail: "private:true — nothing is published" };
  const { absPkgDir, manifest, label, gitRoot, relPkgDir, relManifestPath } = ctx;

  let baseRef;
  try {
    baseRef = resolveBaseRef(gitRoot, requestedBase);
  } catch (error) {
    return { package: label, status: "error", detail: error.message };
  }
  if (baseRef === null) {
    return {
      package: label,
      status: "pass",
      detail: "no --base given and neither origin/main nor a local main branch resolves (a repository with no history yet) — nothing to compare against",
    };
  }

  let mergeBase;
  try {
    mergeBase = git(["merge-base", baseRef, "HEAD"], gitRoot).trim();
  } catch {
    return { package: label, status: "pass", detail: `no common history with ${baseRef} — nothing to compare` };
  }

  let baseManifest, baseVersion;
  try {
    baseManifest = JSON.parse(git(["show", `${mergeBase}:${relManifestPath}`], gitRoot));
    baseVersion = baseManifest.version;
  } catch {
    return {
      package: label,
      status: "pass",
      detail: `package did not exist at merge-base ${mergeBase.slice(0, 12)} — a brand-new manifest has no prior version to compare against, so there is nothing for this gate to flag (its first publish goes through publish.yml's workflow_dispatch bootstrap path, not automatic discovery — see scripts/registry-version-lookup.mjs)`,
    };
  }

  if (baseVersion !== manifest.version) {
    // `versionChanged`/`baseVersion`/`mergeBase` are additive fields, read by
    // scripts/check-qualification-record-required.mjs so that script can
    // reuse THIS function's merge-base computation and version comparison —
    // the one this repository already trusts for "did this pull request
    // bump a version" — rather than recomputing the same join a second way
    // that could drift from this one. No existing caller reads these fields,
    // so this is a pure addition to the shape, not a behavior change.
    return {
      package: label,
      status: "pass",
      versionChanged: true,
      baseVersion,
      version: manifest.version,
      mergeBase,
      gitRoot,
      detail: `version changed from ${baseVersion} to ${manifest.version} since merge-base ${mergeBase.slice(0, 12)} (base ${baseRef})`,
    };
  }

  let changed, oldFiles, newFiles, buildInputsChanged;
  try {
    oldFiles = packedFilesAtCommit(gitRoot, relPkgDir, mergeBase);
    newFiles = packedFiles(absPkgDir);
    changed = diffPackedFiles(oldFiles, newFiles);
    // See buildInputFiles()'s header comment: tsconfig*.json never appears
    // in `changed` above (npm never packs it) but can still change compiled
    // dist/ output, so it is read and diffed on its own axis.
    buildInputsChanged = diffPackedFiles(buildInputFilesAtCommit(gitRoot, relPkgDir, mergeBase), buildInputFiles(absPkgDir));
  } catch (error) {
    return { package: label, status: "error", detail: error.message };
  }

  let identityTransitionFailure;
  if (baseManifest.name !== manifest.name) {
    const transition = exactIdentityTransitionForPackage({ gitRoot, mergeBase, relPkgDir, baseManifest, manifest });
    if (transition.ok) {
      return {
        package: label,
        status: "pass",
        detail: `exact history-aware W1D identity transition from ${baseManifest.name} to ${manifest.name}; the package version remains ${manifest.version} because this is a new npm identity, not a same-name release`,
      };
    }
    identityTransitionFailure = transition.detail;
  }

  // A build-input-only change (tsconfig*.json — see buildInputFiles()'s
  // header) is treated exactly like a packed-content change: it can move
  // compiled dist/ output with `changed` reporting nothing. No record-
  // staleness question applies here — this is the ordinary "content moved,
  // version didn't" finding, on a different input than usual.
  if (changed.length === 0 && buildInputsChanged.length > 0) {
    const pendingChangeset = pendingChangesetDetail(gitRoot, relPkgDir);
    if (pendingChangeset) {
      return {
        package: label,
        status: "pass",
        detail: `${buildInputsChanged.length} build input file(s) (tsconfig) changed since merge-base ${mergeBase.slice(0, 12)} (base ${baseRef}) while version stayed ${manifest.version}, but ${pendingChangeset}`,
      };
    }
    return {
      package: label,
      status: "needs-bump",
      buildInputsChanged: true,
      detail:
        `${buildInputsChanged.length} build input file(s) changed since merge-base ${mergeBase.slice(0, 12)} (base ${baseRef}) while version stayed ${manifest.version} ` +
        "— tsconfig drives what tsc emits into dist/, so this can change what a consumer receives with no packed-file trace " +
        "(bump the version, or add a .changesets/<slug>.md naming this package instead — see issue #1255)",
      changed: buildInputsChanged,
    };
  }
  if (changed.length === 0) {
    const stale = staleRetainedRecordDiagnosis(gitRoot, manifest);
    if (stale && stale.published) {
      // Packed content is unaffected by construction (changed.length === 0),
      // and the current version is ALREADY published (owner decision
      // #1187/#1265, point 1) — nothing will ever try to publish
      // ${stale.version} again, so its now-stale record is historical, not
      // a stranding in progress. Reported, not failed: `pass` with
      // `staleRetainedRecord: true` so the finding stays visible without
      // blocking a merge that changes nothing a consumer would receive.
      return {
        package: label,
        status: "pass",
        staleRetainedRecord: true,
        detail:
          `no packed-file changes since merge-base ${mergeBase.slice(0, 12)} (base ${baseRef}, version ${manifest.version}) — ` +
          "packed content is unaffected, so no version bump or changeset is required for this pull request. " +
          `Note: the retained qualification record for ${stale.version} at ${stale.path} is stale (${stale.diagnoses.join("; ")}); ` +
          `this is unpacked-only drift, expected for a test/CI/docs-only change under the owner cadence rule (issue #1187). ` +
          `${stale.version} is already published, so this is harmless: records are immutable and this one can never be brought back in sync, but nothing will ever try to publish ${stale.version} again.`,
      };
    }
    if (stale) {
      // The current version has NOT been shown to be published locally —
      // this is exactly the architect 0.1.7 / issue #920 shape: an
      // unpacked-only edit staling a record for a version still queued to
      // ship. Records are immutable (never corrected in place), so
      // ${stale.version} itself can never be published with a matching
      // record again — the only remedy is a NEW version, which nothing
      // forces unless this stays a failing gate. Kept strict on purpose.
      return {
        package: label,
        status: "needs-bump",
        staleRetainedRecord: true,
        detail:
          `no packed-file changes since merge-base ${mergeBase.slice(0, 12)} (base ${baseRef}, version ${manifest.version}), but the retained qualification ` +
          `record for ${stale.version} at ${stale.path} is now stale (${stale.diagnoses.join("; ")}) and ${stale.version} has no local publication evidence — ` +
          `it is still queued to ship. Records are immutable, so ${stale.version} can no longer be published as qualified; the remedy is a new version ` +
          `(bump the version, or add a .changesets/<slug>.md naming this package — see issue #1255), not a re-qualification of ${stale.version} itself.`,
      };
    }
    return {
      package: label,
      status: "pass",
      detail: `no packed-file changes since merge-base ${mergeBase.slice(0, 12)} (base ${baseRef}, version ${manifest.version})`,
    };
  }
  // buildInputsChanged.length === 0 is required here too: a devDependencies-
  // only packed change (package.json, nothing else packed) alongside an
  // UNPACKED tsconfig edit must not ride through on the devDependencies
  // exemption — the tsconfig edit alone is enough to change dist/ output
  // (see buildInputFiles()'s header comment), independent of whether the
  // devDependency that changed was a build-toolchain one.
  if (buildInputsChanged.length === 0 && isDevDependenciesOnlyChange(changed, oldFiles, newFiles)) {
    const stale = staleRetainedRecordDiagnosis(gitRoot, manifest);
    if (stale && stale.published) {
      // Same reasoning as the changed.length === 0 branch above: a
      // devDependencies-only edit is already exempt from the bump
      // requirement (issue #269), and ${stale.version} is already
      // published, so record staleness it causes or uncovers is reported,
      // not failed.
      return {
        package: label,
        status: "pass",
        staleRetainedRecord: true,
        detail:
          `only devDependencies changed in package.json since merge-base ${mergeBase.slice(0, 12)} (base ${baseRef}, ` +
          `version ${manifest.version}) — devDependencies do not affect what consumers receive when they install this ` +
          "package, so this is exempt from the version-bump requirement (see issue #269). " +
          `Note: the retained qualification record for ${stale.version} at ${stale.path} is stale (${stale.diagnoses.join("; ")}); ` +
          `${stale.version} is already published, so this is harmless — records are immutable, but nothing will ever try to publish ${stale.version} again.`,
      };
    }
    if (stale) {
      return {
        package: label,
        status: "needs-bump",
        staleRetainedRecord: true,
        detail:
          `only devDependencies changed in package.json since merge-base ${mergeBase.slice(0, 12)} (base ${baseRef}, version ${manifest.version}), but the ` +
          `retained qualification record for ${stale.version} at ${stale.path} is now stale (${stale.diagnoses.join("; ")}) and ${stale.version} has no local ` +
          `publication evidence — it is still queued to ship. Records are immutable, so ${stale.version} can no longer be published as qualified; the remedy ` +
          `is a new version (bump the version, or add a .changesets/<slug>.md naming this package — see issue #1255), not a re-qualification of ${stale.version} itself.`,
      };
    }
    return {
      package: label,
      status: "pass",
      detail:
        `only devDependencies changed in package.json since merge-base ${mergeBase.slice(0, 12)} (base ${baseRef}, ` +
        `version ${manifest.version}) — devDependencies do not affect what consumers receive when they install this ` +
        "package, so this is exempt from the version-bump requirement (see issue #269)",
    };
  }
  const pendingChangeset = pendingChangesetDetail(gitRoot, relPkgDir);
  if (pendingChangeset) {
    return {
      package: label,
      status: "pass",
      detail: `${changed.length} packed file(s) changed since merge-base ${mergeBase.slice(0, 12)} (base ${baseRef}) while version stayed ${manifest.version}, but ${pendingChangeset}`,
    };
  }
  return {
    package: label,
    status: "needs-bump",
    detail: `${changed.length} packed file(s) changed since merge-base ${mergeBase.slice(0, 12)} (base ${baseRef}) while version stayed ${manifest.version}` +
      (identityTransitionFailure ? `; identity-transition exemption rejected: ${identityTransitionFailure}` : "") +
      " (bump the version, or add a .changesets/<slug>.md naming this package instead — see issue #1255)",
    changed,
  };
}

// AUDIT MODE (`--audit`) — whole-repo heuristic. See header comment for its
// blind spot before trusting a finding from this mode.
function evaluatePackageAudit(pkgDir) {
  const ctx = loadPackageContext(pkgDir);
  if (ctx.error) return { package: ctx.label ?? pkgDir, status: "error", detail: ctx.error };
  if (ctx.skip) return { package: ctx.label, status: "skip", detail: "private:true — nothing is published" };
  const { absPkgDir, manifest, label, gitRoot, relPkgDir, relManifestPath } = ctx;

  let bump;
  try {
    bump = findBumpCommit(gitRoot, relManifestPath, manifest.version);
  } catch (error) {
    return { package: label, status: "error", detail: `could not read package.json history: ${error.message}` };
  }

  if (bump.reason === "no-history") {
    return {
      package: label,
      status: "pass",
      detail: "package.json has no commits yet — a brand-new manifest has no prior version to compare against, so there is nothing for this gate to flag (its first publish goes through publish.yml's workflow_dispatch bootstrap path, not automatic discovery — see scripts/registry-version-lookup.mjs)",
    };
  }
  if (bump.reason === "version-unprecedented") {
    return { package: label, status: "pass", detail: `version ${manifest.version} has never appeared in history — already bumped` };
  }

  let changed;
  try {
    const oldFiles = packedFilesAtCommit(gitRoot, relPkgDir, bump.commit);
    const newFiles = packedFiles(absPkgDir);
    changed = diffPackedFiles(oldFiles, newFiles);
  } catch (error) {
    return { package: label, status: "error", detail: error.message };
  }

  if (changed.length === 0) {
    return {
      package: label,
      status: "pass",
      detail: `no packed-file changes since bump commit ${bump.commit.slice(0, 12)} (version ${manifest.version})`,
    };
  }
  return {
    package: label,
    status: "needs-bump",
    detail:
      `${changed.length} packed file(s) changed since bump commit ${bump.commit.slice(0, 12)} while version stayed ` +
      `${manifest.version} — HEURISTIC: this cannot see the registry, so if ${manifest.version} was actually ` +
      "published AFTER these edits landed, this package is already fine (see this script's own AUDIT MODE comment).",
    changed,
  };
}

// Resolved against the current working directory, not this script's own
// location — every caller (package.json's `check` script, CI, a developer's
// shell) runs this from the repository root, the same convention every
// other packages/*-iterating script here follows.
function discoverPackages() {
  const packagesDir = join(process.cwd(), "packages");
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(packagesDir, d.name))
    .filter((dir) => existsSync(join(dir, "package.json")))
    .sort();
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const audit = argv.includes("--audit");
  const baseIndex = argv.indexOf("--base");
  const requestedBase = baseIndex >= 0 ? argv[baseIndex + 1] : undefined;
  if (baseIndex >= 0 && requestedBase === undefined) {
    console.error("check-release-readiness: --base requires a value");
    process.exit(2);
  }
  if (audit && baseIndex >= 0) {
    console.error("check-release-readiness: --base has no effect in --audit mode (audit ignores merge base entirely)");
    process.exit(2);
  }
  const positional = argv.filter((a, i) => !a.startsWith("--") && i !== baseIndex + 1);
  const targets = positional.length > 0 ? positional : discoverPackages();

  if (targets.length === 0) {
    // Scanning nothing is "could not run" (2), never a clean pass (0).
    //
    // This gate exists to catch a package whose shipped content changed
    // without a version bump. If discovery returns nothing — `packages/`
    // renamed or moved, the glob broken by a refactor, the checkout
    // shallow in a way that hides it — then a `0` here would report
    // "every package is release-ready" on the strength of having examined
    // zero packages. A check that passes because it checked nothing is
    // indistinguishable from a check that cannot fail, and this one is
    // specifically the guard against a silent non-publication, so it must
    // not itself go silent.
    //
    // Same three-state contract `ui-token-check` already uses: 0 clean,
    // 1 findings, 2 could not run. An empty scan is the third state.
    const message = "found no packages to check — refusing to report a clean pass on an empty scan";
    if (json) console.log(JSON.stringify({ error: message, results: [] }, null, 2));
    else console.error(`check-release-readiness: ${message}`);
    process.exit(2);
  }

  const results = audit ? targets.map(evaluatePackageAudit) : targets.map((dir) => evaluatePackageDiff(dir, requestedBase));

  if (json) {
    console.log(JSON.stringify({ mode: audit ? "audit" : "diff", results }, null, 2));
  } else {
    const labels = { pass: "READY", skip: "SKIP ", "needs-bump": "BUMP ", error: "ERROR" };
    for (const r of results) {
      console.log(`  [${labels[r.status]}] ${r.package} — ${r.detail}`);
      for (const c of r.changed ?? []) console.log(`             ${c}`);
    }
  }

  // Same worst-of-three-way aggregation preflight-package.mjs uses: an error
  // anywhere dominates a needs-bump finding, which dominates a clean pass.
  const worst = results.reduce((acc, r) => (r.status === "error" ? 2 : r.status === "needs-bump" && acc !== 2 ? 1 : acc), 0);

  if (!json) {
    console.log("");
    if (audit) {
      console.log(
        worst === 0
          ? "RELEASE-READY (audit) — no package's packed content has moved since its own bump commit without the version moving too."
          : worst === 2
            ? "RELEASE-READINESS ERROR (audit) — could not evaluate at least one package (see ERROR lines above)."
            : "RELEASE-READINESS FAIL (audit, HEURISTIC) — the packages listed BUMP above changed since their own bump commit with no further version change. This does NOT prove they were never published after those edits (a bump-then-edit-then-publish package looks identical to an unpublished one from git history alone — see this script's AUDIT MODE comment). Cross-check against the registry before acting, or prefer the default (non---audit) mode's diff-scoped result, which has no such false positive.",
      );
    } else {
      console.log(
        worst === 0
          ? "RELEASE-READY — every package whose packed content changed since the comparison base also changed version."
          : worst === 2
            ? "RELEASE-READINESS ERROR — could not evaluate at least one package (see ERROR lines above)."
            : "RELEASE-READINESS FAIL — bump the version of every package listed BUMP above before merging. A merged source change with no version bump does not publish (see scripts/select-publishable-packages.mjs) and nothing else reports that gap.",
      );
    }
  }
  process.exit(worst);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

// `git` and `resolveBaseRef` are exported alongside the rest so that
// scripts/check-touches-packages.mjs (the pull-request change-detector
// gating the expensive package-verification steps in .github/workflows/ci.yml's
// `build` job) reuses this file's own merge-base resolution rather than
// re-implementing it a second time where it could drift out of sync.
export { diffPackedFiles, evaluatePackageAudit, evaluatePackageDiff, findBumpCommit, git, packedFiles, resolveBaseRef };
