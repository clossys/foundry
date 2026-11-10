/**
 * `scanClassCandidates` — the source of truth for what goes INTO
 * `generate.ts`'s real Tailwind compile. Walks a directory (this package's
 * own `src/components/` in real use — see `cli.ts`) and extracts every string
 * literal that is SHAPED like a Tailwind class name, from the same files
 * `VARIANT_CLASSES`/`SIZE_CLASSES`/`BASE`-style class tables live in
 * (`Button.tsx`, `Badge.tsx`, `Card.tsx`, and every other component — see the
 * README's "No `class-variance-authority`" note: every component's classes are a
 * plain string literal, never built up with a template expression or a
 * runtime concatenation helper, so a static text scan is a complete,
 * non-approximate source of truth here — unlike `style-scan.ts`, which
 * exists specifically because a hardcoded VALUE can appear anywhere).
 *
 * WHY THIS IS DELIBERATELY OVER-INCLUSIVE, NOT PRECISE
 *
 * This scanner does not try to distinguish a real Tailwind class token from
 * an unrelated word that happens to share its shape (a prop name, a stray
 * doc-comment example, an aria value). It doesn't need to: an over-included
 * candidate that isn't a real Tailwind utility is silently ignored by
 * `tailwindcss`'s own `build()` (see `generate.ts`) — Tailwind's compiler
 * simply produces no CSS for a candidate it doesn't recognize, the same way
 * a typo'd class name in ordinary JSX produces no styled output rather than
 * an error. The only failure mode that matters is UNDER-inclusion — a real
 * class silently missing from the candidate set, which would make
 * `compiled.css` incomplete — so this scanner is written to be permissive
 * rather than clever. `coverage.test.ts` is the independent check that
 * nothing real got missed: it renders real components and asserts every
 * class actually in the DOM has a matching rule in the generated CSS.
 *
 * WHY THIS DOES NOT REUSE `style-scan.ts`
 *
 * `style-scan.ts` extracts VALUE literals (`#3b82f6`, `13px`, an
 * `ident-[...]` arbitrary-value class) — a completely different value
 * shape than a plain Tailwind class token (`bg-primary`, `hover:bg-accent-
 * hover`). Bolting class-name extraction onto that file would mean a second,
 * unrelated regex family and a second meaning for its exported types. This
 * file is intentionally small and single-purpose instead — it shares only
 * the walking/skip-file conventions (`SKIP_FILE_RE`, fail-closed on an
 * unreadable directory) rather than the extraction logic itself, mirroring
 * the exact conventions `style-scan.ts` and `@example/copy`'s
 * `scan.ts` already establish for this repository's scanners.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

export interface ClassScanOptions {
  /** File extensions to read, each including the leading dot. Default: `.ts`, `.tsx`. */
  extensions?: string[];
  /** Directory names never descended into. Default: node_modules, .git, dist, build, coverage, internal. */
  skipDirs?: string[];
}

const DEFAULT_EXTENSIONS = [".ts", ".tsx"];
/**
 * `internal/` is skipped by default: this package's own `components/internal/`
 * carries `cx.ts` (a merge helper, no class literals of its own beyond
 * doc-comment examples) and `ui-vars.ts` (raw `var(...)` reads used via the
 * `style` prop, never `className` — see that file's own header). Neither
 * contributes a real rendered class, and `ui-vars.ts`'s `var(--token,
 * <fallback>)` strings are exactly the shape `resolveFallbackChain` in
 * `style-scan.ts` exists to handle for VALUES — irrelevant here, but
 * skipping the directory keeps this scanner from ever needing to reason
 * about it. A caller that adds a real class-bearing file under `internal/`
 * in the future can override `skipDirs` to include it.
 */
const DEFAULT_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", "internal"]);

/** Same convention `style-scan.ts` and `@example/copy`'s `scan.ts` use: test/spec/check files and declaration files never ship, so a class literal living only in one is never a real rendered class. */
const SKIP_FILE_RE = /\.(test|spec|check)\.(ts|tsx)$|\.d\.ts$/;

