/**
 * The dev-only pack review's read-only Director strategy store. @clossys/director owns
 * no file access to its store: the clossys CLI injects its own reader, and this site,
 * which has no clossys CLI, supplies this one. It never writes, never follows a symbolic
 * link and never leaves the strategy root. Kept apart from site-records.ts so the pack
 * review imports no record at build time.
 */
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DirectorStoreEntry, DirectorStoreReader } from "@clossys/director";

const storeFault = (fault: string, message: string) => Object.assign(new Error(message), { fault });
const absent = (error: unknown) => ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "");
const entryType = (stat: ReturnType<typeof lstatSync>): DirectorStoreEntry["type"] =>
  stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other";

/**
 * A root-relative path, confined to the root with no symbolic link on the way; undefined when
 * absent. With `finalLink`, a symbolic link as the last component is returned unresolved.
 */
function confined(root: string, path: string, finalLink = false): string | undefined {
  let anchor: string;
  try {
    if (lstatSync(root).isSymbolicLink()) throw storeFault("root-symlink", "Symlink roots are not followed");
    anchor = realpathSync(root);
  } catch (error) {
    if ((error as { fault?: string }).fault) throw error;
    throw storeFault("root-unreadable", "Strategy root is unreadable or is not a directory");
  }
  const rel = relative(anchor, resolve(anchor, path));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw storeFault("outside", "Path resolves outside the strategy root");
  let cursor = anchor;
  const parts = rel.split(sep);
  for (const [index, part] of parts.entries()) {
    cursor = join(cursor, part);
    try {
      if (lstatSync(cursor).isSymbolicLink()) {
        if (finalLink && index === parts.length - 1) return cursor;
        throw storeFault("symlink", "Symlink paths are not followed");
      }
    }
    catch (error) { if ((error as { fault?: string }).fault) throw error; if (absent(error)) return undefined; throw storeFault("path-unreadable", "Path could not be read"); }
  }
  return cursor;
}

/** The pack review's strategy reader (see the file header). */
export const siteStrategyReader: DirectorStoreReader = {
  stat(root, path) {
    if (path === ".") {
      let stat: ReturnType<typeof lstatSync>;
      try { stat = lstatSync(root); }
      catch (error) { if (absent(error)) return undefined; throw storeFault("root-unreadable", "Strategy root is unreadable or is not a directory"); }
      let real = resolve(root);
      try { real = realpathSync(real); } catch { if (!stat.isSymbolicLink()) throw storeFault("root-unreadable", "Strategy root is unreadable or is not a directory"); }
      return { type: entryType(stat), links: stat.nlink, dev: stat.dev, ino: stat.ino, real };
    }
    const full = confined(root, path, true);
    if (full === undefined) return undefined;
    const stat = lstatSync(full);
    return { type: entryType(stat), links: stat.nlink, dev: stat.dev, ino: stat.ino, real: full };
  },
  list(root, path) {
    const full = confined(root, path);
    if (full === undefined) return undefined;
    if (!lstatSync(full).isDirectory()) throw storeFault("not-directory", "Expected a directory");
    try { return readdirSync(full).sort(); } catch { throw storeFault("io", "Directory could not be listed"); }
  },
  read(root, path) {
    const full = confined(root, path);
    if (full === undefined) return undefined;
    if (!lstatSync(full).isFile()) throw storeFault("not-file", "Expected a regular file");
    try { return readFileSync(full, "utf8"); } catch { throw storeFault("io", "File could not be read"); }
  },
};
