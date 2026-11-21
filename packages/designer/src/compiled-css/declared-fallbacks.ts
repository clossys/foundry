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
 * 3. the package default theme (`defaultThemeCss()` in
 *    `src/builder/theme/css.ts`, the theme a consumer gets when it pins no
 *    `themes.*` slot), in its light `:root` or `:root[data-brand-bound]` rule;
 * 4. the generated output itself, first declaration in output order;
 * 5. Tailwind's own default theme (read from the installed tailwindcss
 *    package), in a `@theme` block, for the default keys the stock shadcn
 *    parts read (`--text-sm`, `--font-weight-medium`, ...).
 *
 * The first source that declares a name wins. A declared value that itself
 * reads a bare `var(--y)` is expanded the same way, so the fallback carries no
 * bare read of its own. Wherever the theme is loaded, `--x` is in scope and
 * the fallback is never used, so computed style does not change.
 *
 * Two kinds of read have no declared value and are written `var(--x, unset)`,
 * which computes the same as a read of an unset variable today:
 *
 * - a runtime-only variable: one the package's own sources set inline
 *   (`style={{ "--x": ... }}`, `setProperty("--x", ...)`; found by code in
 *   `runtime-setters.ts`) and no source declares;
 * - `--tw` in the feature query Tailwind's `supports-*` variant generates,
 *   `@supports (<property>: var(--tw))`, when no input stylesheet wrote it.
 *
 * Any other bare read of a name no source declares is refused: generation
 * throws `UndeclaredTokenFallbackError` naming every such token. There is no
 * fallback chain and no invented default.
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
      `generateCompiledCss: ${tokens.length} token(s) are read with a bare var() but have no declared source in styles/tokens.css, styles/theme.css (with theme-keys.css), the package default theme, the generated output or Tailwind's default theme, and no inline setter in the package sources, so no fallback can be emitted: ${tokens.join(", ")}. Declare each token in a source, or stop reading it.`,
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

/** A light declaration of the package default theme: `:root` or `:root[data-brand-bound]`, only `@layer` wrappers around it. */
function isDefaultPackageThemeDeclaration(d: CustomPropertyDeclaration): boolean {
  const last = d.context[d.context.length - 1] ?? "";
  return (isPlainRoot(last) || last === ":root[data-brand-bound]") && d.context.slice(0, -1).every(isLayerWrapper);
}

/** A declaration in a `@theme` block, only `@layer` wrappers around it. */
function isThemeBlockDeclaration(d: CustomPropertyDeclaration): boolean {
  const last = d.context[d.context.length - 1] ?? "";
  return isThemeBlock(last) && d.context.slice(0, -1).every(isLayerWrapper);
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
  /** The package default theme stylesheet (`defaultThemeCss()`). */
  defaultThemeCss: string;
  /** Tailwind's own default theme stylesheet, read from the installed tailwindcss package. */
  tailwindThemeCss: string;
  /** Custom properties the package sources set inline (`runtimeSetVariables`); a bare read of one with no declared value falls back to `unset`. */
  runtimeSetVariables: ReadonlySet<string>;
}

/** The feature query Tailwind's `supports-*` variant generates for a bare property name. */
const TAILWIND_SUPPORTS_RE = /@supports\s*\(\s*([a-z-]+)\s*:\s*var\(\s*--tw\s*\)\s*\)/g;

/** Runtime-only fallback: computes the same as a read of an unset variable. */
const RUNTIME_ONLY_FALLBACK = "unset";

