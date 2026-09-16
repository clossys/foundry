/**
 * `resolveInstalledPeerVersion` — NODE-ONLY. Uses `node:module`/`node:fs`,
 * so it lives in its OWN file, never merged back into `peer-version.ts`
 * (see that file's own header for why: a browser-bundled module must
 * never import from a file carrying these imports, even a named export it
 * never calls, since a browser bundle cannot resolve `node:module`/
 * `node:fs` at all). Only `providers/resend/index.ts` imports this file,
 * and that module already does `import { Buffer } from "node:buffer"`, so
 * it is unambiguously a Node-context module.
 *
 * PORTED, NOT SHARED, from `packages/bouncer/src/internal/
 * resolve-installed-peer-version.ts`, for the same reason its paired
 * `peer-version.ts` is: this package declares zero first-party runtime
 * dependencies and will not take a sibling dependency edge to reach one
 * shared utility.
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
 * Deliberately NOT `require.resolve(peer + "/package.json")` — that form
 * throws `ERR_PACKAGE_PATH_NOT_EXPORTED` for a peer whose own `exports`
 * map doesn't explicitly expose `"./package.json"`, and `resend` is
 * exactly such a peer (this package's only one). Nor is it a read of a
 * `version` constant off the peer's own module namespace the way a
 * `react` guard can manage: `resend` exports no such constant — its
 * public surface is just `Resend` — so the filesystem walk is the only
 * form that answers this question for this peer at all. Returns
 * `undefined` for anything this can't resolve or read — never a guess.
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
