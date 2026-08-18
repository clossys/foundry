/**
 * `buildCatalog` — pure data gathering. Walks disk, parses JSON, extracts
 * what's there. It never judges anything: every field is recorded exactly as
 * found. Judgement is `evaluateCatalog`'s job (see evaluate.ts), over the
 * plain data structure this function returns.
 *
 * The one exception to "never judges" is `Catalog.skipped`: a directory that
 * cannot be read, or a manifest that cannot be read or turned into a usable
 * entry, is DATA — it is recorded, not silently dropped — but recording it
 * is still not a judgement. `buildCatalog` never decides a skip is a
 * *problem*; it never throws, and it never assigns a severity. That
 * decision belongs entirely to `evaluateCatalog`, which is what turns each
 * recorded skip into a `CatalogFinding`. See that function's doc comment for
 * why an unreadable path is treated as a materially different, and worse,
 * kind of problem than an ordinary rule violation.
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { Catalog, CatalogEntry, CatalogOptions, CatalogSkip } from "./types.js";

/** Directory names never recorded as, or descended into as, a package. */
const SKIPPED_DIR_NAMES = new Set(["node_modules", "dist", "build"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** repo-relative, "/"-joined path — the one convention every path recorded in a Catalog uses. */
function relPath(resolvedRoot: string, abs: string): string {
  return relative(resolvedRoot, abs).split(sep).join("/");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Lists `dirAbs`'s direct children, sorted for a stable walk order.
 *
 * Returns `null`, recording nothing, when the directory vanished between its
 * PARENT's `readdirSync` and this call (`ENOENT`) — a benign race, not a
 * problem worth surfacing. Returns `null`, recording an `"unreadable-
 * directory"` skip, for any other failure — most commonly `EACCES` from a
 * directory whose permissions block traversal entirely (e.g. `chmod 000`).
 * That second case is the one the previous version of this function got
 * wrong: its `catch` was unconditional, so a genuine permissions failure was
 * swallowed identically to the benign race, and every package that might
 * have lived beneath the unreadable directory — along with any real,
 * error-severity problem THEY might have declared — silently vanished from
 * the catalog with no trace at all.
 */
function readDirSafe(dirAbs: string, resolvedRoot: string, skipped: CatalogSkip[]): string[] | null {
  let children: string[];
  try {
    children = readdirSync(dirAbs);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      skipped.push({
        path: relPath(resolvedRoot, dirAbs),
        reason: "unreadable-directory",
        kind: "unreadable",
        detail: errorMessage(error),
      });
    }
    return null;
  }
  children.sort();
  return children;
}

/**
 * Attempts to read one directory as a package, given that directory's own
 * (already successfully listed — see `readDirSafe`) children.
 *
 * Returns `"absent"` when `dirChildren` contains no `package.json` at all —
 * the walk should keep looking further down in that case. Returns
 * `"unusable"`, after recording a skip, when a `package.json` IS present but
 * cannot be read, does not parse as JSON, does not parse to a plain object,
 * or lacks a usable `name`/`version` — the directory is "claimed" by that
 * manifest even though it can't be turned into a `CatalogEntry`, so the walk
 * must stop there too (rule 1: a directory whose package.json fails to
 * parse is still skipped AND not descended into). Otherwise returns the
 * `CatalogEntry` itself.
 */
function readPackageAt(
  dirAbs: string,
  resolvedRoot: string,
  dirChildren: string[],
  skipped: CatalogSkip[],
): CatalogEntry | "absent" | "unusable" {
  if (!dirChildren.includes("package.json")) return "absent";

  const manifestPath = join(dirAbs, "package.json");
  const dir = relPath(resolvedRoot, dirAbs);

  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (error) {
    // dirChildren just proved package.json is present, so this is a real
    // read failure — e.g. the manifest file's own permissions, distinct
    // from a directory-level failure (already caught one level up, by
    // readDirSafe, before this function is ever called).
    skipped.push({ path: dir, reason: "unreadable-manifest", kind: "unreadable", detail: errorMessage(error) });
    return "unusable";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    skipped.push({ path: dir, reason: "unparseable-manifest", kind: "unusable", detail: errorMessage(error) });
    return "unusable";
  }
  if (!isPlainObject(parsed)) {
    // e.g. a JSON array or a bare string/number at the top level.
    skipped.push({ path: dir, reason: "manifest-not-object", kind: "unusable" });
    return "unusable";
  }

  const { name, version } = parsed;
  if (typeof name !== "string" || typeof version !== "string") {
    skipped.push({ path: dir, reason: "manifest-missing-name-or-version", kind: "unusable" });
    return "unusable";
  }

  const priv = typeof parsed.private === "boolean" ? parsed.private : false;

  return {
    name,
    version,
    dir,
    private: priv,
    packageJson: parsed,
  };
}

/**
 * Recursively walks the children of `dirAbs`, appending found packages to
 * `entries` and recording anything unreadable/unusable into `skipped`.
 * `depth` is the depth, relative to `<root>/<packagesDir>`, that those
 * children sit at — e.g. the first call is made with `dirAbs` set to the
 * packages directory itself and `depth: 1`, since its direct children
 * (`packages/foo`) are depth 1; a call recursing into `packages/foo` passes
 * `depth: 2`, since ITS children (`packages/foo/bar`) are depth 2.
 *
 * `listing`, when supplied, is `dirAbs`'s already-known children (the caller
 * obtained it via `readDirSafe` while deciding whether to recurse here at
 * all) — reused instead of listing `dirAbs` a second time. Omitted only for
 * the very first call, on the packages directory itself.
 */
function walk(
  dirAbs: string,
  resolvedRoot: string,
  depth: number,
  maxDepth: number,
  entries: CatalogEntry[],
  skipped: CatalogSkip[],
  listing?: string[],
): void {
  if (depth > maxDepth) return;

  const children = listing ?? readDirSafe(dirAbs, resolvedRoot, skipped);
  if (children === null) return; // vanished (silent) or unreadable (recorded above)

  for (const child of children) {
    const childAbs = join(dirAbs, child);

    // lstatSync, not statSync: a symlink must never be followed. Following
    // symlinks during a recursive directory walk can revisit an ancestor
    // through a cycle (e.g. a symlink pointing back up the tree) and loop
    // forever, or wander outside the repository entirely. Skipping symlinks
    // outright — recording nothing, descending nowhere — sidesteps both
    // problems rather than trying to detect cycles after the fact. This is
    // deliberate policy, not a failure, so it is never recorded in `skipped`.
    let stat;
    try {
      stat = lstatSync(childAbs);
    } catch {
      continue; // vanished between readdir and lstat
    }
    if (stat.isSymbolicLink()) continue;
    if (!stat.isDirectory()) continue;
    if (SKIPPED_DIR_NAMES.has(child) || child.startsWith(".")) continue;

    // Determine readability of the CHILD directory itself before treating
    // it as a package or recursing into it. A directory that cannot be
    // listed (e.g. chmod 000) must be recorded as unreadable and skipped
    // outright, not silently treated as an ordinary package-free
    // intermediate directory with nothing found beneath it — that silent
    // conflation is exactly the defect this function used to have.
    const childListing = readDirSafe(childAbs, resolvedRoot, skipped);
    if (childListing === null) continue;

    const result = readPackageAt(childAbs, resolvedRoot, childListing, skipped);
    if (result === "absent") {
      // No package.json here — this is an intermediate directory (e.g. a
      // tier grouping), so keep looking further down. `childListing` is
      // already known, so the recursive call does not list it again.
      walk(childAbs, resolvedRoot, depth + 1, maxDepth, entries, skipped, childListing);
      continue;
    }
    // Rule 1: a directory containing a package.json IS a package — record it
    // (if usable) and stop. Do not descend into it, so a package's own
    // nested fixtures/test-workspaces are never mistaken for further
    // packages. This applies even when the manifest is "unusable": the
    // directory is still claimed by its package.json and must not be
    // descended into, it is simply skipped (and recorded) rather than
    // recorded as a CatalogEntry.
    if (result !== "unusable") entries.push(result);
  }
}

/**
 * Lists every package found under `<root>/<packagesDir>` (default
 * `"packages"`), walking as deep as necessary to find them.
 *
 * The walk is governed by one rule: a directory containing a `package.json`
 * IS a package — it is recorded, and the walk does not descend into it. That
 * single rule is what makes depth-1 layouts (`packages/foo`), depth-2
 * layouts (`packages/tier/foo`), and layouts that mix both in the same tree
 * all work without any special-casing, and it is also what keeps the walk
 * from wandering into a package's own nested fixtures or test workspaces
 * once that package has already been claimed.
 *
 * The walk is bounded by `options.maxDepth` (default 4, counted from the
 * packages directory itself, so `packages/a/package.json` is depth 1) purely
 * as a safety net: depth is otherwise unbounded, and a bound keeps a
 * pathological or misconfigured tree (or a filesystem loop that symlink-
 * skipping didn't anticipate) from turning a single `buildCatalog` call into
 * an unbounded scan.
 *
 * Directory entries are sorted before recursing, so `catalog.entries` comes
 * back in a stable, filesystem-independent order.
 *
 * Everything is resolved from the `root` argument, never from
 * `process.cwd()`, so this is safe to call from any working directory.
 *
 * A directory is silently skipped, recording nothing, rather than causing an
 * error, when it:
 *   - is not a directory (once resolved via `lstatSync`) — including a
 *     symlink of any kind, which is never followed, or
 *   - is named `node_modules`, `dist`, `build`, or starts with `.`.
 *
 * Everything else that keeps a path from becoming a `CatalogEntry` — the
 * packages directory itself not existing, a directory or manifest that
 * cannot be read, or a manifest that can be read but does not parse as JSON,
 * does not parse to a plain object, or is missing a usable `name`/`version`
 * — is recorded into `catalog.skipped` instead of being silently dropped.
 * `buildCatalog` never throws for any of these; see `Catalog.skipped` and
 * `CatalogSkip` for the shape, and `evaluateCatalog` for how each is turned
 * into a finding.
 */
export function buildCatalog(root: string, options?: CatalogOptions): Catalog {
  const resolvedRoot = resolve(root);
  const packagesDirName = options?.packagesDir ?? "packages";
  const packagesAbs = resolve(resolvedRoot, packagesDirName);
  // Anything that is not a positive integer falls back to the default rather
  // than being trusted. The bound is compared with `depth > maxDepth`, and
  // that comparison is FALSE for NaN — so a NaN slipping through (a caller
  // writing `Number(process.env.MAX_DEPTH)` with the variable unset is the
  // realistic path) would silently disable the bound entirely, which is the
  // one thing this option exists to prevent.
  const requested = options?.maxDepth;
  const maxDepth = Number.isInteger(requested) && (requested as number) > 0 ? (requested as number) : 4;

  const entries: CatalogEntry[] = [];
  const skipped: CatalogSkip[] = [];

  if (!existsSync(packagesAbs)) {
    // The configured packages directory does not exist AT ALL — distinct
    // from existing-and-empty. Both previously produced the exact same
    // `{ entries: [] }`, which made a typo'd `packagesDir` byte-identical to
    // a genuinely empty/mid-setup workspace: a config mistake and a normal
    // state were indistinguishable, so `evaluateCatalog` produced zero
    // findings for both. Recording this as a skip makes the difference
    // visible — to `evaluateCatalog` and to any caller inspecting
    // `catalog.skipped` directly — while a missing directory still never
    // throws: it remains a normal, representable input, not an error
    // condition on its own. `kind: "unusable"`, not `"unreadable"`: unlike
    // an existing-but-permission-blocked directory, a definitively
    // nonexistent path cannot be hiding anything — see `CatalogSkipKind`.
    skipped.push({ path: relPath(resolvedRoot, packagesAbs), reason: "packages-dir-missing", kind: "unusable" });
    return { root: resolvedRoot, entries, skipped };
  }

  walk(packagesAbs, resolvedRoot, 1, maxDepth, entries, skipped);

  return { root: resolvedRoot, entries, skipped };
}
