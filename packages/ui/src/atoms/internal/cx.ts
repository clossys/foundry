import { extendTailwindMerge } from "tailwind-merge";
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

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: tokenSuffixes("--spacing-"),
      radius: tokenSuffixes("--radius-"),
      text: tokenSuffixes("--text-"),
      tracking: tokenSuffixes("--tracking-"),
    },
  },
});

/**
 * Join class-name fragments, dropping falsy ones, then resolve conflicting
 * Tailwind utilities (see above) so the LAST class in the list wins. Every
 * atom in this package calls `cx(...builtInClasses, className)` — consumer
 * last — so a consumer's own `className` always overrides this package's
 * defaults, regardless of Tailwind's generated stylesheet order.
 */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return twMerge(classes.filter(Boolean).join(" "));
}