export interface SkippedFile {
  file: string;
  reason: "test-or-check-file";
}

export interface ClassScanResult {
  /** Sorted, deduplicated candidate tokens — fed directly to `generate.ts`'s `compile().build(...)`. */
  candidates: string[];
  /** Files whose content was successfully read and scanned. */
  filesScanned: number;
  skippedByDesign: SkippedFile[];
}

/**
 * A conservative, permissive shape test for "looks like a Tailwind class
 * token, or at least is harmless to hand to Tailwind's own compiler and let
 * it decide" — see this file's header for why over-inclusion is fine and
 * under-inclusion is the only real risk. Rejects tokens that start with a
 * digit or punctuation (never a valid utility name), tokens containing
 * characters no real Tailwind candidate uses (spaces are already split out
 * by the caller; this additionally rejects quotes, parens, commas — the
 * shape of a `var(...)` read or a sentence fragment, not a class), and
 * anything absurdly long (a prose sentence with no spaces, e.g. a URL,
 * would never legitimately be a class). One leading `@` is allowed, and `@`
 * inside a variant, for Tailwind's container-query utilities: the
 * `@container` marker and variants such as `@md:flex-row` that size a block by its
 * own container rather than the viewport (Specimen panels use them).
 */
const CANDIDATE_SHAPE_RE = /^@?[a-zA-Z][a-zA-Z0-9_:/.@-]*(\[[^\]\s()]*\])?$/;
const MAX_CANDIDATE_LENGTH = 60;
/**
 * The stock shadcn@aria button and breadcrumb write Tailwind v4 values the
 * plain shape above cannot express: a `(--var,fallback)` shorthand with a
 * fallback (`border-(length:--ui-border-hairline,1px)`), a nested
 * `calc(var(...))` fallback, and a variant holding a nested selector
 * (`[&_svg:not([class*='size-'])]:`). This shape walks the token with a
 * delimiter stack instead: every `[`/`(` closes in order, quotes stay inside a
 * bracket, a `(...)` value must start with a custom property (optionally
 * typed), and only whitespace-free tokens reach it. A prose read such as
 * `var(--x, fallback)` is split at its space, so neither half balances and it
 * is still never emitted. A plain arbitrary property (`[display:inherit]`,
 * the stock dialog and sheet content) balances the same way. These grammar
 * tokens may be longer.
 */
