/**
 * `extractBrandCssSlots` — the brandable slot names a stylesheet declares.
 * `strategist-check brand-coverage` reads `brand/brand.css` by default and
 * proves every custom property declared there has a brand derivation.
 *
 * PURE, no I/O, dependency-free: comments are blanked and quoted strings
 * are emptied in one pass (so a comment marker inside a string, or a
 * `--name:` inside a string, never counts), then every `--name:`
 * declaration at any nesting depth (including inside `@media`) is
 * collected once, in source order. `var(--name)` uses are not
 * declarations and are not collected.
 *
 * Deliberately lenient at the edges, so a slot is over-collected rather than
 * silently dropped:
 * - An unterminated comment (`/*` with no closing marker) is not blanked, so
 *   declarations after it are still collected, although a browser would treat
 *   the rest of the file as comment.
 * - An unterminated string is not emptied, so declarations after it are still
 *   collected. A stray quote can also pair with a later quote and empty the
 *   text between them, which hides any declaration in that span.
 * - A name that follows `(`, with or without whitespace, is a feature or
 *   style-query test (`@supports (--a: 1)`, `style( --a: x )`), not a
 *   declaration, and is not collected.
 */

/** Repository-relative location of the single Designer overlay stylesheet. */
export const BRAND_CSS_SEGMENTS = ["brand", "brand.css"] as const;

export function extractBrandCssSlots(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'/g, (token) =>
    token.startsWith("/") ? " " : '""',
  );
  const slots: string[] = [];
  const seen = new Set<string>();
  for (const match of stripped.matchAll(/(?:^|[;{\s])(--(?:[\w-]|[^\x00-\x7F]|\\.)+)\s*:/g)) {
    const name = match[1] as string;
    if (follows(stripped, match.index + match[0].indexOf(name), "(")) continue;
    if (!seen.has(name)) {
      seen.add(name);
      slots.push(name);
    }
  }
  return slots;
}

/** True when the nearest non-whitespace character before `index` is `char`. */
function follows(text: string, index: number, char: string): boolean {
  let i = index - 1;
  while (i >= 0 && /\s/.test(text[i] as string)) i -= 1;
  return i >= 0 && text[i] === char;
}
