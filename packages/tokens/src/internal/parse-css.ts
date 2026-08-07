/**
 * A minimal, test-only CSS reader — NOT part of this package's public API
 * (nothing under `src/internal/` is reachable from `src/index.ts`, and
 * `package.json#exports` never points here). It exists solely so the
 * tests can parse `styles/*.css` as data and check it against
 * `src/tokens.ts`, without pulling in a real CSS parser as a dependency
 * this package would otherwise have zero reason to carry.
 */

/** Strip `/* ... *\/` comments. CSS has no line-comment syntax, so this is the only kind to remove. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Extract every `--custom-property: value;` declaration from the FIRST
 * top-level `:root {` block in `css` (matched as the literal selector
 * `:root`, not `:root[...]` or any other block) — `styles/tokens.css`
 * declares exactly one such block and nothing inside it nests braces, so
 * "the next `}` after the opening `{`" is the real end of the block, not
 * an approximation.
 *
 * Returns a Map from property name (including the leading `--`) to its
 * declared value, trimmed. Declaration order is preserved.
 */
export function parseRootDeclarations(css: string): Map<string, string> {
  const cleaned = stripComments(css);
  const rootStart = cleaned.search(/:root\s*\{/);
  if (rootStart === -1) {
    throw new Error("parseRootDeclarations: no top-level `:root {` block found");
  }
  const openBrace = cleaned.indexOf("{", rootStart);
  const closeBrace = cleaned.indexOf("}", openBrace);
  if (openBrace === -1 || closeBrace === -1) {
    throw new Error("parseRootDeclarations: unterminated `:root { ... }` block");
  }
  const body = cleaned.slice(openBrace + 1, closeBrace);

  const declarations = new Map<string, string>();
  const declRe = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]*);/g;
  for (const match of body.matchAll(declRe)) {
    const name = match[1]!;
    const value = match[2]!.trim();
    declarations.set(name, value);
  }
  return declarations;
}

/**
 * Extract every `--custom-property: value;` declaration from the block
 * whose selector, verbatim, is exactly `selector` — used for the two dark
 * blocks (`:root:not([data-theme="light"])`, `:root[data-theme="dark"]`,
 * and their `[data-brand-bound]` counterparts in `brand-template.css`),
 * which `parseRootDeclarations` above cannot reach since it only ever
 * matches the bare literal `:root`.
 *
 * Matching is a plain substring search for `selector` followed by
 * (optional whitespace and) `{`, not a regex — CSS selectors are full of
 * regex metacharacters (`[`, `]`, `"`, `(`, `)`, `:`) that would otherwise
 * need escaping. Because several of this package's real selectors are
 * textual PREFIXES of one another (`:root[data-brand-bound]` is a prefix
 * of `:root[data-brand-bound][data-theme="dark"]`), a match only counts if
 * the very next non-whitespace character after `selector` is `{` — a
 * prefix hit where the next character is `[` or `:` is skipped and the
 * search continues. Works whether the block sits at the top level or
 * nested inside `@media { ... }`: this function locates the selector's own
 * block directly, so it never needs to know about (or parse) the wrapper.
 * Like `parseRootDeclarations`, it assumes no nested braces inside the
 * block — true for every block this package declares.
 */
export function parseDeclarationsForSelector(css: string, selector: string): Map<string, string> {
  const cleaned = stripComments(css);
  let searchFrom = 0;
  for (;;) {
    const idx = cleaned.indexOf(selector, searchFrom);
    if (idx === -1) {
      throw new Error(`parseDeclarationsForSelector: selector ${JSON.stringify(selector)} not found in CSS`);
    }
    let i = idx + selector.length;
    while (i < cleaned.length && /\s/.test(cleaned[i]!)) i++;
    if (cleaned[i] === "{") {
      const openBrace = i;
      const closeBrace = cleaned.indexOf("}", openBrace);
      if (closeBrace === -1) {
        throw new Error(`parseDeclarationsForSelector: unterminated block for ${JSON.stringify(selector)}`);
      }
      const body = cleaned.slice(openBrace + 1, closeBrace);
      const declarations = new Map<string, string>();
      const declRe = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]*);/g;
      for (const match of body.matchAll(declRe)) {
        declarations.set(match[1]!, match[2]!.trim());
      }
      return declarations;
    }
    // `selector` matched here only as a prefix of a longer selector
    // (e.g. `:root[data-brand-bound]` inside `:root[data-brand-bound][data-theme="dark"]`)
    // — not a real match. Keep scanning for the next occurrence.
    searchFrom = idx + 1;
  }
}

/**
 * Every custom-property name (`--...`) that appears ANYWHERE in `css`,
 * including inside comments — used to check that a token's name shows up
 * somewhere in `brand-template.css` (live or as a commented-out optional
 * slot), and that no forbidden name segment appears anywhere at all.
 */
export function findAllCustomPropertyNames(css: string): Set<string> {
  const names = new Set<string>();
  for (const match of css.matchAll(/--[a-zA-Z0-9-]+/g)) {
    names.add(match[0]);
  }
  return names;
}
