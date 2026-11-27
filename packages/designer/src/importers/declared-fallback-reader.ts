/**
 * The one declared-source fallback reader every importer takes its token fallbacks from (D5-2b).
 *
 * An importer never types a fallback. Each `var(--x)` it writes carries the value the reader
 * returns for `--x`, and a name with no declared value is refused (`UndeclaredTokenFallbackError`),
 * never given an invented default or a fallback chain.
 *
 * Two readers share the interface:
 *
 * - `packageDeclaredFallbackReader()`: the preview graph and package-shipped output. It is the
 *   generated stylesheet's own reader, `globalDeclaredFallback` (`compiled-css/declared-fallbacks.ts`),
 *   over the package's declared sources (`compiledCssDeclaredSources`): tokens.css, theme.css and the
 *   package default theme.
 * - `pinnedThemeFallbackReader(values)`: a consumer's adoption, over the values its pinned `themes.*`
 *   slots declare. A name the pins do not declare is refused the same way. With `foundryBrandOptional`
 *   (CP1-TOKENFALL, the consumer adopt reader), a name no pin declares that the token catalog marks
 *   `brand-optional` takes Foundry's declared value from `styles/tokens.css` and `styles/theme-keys.css`
 *   instead; a `brand-required` name is still refused, and says so.
 *
 * Wherever the theme is loaded every read is in scope and its fallback is never used, so the
 * fallbacks change no computed style.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compiledCssDeclaredSources } from "../compiled-css/generate.js";
import { globalDeclaredFallback, RUNTIME_ONLY_FALLBACK, UndeclaredTokenFallbackError } from "../compiled-css/declared-fallbacks.js";
import { runtimeSetNames, scanRuntimeSetters } from "../compiled-css/runtime-setters.js";
import { TOKEN_ENTRIES } from "../catalog/tokens.js";

export { UndeclaredTokenFallbackError };

export interface DeclaredFallbackReader {
  /** Where the values come from, for receipts and refusal messages. */
  readonly source: string;
  /** The declared value a read of `name` carries as its fallback. Throws `UndeclaredTokenFallbackError` when none is declared. */
  fallback(name: string): string;
  /** Whether `name`'s fallback is Foundry's declared value rather than the reader's own (a brand-optional id no pin declares). */
  fromFoundry?(name: string): boolean;
}

let packageReader: DeclaredFallbackReader | undefined;

/** The declared values of the package whose `styles/` directory is `stylesDir`: `globalDeclaredFallback` over its declared sources. */
export function declaredFallbackReaderAt(stylesDir: string): DeclaredFallbackReader {
  const read = globalDeclaredFallback(compiledCssDeclaredSources(stylesDir), "");
  const values = new Map<string, string>();
  return Object.freeze({
    source: "package declared sources (globalDeclaredFallback)",
    fallback(name: string): string {
      let value = values.get(name);
      if (value === undefined) { value = read(name); values.set(name, value); }
      return value;
    },
  });
}

/** The package's own declared values, read once per process from the shipped `styles/` directory. */
export function packageDeclaredFallbackReader(): DeclaredFallbackReader {
  packageReader ??= declaredFallbackReaderAt(resolve(dirname(fileURLToPath(import.meta.url)), "../../styles"));
  return packageReader;
}

/** The token catalog's tier of each id (`designer/src/catalog/tokens.ts`). */
const TOKEN_TIER = new Map<string, string>(TOKEN_ENTRIES.map(entry => [entry.id, entry.tier]));

let foundryDeclared: ((name: string) => string) | undefined;

/**
 * Foundry's declared value of `name`: `globalDeclaredFallback` over the package's `styles/tokens.css` and
 * `styles/theme-keys.css` (inlined by theme.css) alone; no package default theme, no Tailwind default theme, no
 * inline setter. Read once per process. Throws `UndeclaredTokenFallbackError` when they declare none.
 */
function foundryDeclaredValue(name: string): string {
  foundryDeclared ??= globalDeclaredFallback({
    ...compiledCssDeclaredSources(resolve(dirname(fileURLToPath(import.meta.url)), "../../styles")),
    defaultThemeCss: "", tailwindThemeCss: "", runtimeSetVariables: new Set(),
  }, "");
  return foundryDeclared(name);
}