const BALANCED_MAX_LENGTH = 120;
const BALANCED_HEAD_RE = /^!?-?@?[a-zA-Z*][a-zA-Z0-9_.@*-]*$/;
function balancedCandidate(token: string): boolean {
  if (token.length > BALANCED_MAX_LENGTH || !/[[(]/.test(token)) return false;
  const parts: string[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let index = 0; index < token.length; index++) {
    const ch = token[index]!;
    if (ch === "[" || ch === "(") stack.push(ch === "[" ? "]" : ")");
    else if (ch === "]" || ch === ")") { if (stack.pop() !== ch) return false; }
    else if ((ch === "'" || ch === "\"") && !stack.includes("]")) return false;
    else if (ch === ":" && stack.length === 0) { parts.push(token.slice(start, index)); start = index + 1; }
  }
  if (stack.length) return false;
  parts.push(token.slice(start));
  return parts.every((part, index) => {
    const utility = index === parts.length - 1;
    if (part.startsWith("[")) return part.endsWith("]") && (!utility || /^\[(?:--?[a-zA-Z][a-zA-Z0-9_-]*|[a-z][a-z-]*):[^\s]+\]$/.test(part));
    const open = part.search(/[[(]/);
    const head = open < 0 ? part : part.slice(0, open);
    if (!BALANCED_HEAD_RE.test(head.replace(/\/[a-zA-Z0-9._-]+!?$/, ""))) return false;
    if (open < 0) return true;
    const close = part[open] === "[" ? part.lastIndexOf("]") : part.lastIndexOf(")");
    const value = part.slice(open + 1, close);
    if (part[open] === "(" && !/^(?:[a-z-]+:)?--[a-zA-Z0-9_-]+(?:,|$)/.test(value)) return false;
    return /^(?:\/[a-zA-Z0-9._%-]+)?!?$/.test(part.slice(close + 1));
  });
}

/**
 * Tailwind v4 candidate shapes the plain test above rejects, which the
 * shadcn-derived components use throughout: a negative utility (`-mx-lg`,
 * `-translate-x-1/2`), a CSS-variable shorthand value (`h-(--ui-control-h-md)`,
 * `border-(length:--ui-border-hairline,1px)`), an arbitrary property
 * (`[--cell-size:var(--ui-control-h-sm)]`), an arbitrary or universal variant
 * (`[&>svg]:size-(--spacing-lg)`, `*:data-[slot=kbd]:z-10`) and an important
 * marker (`!p-0`). Before this, every such class shipped no rule at all.
 *
 * It stays bounded the same way: one start character a candidate can begin
 * with, no quote, backtick, backslash, brace or semicolon at the top level,
 * every bracket and parenthesis balanced and properly nested, and a comma or
 * apostrophe only inside a bracket or parenthesis. That keeps the prose cases
 * this file guards against out: `var(--ui-ring-focus,` and `2px)` are
 * unbalanced, `isn't` has a top-level apostrophe. Over-inclusion stays
 * harmless for the reason the header gives.
 */
const V4_CANDIDATE_START_RE = /^[@a-zA-Z[*!-]/;
const V4_TOP_LEVEL_FORBIDDEN = new Set(['"', "`", "\\", "{", "}", ";", ",", "'"]);
const MAX_V4_CANDIDATE_LENGTH = 200;

function isV4CandidateShape(token: string): boolean {
  if (token.length > MAX_V4_CANDIDATE_LENGTH || !V4_CANDIDATE_START_RE.test(token)) return false;
  if (!/[a-zA-Z]/.test(token)) return false;
  const open: string[] = [];
  for (const ch of token) {
    if (ch === "[" || ch === "(") {
      open.push(ch === "[" ? "]" : ")");
    } else if (ch === "]" || ch === ")") {
      if (open.pop() !== ch) return false;
    } else if (ch === "\\" || ch === "`" || ch === '"') {
      return false;
    } else if (open.length === 0 && V4_TOP_LEVEL_FORBIDDEN.has(ch)) {
      return false;
    }
  }
  return open.length === 0;
}

/**
 * Extracts every double-quoted string literal, every single-line
 * single-quoted string literal, and the static text of every template literal
 * from `content`. Deliberately NOT comment-aware, unlike `style-scan.ts`'s
 * `computeSkipRegions` — a class token that happens to appear only inside a
 * comment is harmless to include (see this file's header — Tailwind ignores
 * anything it doesn't recognize). Skipping comment-awareness is what keeps
 * this scanner small; that cost is bounded and accepted, not silent.
 *
 * TEMPLATE LITERALS. The static chunks of a template literal are class text
 * like any other (`\`flex ${gap}\`` ships `flex`), and the code inside each
 * `${...}` is scanned for its own literals (`${open ? "w-40" : "w-0"}`). An
 * earlier regex skipped any template that held an interpolation, and its
 * closing backtick then opened a phantom template that ran to the next
 * backtick in the file, swallowing every double-quoted class literal in
 * between (`CanvasSurface.tsx`'s `bottom-sm`, `PageBar.tsx`'s
 * `justify-self-start`, `ViewOptions.tsx`'s `max-h-full` all shipped no rule
 * that way).
 *
 * SINGLE QUOTES. A naive single-quote pairing is wrong here: doc comments are
 * full of English contractions and possessives (`components' own`, `isn't`),
 * and pairing the apostrophe in one comment with the next one in a LATER
 * comment swallows every real double-quoted class literal between them
 * (`Separator.tsx`'s `ORIENTATION_CLASSES` table was once dropped entirely
 * that way). JavaScript strings cannot span a line, so a single-quoted
 * literal is accepted only when it closes on the same line and holds no
 * double quote or backtick; otherwise the apostrophe is ordinary text and
 * scanning resumes on the next character. Two apostrophes on one comment line
 * yield a harmless prose fragment, never a swallowed class literal.
 */
function extractStringLiterals(content: string): string[] {
  const literals: string[] = [];
  let i = 0;

  function readQuoted(quote: string): string | undefined {
    // `content[i]` is the opening quote. Returns the raw body and advances past
    // the closing quote, or returns undefined without advancing.
    let j = i + 1;
    while (j < content.length) {
      const ch = content[j];
      if (ch === "\\") { j += 2; continue; }
      if (ch === quote) {
        const body = content.slice(i + 1, j);
        i = j + 1;
        return body;
      }
      if (quote === "'" && (ch === "\n" || ch === '"' || ch === "`")) return undefined;
      j++;
    }
    return undefined;
  }

  function readTemplate(): void {
    // `content[i]` is the opening backtick.
    i++;
    let chunk = "";
    while (i < content.length) {
      const ch = content[i];
      if (ch === "\\") { chunk += content.slice(i, i + 2); i += 2; continue; }
      if (ch === "`") { i++; break; }
      if (ch === "$" && content[i + 1] === "{") {
        literals.push(chunk);
        chunk = "";
        i += 2;
        scan("}");
        continue;
      }
      chunk += ch;
      i++;
    }
    literals.push(chunk);
  }

  function scan(until?: string): void {
    // Scans code, collecting literals, until the `}` that closes the current
    // interpolation (when `until` is set) or the end of the file.
    let depth = 0;
    while (i < content.length) {
      const ch = content[i];
      if (until !== undefined) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          if (depth === 0) { i++; return; }
          depth--;
        }
      }
      if (ch === '"') {
        const body = readQuoted('"');
        if (body !== undefined) { literals.push(body); continue; }
      } else if (ch === "'") {
        const body = readQuoted("'");
        if (body !== undefined) { literals.push(body); continue; }
      } else if (ch === "`") {
        readTemplate();
        continue;
      }
      i++;
    }
  }

  scan();
  return literals;
}

function candidatesFromLiteral(literal: string, out: Set<string>): void {
  for (const token of literal.split(/\s+/)) {
    if (token.length === 0) continue;
    if ((token.length <= MAX_CANDIDATE_LENGTH && CANDIDATE_SHAPE_RE.test(token)) || isV4CandidateShape(token) || balancedCandidate(token)) out.add(token);
  }
}

/**
 * Walks `root` recursively and extracts class candidates from every
 * matching file. FAILS CLOSED on an unreadable directory or file — throws a
 * plain `Error`, matching `scanStyleSources`'s own contract (see that
 * file's comment for why "0 files scanned" must never read as a clean pass
 * for a directory this function could not actually read). `cli.ts` turns a
 * thrown error into exit code 2.
 */
export function scanClassCandidates(root: string, options: ClassScanOptions = {}): ClassScanResult {
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
  const skipDirs = new Set(options.skipDirs ?? DEFAULT_SKIP_DIRS);

  const candidates = new Set<string>();
  let filesScanned = 0;
  const skippedByDesign: SkippedFile[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      throw new Error(`scanClassCandidates: cannot read directory "${dir}": ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue; // broken symlink — nothing to read, not a directory-listing failure
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!stat.isFile()) continue;
      if (!extensions.has(extname(entry).toLowerCase())) continue;

      const relPath = relative(root, full).split(sep).join("/");

      if (SKIP_FILE_RE.test(entry)) {
        skippedByDesign.push({ file: relPath, reason: "test-or-check-file" });
        continue;
      }

      let content: string;
      try {
        content = readFileSync(full, "utf8");
      } catch (error) {
        throw new Error(`scanClassCandidates: cannot read file "${full}": ${error instanceof Error ? error.message : String(error)}`);
      }

      filesScanned++;
      for (const literal of extractStringLiterals(content)) {
        candidatesFromLiteral(literal, candidates);
      }
    }
  }

  walk(root);
  return { candidates: [...candidates].sort(), filesScanned, skippedByDesign };
}
