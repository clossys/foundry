import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Written into every `clossys publish --install` out dir; other dirs are never overwritten or read as installs. */
export const INSTALL_MARKER = ".clossys-publish-install";

/**
 * Where `clossys publish --install` writes by default: one `install-<page id>` dir per page under
 * a per-root folder in the OS temp dir. Studio's `/api/publication` reads the same folder unless
 * `produce --out <dir>` names the folder the installs were written to with `--out`.
 */
export function installOutRoot(root: string): string {
  return join(tmpdir(), "clossys-publish", createHash("sha256").update(resolve(root)).digest("hex").slice(0, 12));
}
export function defaultInstallOut(root: string, pageId: string): string {
  return join(installOutRoot(root), `install-${pageId}`);
}