/** The refusal of a brand-required id no pin declares: the base refusal, plus why Foundry's declared value was not taken. */
export class BrandRequiredTokenFallbackError extends UndeclaredTokenFallbackError {
  constructor(name: string) {
    super([name]);
    this.message += ` Foundry's declared fallback was not taken for ${name} because the token catalog marks it brand-required: pin a themes.* slot that emits ${name}.`;
  }
}

export interface PinnedThemeFallbackOptions {
  /** A name no pin declares that the token catalog marks brand-optional takes Foundry's declared value (CP1-TOKENFALL). */
  readonly foundryBrandOptional?: boolean;
}

/**
 * A consumer's pinned `themes.*` values, by custom-property name. A pinned value always wins. With
 * `foundryBrandOptional`, a name no pin declares falls back to Foundry's declared value only when the token catalog
 * marks it brand-optional; a brand-required name is refused (`BrandRequiredTokenFallbackError`), and any other name
 * is refused exactly as without the option.
 */
export function pinnedThemeFallbackReader(values: Readonly<Record<string, string>>, source = "consumer pinned themes", options: PinnedThemeFallbackOptions = {}): DeclaredFallbackReader {
  const own = new Map(Object.entries(values));
  const pinned = (name: string): string | undefined => {
    const value = own.get(name);
    return value === undefined || !value.trim() ? undefined : value;
  };
  const fromFoundry = (name: string): boolean => options.foundryBrandOptional === true && pinned(name) === undefined && TOKEN_TIER.get(name) === "brand-optional";
  return Object.freeze({
    source,
    fallback(name: string): string {
      const value = pinned(name);
      if (value !== undefined) return value;
      if (fromFoundry(name)) return foundryDeclaredValue(name);
      if (options.foundryBrandOptional === true && TOKEN_TIER.get(name) === "brand-required") throw new BrandRequiredTokenFallbackError(name);
      throw new UndeclaredTokenFallbackError([name]);
    },
    fromFoundry,
  });
}

/** Refused inside a Tailwind class: it would split the class, or would not survive Tailwind's `_` decoding. */
const CLASS_UNSAFE = /[_"'`\\\t\n\r]/;

/** The value spelled for a Tailwind arbitrary value or shorthand: spaces as `_`. */
export function classFallback(reader: DeclaredFallbackReader, name: string): string {
  const value = reader.fallback(name);
  if (CLASS_UNSAFE.test(value)) throw new Error(`declared-fallback-reader: the declared value of ${name} cannot be spelled inside a class: ${JSON.stringify(value)}`);
  return value.replace(/ /g, "_");
}

/** A read inside a class string: `var(--x,<value>)`. */
export function classRead(reader: DeclaredFallbackReader, name: string): string {
  return `var(${name},${classFallback(reader, name)})`;
}

/** A read in CSS text or an inline style value: `var(--x, <value>)`. */
export function cssRead(reader: DeclaredFallbackReader, name: string): string {
  return `var(${name}, ${reader.fallback(name)})`;
}

/** A bare read: `var(--x)` with no fallback argument. */
const BARE_READ = /var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g;

/**
 * The `[start, end)` spans of comments a `.ts`/`.tsx` source carries: `//` comments that start a line, and block
 * comments. A comment opener inside a string or template literal is text, not a comment: quoted strings end at
 * their closing quote (or the line end), and a template's `${…}` expressions are scanned as code.
 */
function commentSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  // "`" marks an open template literal, "${" a template expression, "{" a brace nested inside one.
  const stack: string[] = [];
  let lineStart = true;
  for (let i = 0; i < text.length;) {
    const char = text[i]!;
    if (stack.at(-1) === "`") {
      if (char === "\\") i += 2;
      else if (char === "`") { stack.pop(); i++; }
      else if (char === "$" && text[i + 1] === "{") { stack.push("${"); i += 2; }
      else i++;
      continue;
    }
    if (char === "/" && text[i + 1] === "/" && lineStart) {
      const end = text.indexOf("\n", i);
      spans.push([i, end < 0 ? text.length : end]);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const close = end < 0 ? text.length : end + 2;
      spans.push([i, close]);
      i = close;
      lineStart = false;
      continue;
    }
    if (char === "\n") { lineStart = true; i++; continue; }
    if (char !== " " && char !== "\t") lineStart = false;
    if (char === "\"" || char === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== char && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      i = text[j] === char ? j + 1 : j;
      continue;
    }
    if (char === "`") stack.push("`");
    else if (char === "{" && stack.length) stack.push("{");
    else if (char === "}" && stack.length) stack.pop();
    i++;
  }
  return spans;
}

