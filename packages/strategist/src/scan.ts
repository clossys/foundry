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
}

const DEFAULT_EXTENSIONS = [".md", ".mdx", ".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);

/**
 * Walks `root` recursively and returns every matching file's path
 * (relative to `root`, `/`-joined) and content. Throws a plain `Error` —
 * not a recorded "skip", see this file's doc comment — the moment any
 * directory cannot be listed.
 */
export function scanStrategyDirectory(root: string, options: ScanOptions = {}): ScannedFile[] {
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
  const skipDirs = new Set(options.skipDirs ?? DEFAULT_SKIP_DIRS);

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

      let content: string;
      try {
        content = readFileSync(full, "utf8");
      } catch (error) {
        throw new Error(
          `scanStrategyDirectory: cannot read file "${full}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      out.push({ path: relative(root, full).split(sep).join("/"), content });
    }
  }

  walk(root);
  return out;
}
