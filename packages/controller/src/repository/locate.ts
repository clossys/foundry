import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { CANONICAL_REPOSITORY_PROFILE_PATH } from "./types.js";

/**
 * `repository-check`'s own filesystem discovery (issue #315). This is
 * intentionally NOT re-exported from `./index.ts`: the public `/repository`
 * subpath ships zero filesystem I/O by design (see the package README), and
 * this module exists solely so the CLI wrapper -- which already owns the
 * only I/O this package performs -- can locate a declaration without a
 * caller having to name its path first.
 */

/** The exact filename the canonical location and every known non-canonical location use. */
const CANONICAL_DECLARATION_FILENAME = "repository-profile.json";

/**
 * A second name issue #315 found one real consumer had already used for the
 * same artifact in the canonical directory -- a second noun for one object.
 * Matched by exact filename, deliberately not by sniffing arbitrary JSON
 * shape: every other evaluator in this package discovers nothing and reads
 * only what a caller names, and a content-sniffing search would break that
 * discipline for an unbounded set of unrelated repository files.
 */
const KNOWN_ALTERNATE_DECLARATION_FILENAMES: readonly string[] = ["repository-declaration.json"];

const DECLARATION_FILENAMES = new Set<string>([CANONICAL_DECLARATION_FILENAME, ...KNOWN_ALTERNATE_DECLARATION_FILENAMES]);

/** Directories a declaration search skips: never a repository's own source. */
const EXCLUDED_DIRECTORY_NAMES = new Set<string>([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
]);

export interface RepositoryDeclarationLocation {
  /** Repository-relative, POSIX-separated path to the file that was found. */
  readonly path: string;
  /** Whether `path` is exactly `CANONICAL_REPOSITORY_PROFILE_PATH`. */
  readonly canonical: boolean;
}

function toPosixRelative(root: string, absolutePath: string): string {
  const relativePath = relative(root, absolutePath);
  return sep === "/" ? relativePath : relativePath.split(sep).join("/");
}

/** Deterministic (sorted) walk collecting every candidate declaration filename under `root`. */
function findCandidates(root: string): string[] {
  const matches: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const directory = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name)) stack.push(join(directory, entry.name));
        continue;
      }
      if (entry.isFile() && DECLARATION_FILENAMES.has(entry.name)) {
        matches.push(join(directory, entry.name));
      }
    }
  }
  return matches.sort();
}

/**
 * Locates a repository's declaration under `repositoryRoot` without being
 * told where it is. The canonical location
 * (`governance/repository-profile.json`) is always checked first and, when
 * present, is always what is returned -- a file anywhere else never shadows
 * it. Otherwise the tree is searched (skipping `.git`, `node_modules`, and
 * common build-output directories) for the canonical filename in another
 * directory or one known alternate filename, so a declaration a consumer
 * parked somewhere else is still found, and reported as non-canonical,
 * rather than silently treated as absent. Returns `undefined` only when no
 * declaration exists anywhere under the root.
 */
export function locateRepositoryProfile(repositoryRoot: string): RepositoryDeclarationLocation | undefined {
  const canonicalAbsolute = join(repositoryRoot, ...CANONICAL_REPOSITORY_PROFILE_PATH.split("/"));
  if (existsSync(canonicalAbsolute) && statSync(canonicalAbsolute).isFile()) {
    return { path: CANONICAL_REPOSITORY_PROFILE_PATH, canonical: true };
  }

  const [first] = findCandidates(repositoryRoot);
  if (first === undefined) return undefined;
  return { path: toPosixRelative(repositoryRoot, first), canonical: false };
}