/** Whether the read at `at` sits inside a Tailwind class: its whitespace-free token opens `[` or a `-(`/`:(` shorthand before it. */
function inClass(text: string, at: number): boolean {
  let start = at;
  while (start > 0 && !/[\s"'`{}]/.test(text[start - 1]!)) start--;
  let square = 0, shorthand = 0;
  const round: boolean[] = [];
  for (let i = start; i < at; i++) {
    const char = text[i]!;
    if (char === "[") square++;
    else if (char === "]") square--;
    else if (char === "(") { const opener = /[-:]/.test(text[i - 1] ?? ""); round.push(opener); if (opener) shorthand++; }
    else if (char === ")" && round.pop()) shorthand--;
  }
  return square > 0 || shorthand > 0;
}

/**
 * `reader`, plus the runtime-only rule (`runtime-setters.ts`) for one source `text`: a name the reader does not
 * declare but `text` itself sets inline (stock shadcn's `"--sidebar-width-icon": SIDEBAR_WIDTH_ICON`) reads
 * `unset`, as the package's generated stylesheet does. A declared value always wins; any other undeclared name is
 * still refused.
 */
function withInlineSetters(reader: DeclaredFallbackReader, text: string): DeclaredFallbackReader {
  let inline: ReadonlySet<string> | undefined;
  return {
    source: reader.source,
    fromFoundry: reader.fromFoundry,
    fallback(name: string): string {
      try { return reader.fallback(name); }
      catch (error) {
        if (!(error instanceof UndeclaredTokenFallbackError)) throw error;
        inline ??= runtimeSetNames(scanRuntimeSetters(text));
        if (inline.has(name)) return RUNTIME_ONLY_FALLBACK;
        throw error;
      }
    },
  };
}

/**
 * `text` (an emitted `.ts`/`.tsx` source) with every bare `var(--x)` outside comments given the
 * reader's value: Tailwind form inside a class, CSS form elsewhere. Reads that already carry a
 * fallback are left as written. A name the reader does not declare is refused, unless `text` sets
 * it inline at run time (then `unset`). When any read took Foundry's declared value (`reader.fromFoundry`), one
 * comment line at the end names each such token and its value, so the consumer can see which values are Foundry's.
 */
export function alignImportedReads(text: string, reader: DeclaredFallbackReader): string {
  const comments = commentSpans(text);
  const own = withInlineSetters(reader, text);
  const foundry = new Map<string, string>();
  const aligned = text.replace(BARE_READ, (whole, name: string, offset: number) => {
    if (comments.some(([start, end]) => offset >= start && offset < end)) return whole;
    const read = inClass(text, offset) ? classRead(own, name) : cssRead(own, name);
    if (own.fromFoundry?.(name)) foundry.set(name, own.fallback(name));
    return read;
  });
  if (!foundry.size) return aligned;
  const listed = [...foundry].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${name}: ${value}`).join("; ");
  return `${aligned}${aligned.endsWith("\n") ? "" : "\n"}// Foundry declared fallbacks (brand-optional, no pinned theme emits them): ${listed}\n`;
}

/** Every bare `var(--x)` left outside comments in `text`. */
export function bareReads(text: string): string[] {
  const comments = commentSpans(text);
  return [...text.matchAll(BARE_READ)].filter(match => !comments.some(([start, end]) => match.index >= start && match.index < end)).map(match => match[1]!);
}

/** Refuses a source file that still holds a bare read (D3: no read without its declared value). */
export function assertNoBareReads(file: { path: string; content: string }): void {
  if (!/\.(?:ts|tsx)$/.test(file.path)) return;
  const left = bareReads(file.content);
  if (left.length) throw new Error(`declared-fallback-reader: ${file.path} still reads ${[...new Set(left)].sort().join(", ")} with no declared fallback`);
}
