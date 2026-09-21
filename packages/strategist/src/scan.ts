/**
 * `scanStrategyDirectory` — the I/O half of the facts gate. Walks a real
 * directory and reads every file matching `options.extensions` into a
 * `ScannedFile[]`, which `checkFactsTraceability` (see `facts-gate.ts`,
 * pure) then evaluates. Kept as a separate function, in a separate file,
 * for the same reason `buildCatalog`/`evaluateCatalog` are split in
 * `@example/catalog`: the gate itself must stay a pure function a
 * test can call directly with fixture strings, with zero real filesystem
 * involved.
 *
 * FAILS CLOSED: an unreadable directory throws rather than being silently
 * treated as empty, matching this repository's own
 * `scripts/check-contamination-classes.mjs` walker — a directory this
 * function could not read might be hiding an unknown, unbounded amount of
 * prose, and reporting "0 files, 0 findings" for that case would read as a
 * clean pass when nothing was actually verified. The CLI (`cli.ts`) is what
 * turns this thrown error into exit code 2.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import type { ScannedFile } from "./facts-gate.js";

export interface ScanOptions {
  /** File extensions to read, each including the leading dot. Default: markdown plus common source/copy files. */
  extensions?: string[];
  /** Directory names never descended into. Default: node_modules, .git, dist, build, coverage. */
  skipDirs?: string[];
  /**
   * Repo-relative path globs to omit from the walk (repeatable on the CLI as
   * `--exclude`). Use for test/fixture paths that `--skip-dirs` cannot express.
   */
  excludeGlobs?: string[];
}

/**
 * Minimal glob match for scan excludes (suffix globs, fixture-directory
 * segments, and exact relative paths). Exported for unit tests.
 */
export function pathMatchesExcludeGlob(pattern: string, filePath: string): boolean {
  const normPattern = pattern.replace(/\\/g, "/");
  const normPath = filePath.replace(/\\/g, "/");
  if (normPattern === normPath) return true;

  if (normPattern.startsWith("**/") && normPattern.endsWith("/**")) {
    const segment = normPattern.slice(3, -3);
    return normPath.includes(`/${segment}/`) || normPath.startsWith(`${segment}/`);
  }

  const slash = normPattern.lastIndexOf("/");
  const filePart = slash === -1 ? normPattern : normPattern.slice(slash + 1);
  if (filePart.startsWith("*.")) {
    const suffix = filePart.slice(1);
    const prefixOk =
      slash === -1 || normPattern.startsWith("**/") || normPath.startsWith(normPattern.slice(0, slash + 1));
    return prefixOk && normPath.endsWith(suffix);
  }

  if (normPattern.includes("*")) {
    const escaped = normPattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*");
    return new RegExp(`^${escaped}$`).test(normPath);
  }

  return false;
}

const DEFAULT_EXTENSIONS = [".md", ".mdx", ".ts", ".tsx", ".js", ".jsx"];
/** Built-in directory names never descended into; CLI `--skip-dirs` values are added to this list. */
export const DEFAULT_SKIP_DIRS = ["node_modules", ".git", "dist", "build", "coverage"];
const DEFAULT_SKIP_DIRS_SET = new Set(DEFAULT_SKIP_DIRS);

/**
 * Walks `root` recursively and returns every matching file's path
 * (relative to `root`, `/`-joined) and content. Throws a plain `Error` —
 * not a recorded "skip", see this file's doc comment — the moment any
 * directory cannot be listed.
 */
export function scanStrategyDirectory(root: string, options: ScanOptions = {}): ScannedFile[] {
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
  const skipDirs = new Set(options.skipDirs ?? DEFAULT_SKIP_DIRS_SET);
  const excludeGlobs = options.excludeGlobs ?? [];

  const out: ScannedFile[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      throw new Error(
        `scanStrategyDirectory: cannot read directory "${dir}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue; // broken symlink — nothing to read, not a directory-listing failure
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!stat.isFile()) continue;
      if (!extensions.has(extname(entry).toLowerCase())) continue;

      const relPath = relative(root, full).split(sep).join("/");
      if (excludeGlobs.some((glob) => pathMatchesExcludeGlob(glob, relPath))) continue;

      let content: string;
      try {
        content = readFileSync(full, "utf8");
      } catch (error) {
        throw new Error(
          `scanStrategyDirectory: cannot read file "${full}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      out.push({ path: relPath, content });
    }
  }

  walk(root);
  return out;
}
