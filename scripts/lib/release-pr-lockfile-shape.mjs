// release-pr-lockfile-shape — does a release commit's package-lock.json
// change go no further than the version and dependency-range edits its own
// bumped packages justify? (issue #1439, defect 3's second half: "have
// check-release-pr-shape.mjs refuse lockfile changes beyond the released
// packages' version and range edits.")
//
// WHY THIS EXISTS SEPARATELY FROM scripts/check-release-pr-shape.mjs ITSELF
// ---------------------------------------------------------------------------
// That script judges ONE package at a time (is ITS bump justified by a
// consumed changeset or a changelog entry) -- package-lock.json is a single
// file covering every workspace package at once, so judging it needs the
// FULL set of packages this diff bumped, not one package in isolation. This
// module is the one place that question is asked, called once from
// check-release-pr-shape.mjs's main() after every package has been judged
// individually.
//
// REUSES lib/release-pr-footprint.mjs's OWN isLockfilePureVersionBump() AND
// isDevDependenciesOnlyRewrite() -- NOT A SECOND IMPLEMENTATION
// ---------------------------------------------------------------------------
// scripts/check-release-calendar.mjs's weekend-merge gate already trusts
// those two functions to judge a release PR's ENTIRE diff, including its
// lockfile, structurally rather than by path or branch name (see that
// module's own header for the full incident history behind why). This
// module answers a narrower question with the identical rule -- reusing the
// exact same functions means this gate and that one can never quietly
// disagree about what a legitimate lockfile edit looks like.
//
// devDependencies-ONLY SIBLING REWRITES ARE A REAL, EXPECTED SHAPE
// ---------------------------------------------------------------------------
// apply-release-changesets.mjs rewrites a sibling workspace package's own
// devDependencies range (never triggering its own version bump) alongside a
// dependencies/peerDependencies/optionalDependencies rewrite, when a bumped
// package moves outside a workspace sibling's declared range on it (issue
// #1332/#1338, and the devDependencies edge from PR #1353's re-review) --
// so a genuinely release-PR-shaped lockfile can carry a NON-bumped
// workspace package's entry whose only change is its devDependencies map.
// evaluateLockfileShape() below classifies every non-bumped, changed
// packages/<dir>/package.json the same way isDevDependenciesOnlyRewrite()
// already does, and threads the result into isLockfilePureVersionBump() so
// that shape is accepted here exactly as it already is at the merge gate --
// anything else about a non-bumped manifest changing is left to whatever
// OTHER gate already judges that (this module's job stays "is the LOCKFILE
// change accounted for", not "is every package.json change legitimate").
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { isDevDependenciesOnlyRewrite, isLockfilePureVersionBump } from "./release-pr-footprint.mjs";

export const LOCKFILE_REL_PATH = "package-lock.json";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitShowOrNull(gitRoot, commit, relPath) {
  try {
    return git(["show", `${commit}:${relPath}`], gitRoot);
  } catch {
    return null;
  }
}

// Every packages/<dir> under `gitRoot` at HEAD (the working tree, matching
// discoverPackages()'s own convention in check-release-pr-shape.mjs) that
// has a package.json -- deliberately scanned from `gitRoot`, never
// `process.cwd()`, so this still finds every sibling package when the
// caller was invoked with an explicit positional package subset (as
// check-release-pr-shape.test.mjs's fixtures do) rather than a full
// discovery scan.
function allPackageDirNames(gitRoot) {
  const packagesDir = join(gitRoot, "packages");
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => existsSync(join(packagesDir, d.name, "package.json")))
    .map((d) => d.name)
    .sort();
}

/**
 * `bumps` is `{ dir, name, version, manifest }[]` -- one entry per package
 * scripts/check-release-pr-shape.mjs's own evaluatePackage() already proved
 * bumped a version in this diff (its `versionChanged === true` results),
 * regardless of whether that specific bump was itself judged release-PR
 * shaped: a release lockfile is expected to track every real version bump
 * in the tree, including a dependent-only sibling bump that
 * apply-release-changesets.mjs makes with no changeset naming it. The
 * caller only asks this question in the release-PR case (at least one bump
 * consumed a changeset); a diff of direct, changelog-justified bumps alone
 * never reaches here.
 *
 * `partialBumpSet: true` means the caller examined only some packages; a
 * changed lockfile is then refused (status "error") instead of judged.
 *
 * Returns `{ status: "pass" | "not-release-shaped" | "error", detail }` --
 * the same three-way status vocabulary check-release-pr-shape.mjs's own
 * per-package results already use, so main() can fold this into the same
 * `results` array and exit-code reduction with no special-casing.
 */
