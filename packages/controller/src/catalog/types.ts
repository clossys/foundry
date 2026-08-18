/**
 * Types for @vespeneventures/catalog. See the package README for the full
 * gather/judge split this package implements: `buildCatalog` walks disk and
 * records what is there; `evaluateCatalog` judges it, computing the
 * dependency graph from each entry's own `dependencies`/`peerDependencies`
 * — never from anything a package merely declares about itself in a
 * separate, unenforced block.
 */

/**
 * One package found under a workspace's packages directory.
 */
export interface CatalogEntry {
  /** This package's own package.json "name". */
  name: string;
  /** This package's own package.json "version". */
  version: string;
  /** This package's directory, relative to the catalog's own `root`, e.g. "packages/catalog". */
  dir: string;
  /** This package's own package.json "private" — false when the field is absent. */
  private: boolean;
  /**
   * The full parsed package.json this entry was read from, verbatim.
   * Everything `evaluateCatalog` needs — `dependencies`, `peerDependencies`,
   * `exports` — lives here, not in any separately-tracked field, so storing
   * the whole manifest is what lets `evaluateCatalog` do zero I/O of its
   * own: `buildCatalog` is the one place in this package that reads a file,
   * and everything downstream works only from data already gathered into a
   * `Catalog`.
   */
  packageJson: Record<string, unknown>;
}

/**
 * Machine-readable reason `buildCatalog` could not turn some path into a
 * `CatalogEntry`, or could not even find the packages directory at all.
 *
 * `"unreadable-directory"` and `"unreadable-manifest"` are "could not
 * read" — a real I/O or permissions problem where the actual content behind
 * the failure is unknown. `"unparseable-manifest"`, `"manifest-not-object"`,
 * and `"manifest-missing-name-or-version"` are "read fine, content
 * unusable" — the file WAS read successfully but its content could not be
 * turned into a usable entry. `"packages-dir-missing"` is neither: it is
 * fully-known state (the configured directory definitively does not exist —
 * there is nothing behind it, unlike an unreadable directory, which could be
 * hiding anything), it just isn't a state with any entries in it. See
 * `CatalogSkip.kind`, which carries this grouping as a queryable field
 * rather than requiring a caller to know which reasons fall in which bucket.
 */
export type CatalogSkipReason =
  | "packages-dir-missing"
  | "unreadable-directory"
  | "unreadable-manifest"
  | "unparseable-manifest"
  | "manifest-not-object"
  | "manifest-missing-name-or-version";

/**
 * `"unreadable"` — `buildCatalog` attempted to read something and could
 * not (a directory listing failed, or a manifest file failed to open). This
 * means the catalog is provably incomplete: an unknown, unbounded amount of
 * state could be hiding behind the failure.
 *
 * `"unusable"` — `buildCatalog` has COMPLETE, certain knowledge of the
 * relevant state, and that state simply does not yield a `CatalogEntry`.
 * Two different ways that happens: a manifest was read successfully but its
 * content could not be used (bad JSON, not an object, missing a usable
 * name/version) — the failure confined to one known file's content, not an
 * unknown quantity of undiscoverable state; or the configured packages
 * directory (`"packages-dir-missing"`) definitively does not exist at all —
 * nothing could be hiding behind a path that isn't there, unlike an
 * unreadable directory that might contain anything.
 */
export type CatalogSkipKind = "unreadable" | "unusable";

/**
 * One path `buildCatalog` looked at (or was configured to look at) but did
 * not turn into a `CatalogEntry`, for a reason worth surfacing.
 *
 * Deliberate exclusions — `node_modules`, `dist`, `build`, dot-directories,
 * and symlinks — are never recorded here: skipping those is intentional
 * policy, not a failure, and recording them would drown the real signal
 * this array exists to carry.
 */
export interface CatalogSkip {
  /**
   * Repo-relative path, `/`-joined — the same convention `CatalogEntry.dir`
   * uses. For `"packages-dir-missing"`, this is the configured packages
   * directory itself (e.g. `"packages"` or a custom `packagesDir`), which
   * may not exist on disk at all.
   */
  path: string;
  /** Machine-readable reason this path was skipped. */
  reason: CatalogSkipReason;
  /** Which of the two kinds of problem this is — see `CatalogSkipKind`. */
  kind: CatalogSkipKind;
  /** The underlying error's message, when one is available (I/O and parse failures only). */
  detail?: string;
}

/** The full set of packages found on disk, plus where they were found. */
export interface Catalog {
  /** Absolute path this catalog was built from — the `root` `buildCatalog` was called with, resolved. */
  root: string;
  entries: CatalogEntry[];
  /**
   * Every path `buildCatalog` could not turn into a `CatalogEntry`, for a
   * reason worth surfacing — see `CatalogSkip`. Empty when nothing was
   * skipped. `evaluateCatalog` turns each of these into a `CatalogFinding`
   * (rule `skipped:<reason>`) — see its doc comment for the severity
   * reasoning.
   */
  skipped: CatalogSkip[];
}

/**
 * One thing `evaluateCatalog` found wrong (or, at `"warning"`, worth a look)
 * about the catalog as a whole — a question that needs the whole set of
 * packages, not one package's own manifest.
 */
export interface CatalogFinding {
  /** Stable identifier for the rule that produced this finding, e.g. `"dependency-cycle"`. */
  rule: string;
  /** `"error"` fails an evaluation; `"warning"` does not. */
  severity: "error" | "warning";
  /** Human-readable description of the problem. */
  message: string;
  /** The `CatalogEntry.name` this finding is about, when there is a single clear one. */
  package?: string;
  /** The field, subpath, or dependency name this finding is about, when there is a single clear one. */
  path?: string;
}

/** Options for `buildCatalog`. */
export interface CatalogOptions {
  /** Directory holding packages, relative to `root`. Default `"packages"`. */
  packagesDir?: string;
  /**
   * How many directory levels below `packagesDir` to search for packages.
   * `packages/foo/package.json` is depth 1; `packages/tier/foo/package.json`
   * is depth 2. Default 4. Exists as a safety net against a pathological or
   * misconfigured tree turning a single `buildCatalog` call into an
   * effectively unbounded scan — see `buildCatalog`'s doc comment.
   */
  maxDepth?: number;
}
