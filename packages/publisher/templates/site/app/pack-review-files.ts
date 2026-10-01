/**
 * The one file read behind the dev-only pack-review export route.
 *
 * It is its own module so a test can run it against a real directory: a route
 * file may export nothing but its handlers, and the route's own imports reach
 * the repository's records, which are not in this package.
 */
import { readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * Reads one output path the pack manifest lists, only from a file inside
 * `rootDir` (the repository root). Both the root and the file are resolved
 * with `realpathSync` before the check, so a symlink that points outside the
 * root is refused as a `..` segment or an absolute path is, and the root
 * itself and a directory are refused. A file whose name merely starts with
 * `..` is inside the root and is read. It throws for every refusal and every
 * read failure, and the caller answers one empty 404 with no reason.
 */
export function readPackReviewFile(rootDir: string, path: string): Uint8Array {
  const root = realpathSync(resolve(rootDir));
  const target = realpathSync(resolve(root, path));
  if (!target.startsWith(root + sep)) throw new Error("The export is outside the repository.");
  return readFileSync(target);
}
