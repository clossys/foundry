/**
 * `extractBrandCssSlots` — the brandable slot names a stylesheet declares.
 * `strategist-check brand-coverage` reads `brand/brand.css` by default and
 * proves every custom property declared there has a brand derivation.
 *
 * PURE, no I/O, dependency-free: comments are blanked, then every
 * `--name:` declaration at any nesting depth (including inside `@media`)
 * is collected once, in source order. `var(--name)` uses are not
 * declarations and are not collected.
 */

/** Repository-relative location of the single Designer overlay stylesheet. */
export const BRAND_CSS_SEGMENTS = ["brand", "brand.css"] as const;

export function extractBrandCssSlots(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const slots: string[] = [];
  const seen = new Set<string>();
  for (const match of stripped.matchAll(/(?:^|[;{\s])(--[a-zA-Z0-9_-]+)\s*:/g)) {
    const name = match[1] as string;
    if (!seen.has(name)) {
      seen.add(name);
      slots.push(name);
    }
  }
  return slots;
}
