/**
 * `resolveInstalledPeerVersion` — NODE-ONLY. Uses `node:module`/`node:fs`,
 * so it lives in its OWN file, never merged back into `peer-version.ts`
 * (see that file's own header for why: several of this package's guard
 * call sites are reachable from a browser bundle, and an unconditional
 * top-level `node:fs`/`node:module` import fails a browser-platform
 * bundle at BUILD time — confirmed empirically with esbuild's own
 * `--platform=browser` — regardless of whether the importing binding is
 * ever actually called, since module resolution runs before
 * tree-shaking). Only genuinely Node-context call sites import this file:
 * `tokens/assert-tailwind-merge-version.ts` (an explicit, opt-in,
 * Node-only diagnostic — see its own header for why `tailwind-merge`
 * specifically needs this instead of the automatic guards `react` and
 * `react-aria-components` get) and `compiled-css/generate.ts` (a
 * repository-internal build tool with no public `exports` subpath, never
 * reachable by an external consumer at all).
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
 * Deliberately NOT `require.resolve(peer + "/package.json")` — some
 * peers' own `exports` maps don't expose `"./package.json"` at all (this
 * package's own `tailwind-merge` and `@internationalized/date` are two
 * such cases, confirmed by hand while building this guard: both declare
 * an `exports` map that lists only their real entry subpaths, so a direct
 * `package.json` import throws `ERR_PACKAGE_PATH_NOT_EXPORTED`) — this
 * walk-up avoids depending on that per-package inconsistency. Returns
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
