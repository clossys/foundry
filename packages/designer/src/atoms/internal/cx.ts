import { TOKENS } from "../../tokens/index.js";

/**
 * `tailwind-merge`'s default config only recognizes Tailwind's OWN built-in
 * scale names for spacing (plain numbers, plus the literal `px`) and radius
 * (a fixed t-shirt-size regex). This package's spacing and radius classes
 * are named after this package's tokens instead (`px-md`, `rounded-pill`),
 * which the default config has never heard of — so out of the box, `px-md`
 * and a consumer's own `px-8` would NOT be recognized as conflicting and
 * both would ship, leaving the winner up to Tailwind's stylesheet source
 * order rather than argument order here. Confirmed by hand before writing
 * this: `twMerge("px-md px-lg")` (no extension) returns `"px-md px-lg"` —
 * both survive — while `twMerge("px-4 px-8")` correctly collapses to just
 * `"px-8"`, because 4/8 are Tailwind's own recognized values and md/lg are
 * not. The font-size case is worse than merely "unmerged": `text-body`
 * (this package's font-size class) and `text-ink-on-accent` (a color class)
 * share the `text-` prefix, and without a font-size scale of its own to
 * check first, `tailwind-merge` classifies BOTH as the text-COLOR group
 * (color accepts any suffix) and treats them as conflicting — silently
 * dropping `text-body` entirely. `cx.test.ts` pins both of these as
 * regressions.
 *
 * The fix is `extendTailwindMerge`, teaching it this package's actual
 * spacing/radius/font-size/tracking scale — derived from the real
 * `TOKENS` export below, not hand-copied, so it can never drift from the
 * tokens this package's classes actually use.
 */
function tokenSuffixes(cssPropertyPrefix: `--${string}-`): string[] {
  return Object.keys(TOKENS)
    .filter((property) => property.startsWith(cssPropertyPrefix))
    .map((property) => property.slice(cssPropertyPrefix.length));
}

/**
 * Fixes #749. This file used to `import { extendTailwindMerge } from
 * "tailwind-merge"` — a STATIC import — at the top of the module. A static
 * import is resolved and evaluated before any of this file's own code
 * runs, and throws immediately if the package cannot be found. `cx` is
 * reachable from every single atom (see `cx()`'s own doc comment below),
 * including through the server-safe barrels (`atoms/server.ts`,
 * `blocks/server.ts`, and therefore `@clossys/publisher/web`'s
 * react-server condition) — so a consumer who correctly declined to
 * install `tailwind-merge`, an optional peer per this package's own
 * `peerDependenciesMeta`, got `Cannot find package 'tailwind-merge'` the
 * moment ANY server-safe import touched `cx`, even though nothing they
 * imported was documented as needing it.
 *
 * The fix: a DYNAMIC `import()`, inside a `try`/`catch`, so an absent
 * peer is something this module can observe and degrade around instead of
 * something that propagates out of module evaluation. It is resolved
 * exactly once, via a top-level `await` — ECMAScript modules guarantee a
 * module's top-level `await` settles before any importer receives that
 * module's namespace, so by the time any caller's code can actually
 * invoke `cx()`, this has already resolved one way or the other,
 * deterministically. There is no "did the async load finish yet" race:
 * `tailwind-merge` present always means the full, token-aware merge is
 * used from the very first call; absent always means the plain-join
 * fallback is used from the very first call.
 *
 * This is presence-only. It does not replace `assertTailwindMergeVersion`
 * (`../tokens/assert-tailwind-merge-version.ts`), which is still the only
 * way to catch an INSTALLED-but-incompatible `tailwind-merge` version —
 * that guard needs `node:fs` to read the installed package's own
 * `package.json` off disk (`tailwind-merge` exposes neither an exported
 * version constant nor a `"./package.json"` `exports` entry), and
 * `node:fs`/`node:module` cannot be imported here, even conditionally:
 * confirmed empirically (esbuild `--platform=browser`) that an
 * unconditional top-level `node:fs`/`node:module` import fails an entire
 * browser bundle at BUILD time, regardless of whether the importing
 * binding is ever called, because module resolution runs before
 * tree-shaking — and `cx.ts` is reachable from a browser bundle too (every
 * interactive atom imports it). `tailwind-merge` itself carries no such
 * restriction: it is an ordinary npm package, not a Node built-in, so a
 * plain `import("tailwind-merge")` — dynamic or static — is exactly as
 * bundler-safe as this file's old static import already was.
 */
const twMerge = await (async () => {
  try {
    const { extendTailwindMerge } = await import("tailwind-merge");
    return extendTailwindMerge({
      extend: {
        theme: {
          spacing: tokenSuffixes("--spacing-"),
          radius: tokenSuffixes("--radius-"),
          text: tokenSuffixes("--text-"),
          tracking: tokenSuffixes("--tracking-"),
        },
      },
    });
  } catch {
    return undefined;
  }
})();

/**
 * Join class-name fragments, dropping falsy ones, then — when
 * `tailwind-merge` is installed — resolve conflicting Tailwind utilities
 * (see above) so the LAST class in the list wins. Every atom in this
 * package calls `cx(...builtInClasses, className)` — consumer last — so a
 * consumer's own `className` always overrides this package's defaults,
 * regardless of Tailwind's generated stylesheet order, whenever
 * `tailwind-merge` is present.
 *
 * When `tailwind-merge` is ABSENT (#749: a consumer is entitled not to
 * install it — it is declared `optional: true` in this package's own
 * `peerDependenciesMeta`), `cx` degrades to a plain join: every
 * non-falsy fragment survives, in argument order, with none of Tailwind's
 * own conflicts between them resolved. A consumer's own conflicting
 * `className` is no longer guaranteed to "win" the way it would with
 * `tailwind-merge` installed — that is a real, visible difference from
 * the merged case — but it is not a regression against what an optional
 * peer promises. The only alternative degrade-free behavior would be to
 * make `tailwind-merge` non-optional, which is the wrong direction (see
 * #749): it would convert every token-only consumer's install into one
 * that silently carries a component-runtime dependency it never uses.
 */
export function cx(...classes: Array<string | false | null | undefined>): string {
  const joined = classes.filter(Boolean).join(" ");
  return twMerge ? twMerge(joined) : joined;
}
