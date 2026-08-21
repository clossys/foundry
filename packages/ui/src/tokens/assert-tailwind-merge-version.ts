/**
 * `assertTailwindMergeVersion` — the one #182 optional-peer guard in this
 * package that is NOT wired in automatically. `tailwind-merge` is
 * imported from exactly one file, `atoms/internal/cx.ts` — but that file
 * is transitively reachable from essentially every atom (`cx()` is this
 * package's shared class-merge helper; `atoms/internal/cx.test.ts`'s own
 * header notes "every atom in this package calls `cx(...)`"), and
 * `tailwind-merge` has neither an exported version constant NOR a
 * `"./package.json"` entry in its own `exports` map (confirmed by hand:
 * its `exports` field lists only `"."` and `"./es5"` — unlike
 * `react-aria-components`, which does expose `"./package.json"` and is
 * guarded automatically from `atoms/index.ts` for exactly that reason;
 * see that file's own comment). That leaves no signal this guard could
 * read from `cx.ts` without importing `node:fs`/`node:module` —
 * confirmed empirically to fail an entire browser-platform bundle at
 * BUILD time (esbuild `--platform=browser`: "Could not resolve
 * 'node:fs'"), not just at run time, and regardless of whether the
 * importing binding is ever actually called (module resolution runs
 * before tree-shaking). Wiring the Node-only resolver into `cx.ts` would
 * therefore break every consumer bundling any atom for the browser —
 * strictly worse than the silent-failure defect #182 exists to fix.
 *
 * So this guard ships as an explicit, opt-in, Node-only function instead
 * — the same "opt-in, never a side effect of importing the package" shape
 * `assertTokenStylesLoaded` (this package's OTHER #182 guard, in this
 * same file's sibling `assert-token-styles-loaded.ts`) already
 * establishes, but Node-only rather than SSR-safe: `assertTokenStylesLoaded`
 * can run anywhere because it degrades to a no-op wherever `document`
 * doesn't exist; this guard has no such universal fallback; because there
 * is no universal SIGNAL to fall back to, only an environment where the
 * check is possible (Node) and one where it categorically is not
 * (browser, bundled or not). Call it once, in Node — a build script, a
 * setup/postinstall step, or a test — never from component code. See the
 * README's Setup section for the exact call.
 */

import { resolveInstalledPeerVersion } from "../internal/resolve-installed-peer-version.js";
import { assertPeerVersion } from "../internal/peer-version.js";
import { TAILWIND_MERGE_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

/**
 * Throws if `tailwind-merge` is absent or installed but out of range.
 * Warns once, via `console.warn`, and proceeds if its installed version
 * cannot be PARSED — including one carrying a prerelease identifier — per
 * `assertPeerVersion`'s own deliberately-inverted `indeterminate` handling
 * for #389 (see `../internal/peer-version.ts`'s header): that string is
 * external input this guard could not read, not a value that failed the
 * check, so it is never grounds to crash the caller. Node-only: relies on
 * `node:fs`/`node:module` to walk `tailwind-merge`'s installed
 * `package.json` on disk (see `resolveInstalledPeerVersion`), so it
 * throws if `document` exists but `process.versions.node` does not — i.e.
 * if it is ever mistakenly called from real browser code — rather than
 * silently reporting "not installed" for a peer that may in fact be
 * present and compatible.
 */
export function assertTailwindMergeVersion(): void {
  if (typeof document !== "undefined" && (typeof process === "undefined" || !process.versions?.node)) {
    throw new Error(
      "assertTailwindMergeVersion is Node-only (it reads tailwind-merge's installed package.json from disk) " +
        "and cannot run in a browser. Call it once from Node-side tooling — a build script, a setup step, or a " +
        "test — never from component code. See the README's Setup section.",
    );
  }
  assertPeerVersion({
    peer: "tailwind-merge",
    declaredRange: TAILWIND_MERGE_DECLARED_RANGE,
    foundVersion: resolveInstalledPeerVersion("tailwind-merge", import.meta.url),
  });
}
