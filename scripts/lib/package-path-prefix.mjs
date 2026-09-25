// package-path-prefix — the one place that derives check-public-safety.mjs's
// --path-prefix (and the --scope-config it is anchored to) from a real,
// on-disk package directory.
//
// WHY THIS IS SHARED
// -------------------
// Every caller that hands check-public-safety.mjs an EXTRACTED artifact
// (a temp directory with no repository above it — a tarball extraction or an
// equivalent staged copy) must restore the package's repository-relative
// prefix explicitly, or a package-scoped neutralize rule and opaque exemption
// (written against paths like "packages/foo/README.md") can never match
// there, because the extracted root strips that leading segment away. See the
// "WHY --path-prefix EXISTS" section of check-public-safety.mjs for the full
// mechanics.
//
// check-artifact-safety.mjs and publish-qualified-directory.mjs both scan
// exactly this shape of input — a real package directory's content, staged
// somewhere else — and both need the identical prefix for the identical
// package. Issue #936 is what happens when that derivation is written twice:
// one caller simply never wrote one, and the same bytes got two different
// verdicts depending on which caller scanned them. Reusing one function is
// what keeps that from happening again.
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

// Walk upward from `packageDir` for the same anchor check-public-safety.mjs
// itself trusts as "the repository root" (package-scope.json). There is
// deliberately no second, independent repository-root-finding mechanism
// (e.g. shelling out to `git rev-parse --show-toplevel`) — reusing the one
// anchor every caller already agrees on is what keeps them from disagreeing
// with each other about where the repository root is.
export function resolvePackagePathPrefix(packageDir) {
  const absPkgDir = resolve(packageDir);
  let scopeConfigPath = null;
  for (let dir = absPkgDir; ; dir = resolve(dir, "..")) {
    const candidate = join(dir, "package-scope.json");
    if (existsSync(candidate)) {
      scopeConfigPath = candidate;
      break;
    }
    if (resolve(dir, "..") === dir) break;
  }
  if (!scopeConfigPath) throw new Error(`no package-scope.json found above ${absPkgDir} — cannot verify the registry pin`);
  const repoRoot = dirname(scopeConfigPath);
  const pathPrefix = relative(repoRoot, absPkgDir).split(sep).join("/");
  return { scopeConfigPath, repoRoot, pathPrefix };
}