/** The declared value of each token, by source precedence: tokens.css, theme.css, the package default theme, the output, Tailwind's default theme. */
export function declaredTokenValues(sources: DeclaredSources, outputCss: string): Map<string, string> {
  const declared = new Map<string, string>();
  const add = (decls: CustomPropertyDeclaration[], accept: (d: CustomPropertyDeclaration) => boolean) => {
    const own = new Map<string, string>();
    for (const d of decls) if (accept(d) && !own.has(d.name)) own.set(d.name, unwrapSelfReference(d.name, d.value));
    for (const [name, value] of own) if (!declared.has(name)) declared.set(name, value);
  };
  add(collectCustomPropertyDeclarations(sources.tokensCss), isDefaultRootDeclaration);
  add(collectCustomPropertyDeclarations(sources.themeCss), isDefaultThemeDeclaration);
  add(collectCustomPropertyDeclarations(sources.defaultThemeCss), isDefaultPackageThemeDeclaration);
  add(collectCustomPropertyDeclarations(outputCss), isOutputDeclaration);
  add(collectCustomPropertyDeclarations(sources.tailwindThemeCss), isThemeBlockDeclaration);
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
  const authored = stripCssComments(`${sources.tokensCss}\n${sources.themeCss}`);
  const resolved = new Map<string, string | undefined>();
  const undeclared = new Set<string>();

  const resolve = (name: string, visiting: Set<string>): string | undefined => {
    if (resolved.has(name)) return resolved.get(name);
    const raw = declared.get(name);
    if (raw === undefined && sources.runtimeSetVariables.has(name)) {
      resolved.set(name, RUNTIME_ONLY_FALLBACK);
      return RUNTIME_ONLY_FALLBACK;
    }
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

  // Tailwind's own `@supports (<property>: var(--tw))`, never an authored one.
  const withQueries = declared.has("--tw")
    ? css
    : css.replace(TAILWIND_SUPPORTS_RE, (whole, property: string) =>
        authored.includes(whole) ? whole : `@supports (${property}: var(--tw, ${RUNTIME_ONLY_FALLBACK}))`);
  const out = withQueries.replace(BARE_VAR_RE, (whole, name: string) => {
    const value = resolve(name, new Set());
    return value === undefined ? whole : `var(${name}, ${value})`;
  });
  if (undeclared.size > 0) throw new UndeclaredTokenFallbackError([...undeclared].sort());
  return out;
}

/** A declaration in a plain `:root` rule or a `@theme` block of the generated output (a global declaration, not a scoped one). */
function isGlobalOutputDeclaration(d: CustomPropertyDeclaration): boolean {
  return isDefaultThemeDeclaration(d);
}

/**
 * The global declared value of each token: the same sources and precedence as `declaredTokenValues`,
 * except that a declaration in the generated output counts only when it sits in a plain `:root` rule
 * or a `@theme` block. A token declared only inside a scoped rule (`.x { --y: ... }`) is absent here.
 */
export function globalDeclaredTokenValues(sources: DeclaredSources, outputCss: string): Map<string, string> {
  const declared = new Map<string, string>();
  const add = (decls: CustomPropertyDeclaration[], accept: (d: CustomPropertyDeclaration) => boolean) => {
    const own = new Map<string, string>();
    for (const d of decls) if (accept(d) && !own.has(d.name)) own.set(d.name, unwrapSelfReference(d.name, d.value));
    for (const [name, value] of own) if (!declared.has(name)) declared.set(name, value);
  };
  add(collectCustomPropertyDeclarations(sources.tokensCss), isDefaultRootDeclaration);
  add(collectCustomPropertyDeclarations(sources.themeCss), isDefaultThemeDeclaration);
  add(collectCustomPropertyDeclarations(sources.defaultThemeCss), isDefaultPackageThemeDeclaration);
  add(collectCustomPropertyDeclarations(outputCss), isGlobalOutputDeclaration);
  add(collectCustomPropertyDeclarations(sources.tailwindThemeCss), isThemeBlockDeclaration);
  return declared;
}

/** `@property --tw-* { initial-value: V }` registrations in `css`: Tailwind's declared value for its own internal properties. */
export function tailwindPropertyInitialValues(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const text = stripCssComments(css);
  for (const m of text.matchAll(/@property\s+(--tw-[a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g)) {
    const initial = /(?:^|;)\s*initial-value\s*:([^;]*)/.exec(m[2] as string);
    if (initial && !out.has(m[1] as string)) out.set(m[1] as string, (initial[1] as string).trim());
  }
  return out;
}

/** How a `var(--x[, F])` read's fallback is judged: equal to a global declared value, or listed by name and left as written. */
export type FallbackReadKind =
  /** A global declared value exists; the fallback must equal it (expanded). */
  | "global"
  /** A Tailwind `--tw-*` property; the fallback must equal its `@property` initial value. */
  | "tw-property"
  /** Set only inline at runtime (`runtime-setters.ts`); no declared value. */
  | "runtime"
  /** Declared only inside a scoped rule of the output; no global value. */
  | "scoped"
  /** A global value exists, but it reads a token with no global value, so it cannot be expanded. */
  | "unresolvable"
  /** No source declares it and nothing sets it. */
  | "undeclared";

export interface FallbackRead {
  name: string;
  /** The fallback as written, or `null` for a bare read. */
  fallback: string | null;
  kind: FallbackReadKind;
  /** For `global` and `tw-property`: the value the fallback must equal. */
  expected?: string;
  /** Character offset of `var(` in the input. */
  offset: number;
}

/** Splits `css` into alternating code and comment segments, so reads inside comments are never judged or rewritten. */
function codeSegments(css: string): { text: string; code: boolean }[] {
  const out: { text: string; code: boolean }[] = [];
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i] as string;
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      if (i > start) out.push({ text: css.slice(start, i), code: true });
      out.push({ text: css.slice(i, stop), code: false });
      start = stop;
      i = stop - 1;
    }
  }
  if (start < css.length) out.push({ text: css.slice(start), code: true });
  return out;
}

/** The `var(` read starting at `at`: its name, fallback (or null) and end offset (exclusive). */
function parseVar(text: string, at: number): { name: string; fallback: string | null; fallbackStart: number; end: number } | undefined {
  let depth = 0;
  let comma = -1;
  for (let j = at + 3; j < text.length; j++) {
    const ch = text[j];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        const name = text.slice(at + 4, comma < 0 ? j : comma).trim();
        if (!/^--[a-zA-Z0-9_-]+$/.test(name)) return undefined;
        return { name, fallback: comma < 0 ? null : text.slice(comma + 1, j).trim(), fallbackStart: comma + 1, end: j + 1 };
      }
    } else if (ch === "," && depth === 1 && comma < 0) comma = j;
  }
  return undefined;
}

