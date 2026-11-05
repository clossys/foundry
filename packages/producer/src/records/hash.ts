import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Hash } from "./types.js";

/**
 * `sha256-tree/1`: the content hash shared by element records and package
 * references. Each file contributes the line `<sha256 hex>  <posix path>\n`;
 * lines are sorted by path and the concatenation is hashed again.
 *
 * Designer's references check (packages/designer/scripts/check-references.mjs)
 * implements the same algorithm without importing this module, and a Producer
 * test recomputes manifest hashes with this one so the two cannot drift.
 */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function treeHash(files: readonly { readonly path: string; readonly sha256: string }[]): Hash {
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => `${file.sha256}  ${file.path}\n`)
    .join("");
  return `sha256:${sha256Hex(lines)}`;
}

/** Every regular file below `dir`, as sorted posix paths relative to it. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

export function hashFiles(dir: string, paths: readonly string[]): Hash {
  return treeHash(paths.map((path) => ({ path, sha256: sha256Hex(readFileSync(join(dir, path))) })));
}
