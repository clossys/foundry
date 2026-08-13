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
// WHY THIS EXISTS
// ---------------
// scripts/select-publishable-packages.mjs is the thing that decides what the
// Publish workflow actually uploads, and it decides on exactly one signal: a
// package's `version` field changed between the before/after commits of a
// push to main. That is deliberate and correct — see its own header — but it
// means a package whose source changed with no version bump produces an
// empty matrix and publishes NOTHING, silently. That happened for real: a
// consumer integration surfaced eight behavioural fixes across six packages
// that merged to main with no version bump, so the selector's matrix was
// empty, `publish` was skipped, and the fixes sat on main invisible to
// consumers for a day with nothing anywhere reporting it (issue #156).
// "Merged" and "consumable" were two different, unannounced states. This
// script is the check that makes that gap visible BEFORE merge, so it can't
// recur silently — see the `release-readiness` job it is wired into in
// .github/workflows/ci.yml.
//
// DEFAULT MODE: diffed against the merge base, exactly like the Publish
// workflow itself
// ------------------------------------------------------------------------
// The default check asks exactly the question select-publishable-packages.mjs
// asks on a push to main — did this package's version change between two
// fixed points? — using the SAME two points a pull request is actually
// being merged across: `git merge-base <base> HEAD` and HEAD/working tree.
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
// repository: `@vespeneventures/comms` was bumped to 0.1.0, THEN edited
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
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
// and packs THAT, purely so `npm pack --dry-run` can be pointed at it — see
// header comment for why the comparison happens at the pack layer rather
// than by hand-walking `files` globs. Cleans up its own temp dir.
function packedFilesAtCommit(gitRoot, relPkgDir, commit) {
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
    return packedFiles(oldPkgDir);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
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

  let baseVersion;
  try {
    baseVersion = JSON.parse(git(["show", `${mergeBase}:${relManifestPath}`], gitRoot)).version;
  } catch {
    return {
      package: label,
      status: "pass",
      detail: `package did not exist at merge-base ${mergeBase.slice(0, 12)} — a brand-new package publishes on its own (see select-publishable-packages.mjs)`,
    };
  }

  if (baseVersion !== manifest.version) {
    return {
      package: label,
      status: "pass",
      detail: `version changed from ${baseVersion} to ${manifest.version} since merge-base ${mergeBase.slice(0, 12)} (base ${baseRef})`,
    };
  }

  let changed;
  try {
    const oldFiles = packedFilesAtCommit(gitRoot, relPkgDir, mergeBase);
    const newFiles = packedFiles(absPkgDir);
    changed = diffPackedFiles(oldFiles, newFiles);
  } catch (error) {
    return { package: label, status: "error", detail: error.message };
  }

  if (changed.length === 0) {
    return {
      package: label,
      status: "pass",
      detail: `no packed-file changes since merge-base ${mergeBase.slice(0, 12)} (base ${baseRef}, version ${manifest.version})`,
    };
  }
  return {
    package: label,
    status: "needs-bump",
    detail: `${changed.length} packed file(s) changed since merge-base ${mergeBase.slice(0, 12)} (base ${baseRef}) while version stayed ${manifest.version}`,
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
      detail: "package.json has no commits yet — a brand-new manifest publishes on its own (see select-publishable-packages.mjs)",
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
    if (json) console.log(JSON.stringify({ results: [] }));
    else console.log("check-release-readiness: no packages to check.");
    process.exit(0);
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

export { diffPackedFiles, evaluatePackageAudit, evaluatePackageDiff, findBumpCommit, packedFiles, resolveBaseRef };