/** The judge for one stylesheet: classifies each read and knows each global token's expanded value. */
function fallbackJudge(sources: DeclaredSources, outputCss: string) {
  const global = globalDeclaredTokenValues(sources, outputCss);
  const scoped = declaredTokenValues(sources, outputCss);
  const twInitial = tailwindPropertyInitialValues(outputCss);
  const expanded = new Map<string, string | undefined>();
  const expand = (name: string, visiting: Set<string>): string | undefined => {
    if (expanded.has(name)) return expanded.get(name);
    const raw = global.get(name);
    if (raw === undefined) return sources.runtimeSetVariables.has(name) ? RUNTIME_ONLY_FALLBACK : undefined;
    if (visiting.has(name)) return undefined;
    visiting.add(name);
    let ok = true;
    const value = raw.replace(BARE_VAR_RE, (whole, inner: string) => {
      const v = expand(inner, visiting);
      if (v === undefined) {
        ok = false;
        return whole;
      }
      return `var(${inner}, ${v})`;
    });
    visiting.delete(name);
    const result = ok ? value : undefined;
    expanded.set(name, result);
    return result;
  };
  const classify = (name: string): { kind: FallbackReadKind; expected?: string } => {
    if (/^--tw-/.test(name) && twInitial.has(name) && !global.has(name)) return { kind: "tw-property", expected: twInitial.get(name) as string };
    if (global.has(name)) {
      const value = expand(name, new Set());
      return value === undefined ? { kind: "unresolvable" } : { kind: "global", expected: value };
    }
    if (scoped.has(name)) return { kind: "scoped" };
    if (sources.runtimeSetVariables.has(name)) return { kind: "runtime" };
    return { kind: "undeclared" };
  };
  return { classify };
}

/**
 * Every `var(--x[, F])` read in `css` outside comments, nested reads included, with how its fallback
 * is judged. The judge reads the same declared sources as `addDeclaredFallbacks`; `outputCss` is the
 * generated stylesheet (`compiled.css`), for its global declarations and Tailwind's `@property` values.
 */
export function classifyFallbackReads(css: string, sources: DeclaredSources, outputCss: string): FallbackRead[] {
  const { classify } = fallbackJudge(sources, outputCss);
  const reads: FallbackRead[] = [];
  let base = 0;
  for (const segment of codeSegments(css)) {
    if (segment.code) {
      for (let i = segment.text.indexOf("var("); i >= 0; i = segment.text.indexOf("var(", i + 4)) {
        const read = parseVar(segment.text, i);
        if (!read) continue;
        reads.push({ name: read.name, fallback: read.fallback, offset: base + i, ...classify(read.name) });
      }
    }
    base += segment.text.length;
  }
  return reads;
}

/**
 * Rewrites `css` so every read of a global token carries its expanded declared value as fallback,
 * every Tailwind `--tw-*` read its `@property` initial value, and a bare read of a runtime-only
 * token `unset`. Scoped, runtime and unresolvable reads that already carry a fallback are left as
 * written. Throws `UndeclaredTokenFallbackError` for a bare read with no value to write.
 */
export function alignDeclaredFallbacks(css: string, sources: DeclaredSources, outputCss: string): string {
  const { classify } = fallbackJudge(sources, outputCss);
  const refused = new Set<string>();
  const rewrite = (text: string): string => {
    let out = "";
    let last = 0;
    for (let i = text.indexOf("var("); i >= 0; i = text.indexOf("var(", i + 4)) {
      if (i < last) continue;
      const read = parseVar(text, i);
      if (!read) continue;
      const { kind, expected } = classify(read.name);
      let replacement: string;
      if ((kind === "global" || kind === "tw-property") && expected !== undefined) replacement = `var(${read.name}, ${expected})`;
      else if (read.fallback === null) {
        if (kind === "runtime") replacement = `var(${read.name}, ${RUNTIME_ONLY_FALLBACK})`;
        else {
          refused.add(read.name);
          replacement = text.slice(i, read.end);
        }
      } else replacement = `var(${read.name}, ${rewrite(read.fallback)})`;
      out += text.slice(last, i) + replacement;
      last = read.end;
    }
    return out + text.slice(last);
  };
  const out = codeSegments(css).map((s) => (s.code ? rewrite(s.text) : s.text)).join("");
  if (refused.size > 0) throw new UndeclaredTokenFallbackError([...refused].sort());
  return out;
}

/**
 * The fallback a read of global token `name` must carry (its expanded declared value), for a
 * generator that writes reads itself. Throws `UndeclaredTokenFallbackError` when `name` has no
 * global declared value: no default is invented.
 */
export function globalDeclaredFallback(sources: DeclaredSources, outputCss: string): (name: string) => string {
  const { classify } = fallbackJudge(sources, outputCss);
  return (name) => {
    const { kind, expected } = classify(name);
    if (kind !== "global" || expected === undefined) throw new UndeclaredTokenFallbackError([name]);
    return expected;
  };
}
