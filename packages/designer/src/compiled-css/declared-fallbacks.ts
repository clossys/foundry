/**
 * Declared-value fallbacks for the generated stylesheet (`generate.ts`).
 *
 * Tailwind emits a bare `var(--x)` for an arbitrary-value utility such as
 * `p-(--spacing-sm)` or `bg-(--color-surface-base)`, and for every live
 * `@theme inline` key. A bare read renders unstyled wherever the token is not
 * in scope. This module rewrites each bare read to `var(--x, <declared>)`,
 * where `<declared>` is the value the package itself declares for `--x`,
 * read from source by code and never typed by hand:
 *
 * 1. `styles/tokens.css`, in a plain `:root` rule (only `@layer` wrappers
 *    around it; no `@media`, no `:root[...]` theme variant), so the fallback
 *    is the default (light, unbranded) value;
 * 2. `styles/theme.css` as the generator compiles it (with `theme-keys.css`
 *    inlined), in a plain `:root` rule or a `@theme` block;
 * 3. the generated output itself, first declaration in output order.
 *
 * The first source that declares a name wins. A declared value that itself
 * reads a bare `var(--y)` is expanded the same way, so the fallback carries no
 * bare read of its own. Wherever the theme is loaded, `--x` is in scope and
 * the fallback is never used, so computed style does not change.
 *
 * A bare read of a name no source declares is refused: generation throws
 * `UndeclaredTokenFallbackError` naming every such token. There is no fallback
 * chain and no invented default.
 */

export interface CustomPropertyDeclaration {
  name: string;
  value: string;
  /** Enclosing block preludes, outermost first (for example `["@layer foundry-ui-tokens", ":root"]`). */
  context: string[];
}

/** Thrown when the output reads a token with no declared source. */
export class UndeclaredTokenFallbackError extends Error {
  readonly tokens: readonly string[];
  constructor(tokens: readonly string[]) {
    super(
      `generateCompiledCss: ${tokens.length} token(s) are read with a bare var() but have no declared source in styles/tokens.css, styles/theme.css (with theme-keys.css) or the generated output, so no fallback can be emitted: ${tokens.join(", ")}. Declare each token in a source, or stop reading it.`,
    );
    this.name = "UndeclaredTokenFallbackError";
    this.tokens = tokens;
  }
}

/** A bare read: `var(--name)` with no fallback argument. */
const BARE_VAR_RE = /var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g;

