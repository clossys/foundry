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
