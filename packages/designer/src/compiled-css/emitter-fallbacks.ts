/**
 * Fallbacks for the `var(--x)` reads Designer's own CSS emitters write (CONTAM-U9): the blocks
 * (`src/blocks/**`), the specimens (`src/specimen/**`), the token previews
 * (`src/tokens/preview/**`) and the components (`src/components/**`, D5-2C), hand-written and
 * partner sources alike. Each is a TS/TSX source whose strings become CSS: inline style values,
 * `<style>` text and Tailwind class strings. The component preview runtime
 * (`src/components/preview-runtime/**`) is not walked: its generator writes it.
 *
 * No value is typed here. Each comes from the declared-fallback reader the generated stylesheet
 * uses (`declared-fallbacks.ts`), over the same declared sources (`compiledCssDeclaredSources`):
 *
 * - a read of a global token (`:root` or theme level) takes its expanded declared value;
 * - a bare read of a variable declared in the same emitter takes that declaration (U1's output
 *   rule, `addDeclaredFallbacks`);
 * - a bare read of a variable the package sources set inline (`runtimeSetVariables`) takes `unset`;
 * - a scoped or runtime read that already carries a fallback is left as written;
 * - any other bare read is refused with `UndeclaredTokenFallbackError`, naming the variable.
 *
 * A read whose fallback is computed by code (`var(--x, ${TOKENS["--x"]!.value})`, or the same
 * value joined with `+`) is left as written: its value is read at runtime from the token registry,
 * not from the source text. `emitterComputedFallbacks` lists each one with the registry key it
 * reads, so a test can check that the registry value equals the declared value.
 *
 * A `//` line comment is prose, not an emitted string, so its reads are neither judged nor
 * rewritten (the reader already skips block comments).
 *
 * Inside a Tailwind arbitrary value (`min-w-[var(--x)]`) a space would split the class, so the
 * same value is spelled in Tailwind form: `var(--x,V)`, spaces as `_`.
 *
 * The repository's emitter-fallback script (it does not ship) writes these sources through
 * `alignEmitters`, and its `--check` mode fails when one is stale.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { addDeclaredFallbacks, alignDeclaredFallbacks, classifyFallbackReads, type DeclaredSources, type FallbackRead } from "./declared-fallbacks.js";

/** The emitter directories, relative to the package root. */
export const EMITTER_DIRS = ["src/blocks", "src/specimen", "src/tokens/preview", "src/components"] as const;

/** Generated output under `EMITTER_DIRS`, relative to the package root: `scripts/generate-default-component-preview.mjs` writes it. */
export const GENERATED_DIRS = ["src/components/preview-runtime"] as const;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_FILE_RE = /\.(test|spec|check)\.(ts|tsx)$|\.d\.ts$/;

/** Every emitter source under `EMITTER_DIRS` and outside `GENERATED_DIRS`, as a sorted package-relative path with `/` separators. Tests and declaration files are not emitters. */
export function emitterFiles(packageRoot: string): string[] {
  const out: string[] = [];
  const generated = new Set(GENERATED_DIRS.map((dir) => join(packageRoot, dir)));
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (!generated.has(full)) walk(full);
      } else if (stat.isFile() && SOURCE_EXTENSIONS.has(extname(entry)) && !SKIP_FILE_RE.test(entry)) out.push(relative(packageRoot, full).split(sep).join("/"));
    }
  };
  for (const dir of EMITTER_DIRS) walk(join(packageRoot, dir));
  return out.sort();
}

