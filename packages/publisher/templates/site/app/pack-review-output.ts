/**
 * The one file read behind the dev-only pack-review export route.
 *
 * It is its own module so a test can run it against a real directory: a route
 * file may export nothing but its handlers, and the route's own imports reach
 * the repository's records, which are not in this package.
 */
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * Reads one output path the pack manifest lists, only from inside `rootDir`
 * (the repository root that holds `clossys/`). Both the root and the file are
 * resolved through `realpathSync` BEFORE the containment check, so a symlink
 * that points outside the root is refused as surely as a `..` segment or an
 * absolute path is. `undefined` for any refusal and for any read failure
 * (missing file, a directory, no permission): the caller answers one empty
 * 404 and no reason.
 */
export function readReviewOutput(rootDir: string, path: string): Uint8Array | undefined {
  try {
    const root = realpathSync(resolve(rootDir));
    const file = realpathSync(resolve(root, path));
    const inside = relative(root, file);
    if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return undefined;
    return readFileSync(file);
  } catch {
    return undefined;
  }
}
