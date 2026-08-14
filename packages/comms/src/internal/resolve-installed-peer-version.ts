/**
 * `resolveInstalledPeerVersion` — NODE-ONLY. Uses `node:module`/`node:fs`,
 * so it lives in its OWN file, never merged back into `peer-version.ts`
 * (see that file's own header for the parity rationale). `resend/index.ts`
 * — unambiguously Node context — is the one file that imports this.
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Resolves `peer`'s real on-disk version: resolves its main entry via
 * ordinary Node module resolution (from `fromSpecifier`, normally this
 * module's own `import.meta.url`), then walks up from that file to the
 * nearest `package.json` whose own `"name"` matches `peer`.
 *
 * Deliberately NOT `require.resolve(peer + "/package.json")` — confirmed
 * against real installs while building this guard: that form throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` for a peer whose own `exports` map
 * doesn't explicitly expose `"./package.json"` (`@clerk/nextjs` and
 * `resend` both do this; `next`, `svix`, `react`, and `typescript`
 * happen not to, which is exactly the kind of per-package inconsistency
 * this walk-up avoids depending on). Returns `undefined` for anything
 * this can't resolve or read — never a guess.
 */
export function resolveInstalledPeerVersion(peer: string, fromSpecifier: string): string | undefined {
  try {
    const require = createRequire(fromSpecifier);
    let dir = dirname(require.resolve(peer));
    for (let i = 0; i < 16; i += 1) {
      const candidate = join(dir, "package.json");
      if (existsSync(candidate)) {
        const raw: unknown = JSON.parse(readFileSync(candidate, "utf8"));
        if (raw && typeof raw === "object" && (raw as { name?: unknown }).name === peer) {
          const version = (raw as { version?: unknown }).version;
          return typeof version === "string" ? version : undefined;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