/** A fallback computed by code: a template interpolation, or a string joined with `+`. */
const COMPUTED_FALLBACK_RE = /\$\{|["'`]\s*\+|\+\s*["'`]/;

/** The token registry key a computed fallback reads: `TOKENS["--x"]!.value`. */
const REGISTRY_READ_RE = /^(?:\$\{|["'`]\s*\+\s*)TOKENS\[\s*["'](--[a-zA-Z0-9_-]+)["']\s*\]!?\.value(?:\}|\s*\+\s*["'`])$/;

export interface ComputedFallback {
  read: FallbackRead;
  /** The registry key the fallback reads, or `null` when it reads something else. */
  registryKey: string | null;
  /** The read's text span in the source, `[start, end)`. */
  start: number;
  end: number;
}

/** A `//` comment that starts its line: prose, never an emitted string. */
const LINE_COMMENT_RE = /^[ \t]*\/\/.*$/gm;

/** The `[start, end)` span of every `//` line comment in `text`. */
export function lineCommentSpans(text: string): [number, number][] {
  return [...text.matchAll(LINE_COMMENT_RE)].map((m) => [m.index as number, (m.index as number) + m[0].length]);
}

const inSpan = (offset: number, spans: readonly (readonly [number, number])[]) => spans.some(([start, end]) => offset >= start && offset < end);

/** Every emitted read in `text` (reads in `//` line comments left out), nested reads included, judged by the reader. */
export function emitterReads(text: string, sources: DeclaredSources, outputCss: string): FallbackRead[] {
  const comments = lineCommentSpans(text);
  return classifyFallbackReads(text, sources, outputCss).filter((read) => !inSpan(read.offset, comments));
}

/** Every emitted read in `text` whose fallback is computed by code, with its span (the closing parenthesis included). */
export function emitterComputedFallbacks(text: string, sources: DeclaredSources, outputCss: string): ComputedFallback[] {
  const out: ComputedFallback[] = [];
  for (const read of emitterReads(text, sources, outputCss)) {
    if (read.fallback === null || !COMPUTED_FALLBACK_RE.test(read.fallback)) continue;
    if (out.some((c) => read.offset >= c.start && read.offset < c.end)) continue;
    const fallbackAt = text.indexOf(read.fallback, read.offset);
    const end = text.indexOf(")", fallbackAt + read.fallback.length) + 1;
    out.push({ read, registryKey: REGISTRY_READ_RE.exec(read.fallback)?.[1] ?? null, start: read.offset, end });
  }
  return out;
}

/** A read whose variable name is computed by code, which the reader cannot name or judge. */
export interface InterpolatedRead {
  /** Character offset of `var(` in the source. */
  offset: number;
  /** The read's source text up to its fallback comma or closing parenthesis. */
  text: string;
  /** Whether the read writes a fallback (a `,` follows the name). */
  hasFallback: boolean;
}

/** A name joined with `+`: `"var(" + name + ")"` or `"var(" + name + ", " + value + ")"`. */
const JOINED_NAME_RE = /^["'`]\s*\+\s*[^;\n]*?\+\s*["'`]\s*([,)])/;

/**
 * Every emitted read in `text` (reads in `//` line comments left out) whose name is computed by
 * code: a template interpolation (`var(${name})`) or a string joined with `+`. The reader sees
 * only literal `--x` names, so these are listed here; each must write a fallback, as
 * `var(${name}, ${TOKENS[name]!.value})` does.
 */
export function emitterInterpolatedReads(text: string): InterpolatedRead[] {
  const comments = lineCommentSpans(text);
  const out: InterpolatedRead[] = [];
  for (let i = text.indexOf("var("); i >= 0; i = text.indexOf("var(", i + 4)) {
    if (inSpan(i, comments)) continue;
    let j = i + 4;
    while (j < text.length && /\s/.test(text[j] as string)) j++;
    if (text.startsWith("${", j)) {
      let depth = 0;
      let k = j + 1;
      for (; k < text.length; k++) {
        if (text[k] === "{") depth++;
        else if (text[k] === "}" && --depth === 0) break;
      }
      k++;
      while (k < text.length && /\s/.test(text[k] as string)) k++;
      out.push({ offset: i, text: text.slice(i, k + 1), hasFallback: text[k] === "," });
      continue;
    }
    const joined = JOINED_NAME_RE.exec(text.slice(j));
    if (joined) out.push({ offset: i, text: text.slice(i, j + joined[0].length), hasFallback: joined[1] === "," });
  }
  return out;
}

/** A Tailwind arbitrary value holding a `var(` read: `[...]` with no whitespace or quote inside. */
const ARBITRARY_VAR_RE = /\[([^\]\s"'`]*var\(--[^\]\s"'`]*)\]/g;

/** Joins pieces the reader aligns in one pass; no read crosses it, and no source holds it. */
const PIECE_SEPARATOR = "\u0001";

/** Each piece aligned on its own, in one reader pass (the reader parses its sources once per call). */
function alignPieces(pieces: readonly string[], sources: DeclaredSources, output: string): string[] {
  if (pieces.length === 0) return [];
  if (pieces.some((piece) => piece.includes(PIECE_SEPARATOR))) throw new Error("An emitter source holds the aligner's piece separator (U+0001).");
  const out = alignDeclaredFallbacks(addDeclaredFallbacks(pieces.join(PIECE_SEPARATOR), sources), sources, output).split(PIECE_SEPARATOR);
  if (out.length !== pieces.length) throw new Error("The aligner changed the number of emitter pieces.");
  return out;
}

/** `text` with every emitted read aligned to its declared value; arbitrary values spelled in Tailwind form; computed fallbacks and line comments left as written. */
export function alignEmitterText(text: string, sources: DeclaredSources, outputCss: string): string {
  const own = `${outputCss}\n${text}`;
  const kept: [number, number][] = [...lineCommentSpans(text), ...emitterComputedFallbacks(text, sources, own).map((c): [number, number] => [c.start, c.end])];
  kept.sort((a, b) => a[0] - b[0]);
  // The text split into static pieces (aligned against the emitter's own declarations), Tailwind
  // arbitrary values (aligned against the stylesheet alone) and kept spans (left as written).
  const parts: { kind: "static" | "arbitrary" | "kept"; text: string }[] = [];
  const pushStatic = (chunk: string) => {
    let last = 0;
    for (const m of chunk.matchAll(ARBITRARY_VAR_RE)) {
      parts.push({ kind: "static", text: chunk.slice(last, m.index) });
      parts.push({ kind: "arbitrary", text: (m[1] as string).replace(/_/g, " ") });
      last = (m.index as number) + m[0].length;
    }
    parts.push({ kind: "static", text: chunk.slice(last) });
  };
  let last = 0;
  for (const [start, end] of kept) {
    if (start < last) continue;
    pushStatic(text.slice(last, start));
    parts.push({ kind: "kept", text: text.slice(start, end) });
    last = end;
  }
  pushStatic(text.slice(last));
  const statics = alignPieces(parts.filter((p) => p.kind === "static").map((p) => p.text), sources, own);
  const arbitraries = alignPieces(parts.filter((p) => p.kind === "arbitrary").map((p) => p.text), sources, outputCss);
  let s = 0;
  let a = 0;
  return parts.map((p) => {
    if (p.kind === "kept") return p.text;
    if (p.kind === "static") return statics[s++] as string;
    return `[${(arbitraries[a++] as string).replace(/,\s+/g, ",").replace(/\s+/g, "_")}]`;
  }).join("");
}

export interface EmitterAlignment {
  file: string;
  current: string;
  expected: string;
}

/** Each emitter's current text and its aligned text. */
export function alignEmitters(packageRoot: string, sources: DeclaredSources, outputCss: string): EmitterAlignment[] {
  return emitterFiles(packageRoot).map((file) => {
    const current = readFileSync(join(packageRoot, file), "utf8");
    return { file, current, expected: alignEmitterText(current, sources, outputCss) };
  });
}