/** Removes `/* ... *\/` comments outside strings. */
export function stripCssComments(css: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i] as string;
    if (quote !== null) {
      out += ch;
      if (ch === "\\" && i + 1 < css.length) {
        out += css[i + 1];
        i++;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Every custom-property declaration in `css`, with its enclosing block
 * preludes. Quotes and parentheses are tracked so a `;` inside `url(...)` or a
 * string never ends a declaration.
 */
export function collectCustomPropertyDeclarations(css: string): CustomPropertyDeclaration[] {
  const text = stripCssComments(css);
  const out: CustomPropertyDeclaration[] = [];
  const stack: string[] = [];
  let buffer = "";
  let parens = 0;
  let quote: string | null = null;
  const flushDeclaration = () => {
    const m = /^\s*(--[a-zA-Z0-9_-]+)\s*:([\s\S]*)$/.exec(buffer);
    if (m && stack.length > 0) out.push({ name: m[1] as string, value: (m[2] as string).trim(), context: [...stack] });
    buffer = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote !== null) {
      buffer += ch;
      if (ch === "\\" && i + 1 < text.length) {
        buffer += text[i + 1];
        i++;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
    } else if (ch === "(") {
      parens++;
      buffer += ch;
    } else if (ch === ")") {
      parens = Math.max(0, parens - 1);
      buffer += ch;
    } else if (parens > 0) {
      buffer += ch;
    } else if (ch === "{") {
      stack.push(buffer.trim().replace(/\s+/g, " "));
      buffer = "";
    } else if (ch === "}") {
      flushDeclaration();
      stack.pop();
    } else if (ch === ";") {
      flushDeclaration();
    } else {
      buffer += ch;
    }
  }
  return out;
}

const isLayerWrapper = (prelude: string) => /^@layer\b/.test(prelude);
const isPlainRoot = (prelude: string) => prelude === ":root" || prelude === ":root, :host";
const isThemeBlock = (prelude: string) => /^@theme\b/.test(prelude);

/** A declaration in a plain `:root` rule, with only `@layer` blocks around it. */
function isDefaultRootDeclaration(d: CustomPropertyDeclaration): boolean {
  const last = d.context[d.context.length - 1] ?? "";
  return isPlainRoot(last) && d.context.slice(0, -1).every(isLayerWrapper);
}

/** A declaration in a plain `:root` rule or a `@theme` block, with only `@layer` blocks around it. */
function isDefaultThemeDeclaration(d: CustomPropertyDeclaration): boolean {
  const last = d.context[d.context.length - 1] ?? "";
  return (isPlainRoot(last) || isThemeBlock(last)) && d.context.slice(0, -1).every(isLayerWrapper);
}

/** A declaration anywhere in the output except an `@property` registration. */
function isOutputDeclaration(d: CustomPropertyDeclaration): boolean {
  return !d.context.some((prelude) => /^@property\b/.test(prelude));
}

/**
 * A `@theme` key that reads itself with a literal default,
 * `--x: var(--x, <F>)`, declares `<F>`; any other value is declared as written.
 */
function unwrapSelfReference(name: string, value: string): string {
  const prefix = new RegExp(`^var\\(\\s*${name.replace(/[-]/g, "\\-")}\\s*,`);
  const m = prefix.exec(value);
  if (!m || !value.endsWith(")")) return value;
  return value.slice(m[0].length, -1).trim();
}

export interface DeclaredSources {
  tokensCss: string;
  /** The theme stylesheet as the generator compiles it: its own tokens import line stripped, the theme-keys stylesheet inlined. */
  themeCss: string;
}

/** The declared value of each token, by source precedence: tokens.css, then theme.css, then the output. */
export function declaredTokenValues(sources: DeclaredSources, outputCss: string): Map<string, string> {
  const declared = new Map<string, string>();
  const add = (decls: CustomPropertyDeclaration[], accept: (d: CustomPropertyDeclaration) => boolean) => {
    const own = new Map<string, string>();
    for (const d of decls) if (accept(d) && !own.has(d.name)) own.set(d.name, unwrapSelfReference(d.name, d.value));
    for (const [name, value] of own) if (!declared.has(name)) declared.set(name, value);
  };
  add(collectCustomPropertyDeclarations(sources.tokensCss), isDefaultRootDeclaration);
  add(collectCustomPropertyDeclarations(sources.themeCss), isDefaultThemeDeclaration);
  add(collectCustomPropertyDeclarations(outputCss), isOutputDeclaration);
  return declared;
}

/**
 * Rewrites every bare `var(--x)` in `css` to `var(--x, <declared value>)`,
 * expanding bare reads inside the declared value the same way. Throws
 * `UndeclaredTokenFallbackError` listing every token with no declared source
 * (or one whose declared value reads itself in a cycle).
 */
export function addDeclaredFallbacks(css: string, sources: DeclaredSources): string {
  const declared = declaredTokenValues(sources, css);
  const resolved = new Map<string, string | undefined>();
  const undeclared = new Set<string>();

  const resolve = (name: string, visiting: Set<string>): string | undefined => {
    if (resolved.has(name)) return resolved.get(name);
    const raw = declared.get(name);
    if (raw === undefined || visiting.has(name)) {
      undeclared.add(name);
      return undefined;
    }
    visiting.add(name);
    let ok = true;
    const expanded = raw.replace(BARE_VAR_RE, (whole, inner: string) => {
      const value = resolve(inner, visiting);
      if (value === undefined) {
        ok = false;
        return whole;
      }
      return `var(${inner}, ${value})`;
    });
    visiting.delete(name);
    const result = ok ? expanded : undefined;
    resolved.set(name, result);
    return result;
  };

  const out = css.replace(BARE_VAR_RE, (whole, name: string) => {
    const value = resolve(name, new Set());
    return value === undefined ? whole : `var(${name}, ${value})`;
  });
  if (undeclared.size > 0) throw new UndeclaredTokenFallbackError([...undeclared].sort());
  return out;
}