export function evaluateLockfileShape({ gitRoot, mergeBase, bumps, partialBumpSet = false }) {
  const lockfilePath = join(gitRoot, LOCKFILE_REL_PATH);
  if (!existsSync(lockfilePath)) {
    return { status: "pass", detail: `no ${LOCKFILE_REL_PATH} at ${gitRoot} -- nothing for this check to judge` };
  }

  const baseText = gitShowOrNull(gitRoot, mergeBase, LOCKFILE_REL_PATH);
  if (baseText === null) {
    return { status: "pass", detail: `${LOCKFILE_REL_PATH} did not exist at merge-base ${mergeBase.slice(0, 12)} -- nothing to compare` };
  }

  let headText;
  try {
    headText = readFileSync(lockfilePath, "utf8");
  } catch (error) {
    return { status: "error", detail: `could not read ${lockfilePath}: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (headText === baseText) {
    return { status: "pass", detail: `${LOCKFILE_REL_PATH} unchanged since merge-base ${mergeBase.slice(0, 12)}` };
  }

  // The lockfile changed, so the verdict now depends on the full set of
  // bumps. A caller that only examined a subset of packages (a positional
  // invocation of check-release-pr-shape.mjs) cannot supply that set, so it
  // is refused rather than judged against a partial one -- which could both
  // miss a bump that justifies an edit and accept nothing it should not.
  if (partialBumpSet) {
    return {
      status: "error",
      detail:
        `${LOCKFILE_REL_PATH} changed since merge-base ${mergeBase.slice(0, 12)} in a release diff (a changeset-consumed bump is present), but it covers every workspace package and is judged only on a full run -- ` +
        "rerun without positional package arguments to judge its shape",
    };
  }

  if (bumps.length === 0) {
    return {
      status: "not-release-shaped",
      detail: `${LOCKFILE_REL_PATH} changed since merge-base ${mergeBase.slice(0, 12)}, but no package in this diff bumped its version -- nothing justifies any lockfile change`,
    };
  }

  const bumpedDirs = bumps.map((b) => b.dir);
  const bumpedDirSet = new Set(bumpedDirs);
  const bumpedVersionsByName = Object.fromEntries(bumps.filter((b) => b.name).map((b) => [b.name, b.version]));
  const bumpedManifestsByName = Object.fromEntries(
    bumps
      .filter((b) => b.name)
      .map((b) => [
        b.name,
        {
          version: b.version,
          dependencies: b.manifest?.dependencies,
          peerDependencies: b.manifest?.peerDependencies,
          optionalDependencies: b.manifest?.optionalDependencies,
          devDependencies: b.manifest?.devDependencies,
        },
      ]),
  );

  // Classify every OTHER (non-bumped) package.json that changed since the
  // merge base -- see this module's own header, "devDependencies-ONLY
  // SIBLING REWRITES ARE A REAL, EXPECTED SHAPE" -- exactly the same way
  // evaluateReleasePrFootprint() does, so a genuine release PR's lockfile
  // is not refused for a shape the merge gate would have accepted.
  const devDependencyOnlyDirs = [];
  const devDependencyOnlyManifestsByName = {};
  for (const dir of allPackageDirNames(gitRoot)) {
    if (bumpedDirSet.has(dir)) continue;
    const relManifestPath = `packages/${dir}/package.json`;
    const manifestPath = join(gitRoot, relManifestPath);
    let headManifestText;
    try {
      headManifestText = readFileSync(manifestPath, "utf8");
    } catch {
      continue; // removed since merge-base, or unreadable -- not this check's business
    }
    const baseManifestText = gitShowOrNull(gitRoot, mergeBase, relManifestPath);
    if (baseManifestText === null || headManifestText === baseManifestText) continue; // brand-new, or unchanged -- nothing to classify

    if (isDevDependenciesOnlyRewrite(baseManifestText, headManifestText, bumpedVersionsByName)) {
      devDependencyOnlyDirs.push(dir);
      let headManifestJson;
      try {
        headManifestJson = JSON.parse(headManifestText);
      } catch {
        continue;
      }
      if (typeof headManifestJson.name === "string" && headManifestJson.name.length > 0) {
        devDependencyOnlyManifestsByName[headManifestJson.name] = { version: headManifestJson.version, devDependencies: headManifestJson.devDependencies };
      }
    }
    // Anything else (a non-bumped package.json that changed for some other
    // reason) is deliberately left unclassified: its packages/<dir> lockfile
    // entry must then remain byte-identical to base for
    // isLockfilePureVersionBump() to accept it, same as any package this
    // diff never touched at all.
  }

  const pureVersionBump = isLockfilePureVersionBump(baseText, headText, bumpedDirs, bumpedVersionsByName, bumpedManifestsByName, devDependencyOnlyDirs, devDependencyOnlyManifestsByName);

  if (!pureVersionBump) {
    return {
      status: "not-release-shaped",
      detail:
        `${LOCKFILE_REL_PATH} changes go beyond the version fields and allowed dependency-range rewrites of this release diff's bumped package(s) (${bumpedDirs.join(", ")}). ` +
        "A release commit's lockfile may change only as scripts/apply-release-changesets.mjs's `npm install --package-lock-only` on the pinned release runtime (Node 24.19.0 / npm 11.17.0) changes it for those bumps -- " +
        "any other edit, such as metadata rewritten by a different npm, is refused (issue #1439)",
    };
  }

  return {
    status: "pass",
    detail: `${LOCKFILE_REL_PATH} changes are limited to the version fields and allowed dependency-range rewrites of this release diff's bumped package(s) (${bumpedDirs.join(", ")})`,
  };
}
