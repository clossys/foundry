/**
 * `scanClassCandidates` — the source of truth for what goes INTO
 * `generate.ts`'s real Tailwind compile. Walks a directory (this package's
 * own `src/atoms/` in real use — see `cli.ts`) and extracts every string
 * literal that is SHAPED like a Tailwind class name, from the same files
 * `VARIANT_CLASSES`/`SIZE_CLASSES`/`BASE`-style class tables live in
 * (`Button.tsx`, `Badge.tsx`, `Card.tsx`, and every other atom — see the
 * README's "No `class-variance-authority`" note: every atom's classes are a
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
 * shape than a plain Tailwind class token (`bg-accent`, `hover:bg-accent-
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
 * `internal/` is skipped by default: this package's own `atoms/internal/`
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
 * would never legitimately be a class).
 */
const CANDIDATE_SHAPE_RE = /^[a-zA-Z][a-zA-Z0-9_:/.-]*(\[[^\]\s()]*\])?$/;
const MAX_CANDIDATE_LENGTH = 60;

/**
 * Extracts every DOUBLE-quoted string literal, and every template literal
 * with no `${...}` interpolation, from `content`. Deliberately NOT
 * comment-aware, unlike `style-scan.ts`'s `computeSkipRegions` — a class
 * token that happens to appear only inside a comment is harmless to include
 * (see this file's header — Tailwind ignores anything it doesn't
 * recognize). Skipping comment-awareness is what keeps this scanner small;
 * that cost is bounded and accepted, not silent.
 *
 * DELIBERATELY EXCLUDES single-quoted strings — not an oversight, a fix for
 * a real bug found while building this: this package's own doc comments
 * are full of English contractions and possessives (`components' own`,
 * `isn't`, `element's`), each a single unmatched apostrophe. A naive
 * single-quote-paired regex treats the FIRST apostrophe in one comment and
 * the NEXT apostrophe in a LATER, unrelated comment as one giant
 * "single-quoted string" spanning everything between them — silently
 * SWALLOWING any real double-quoted class literal that happens to fall in
 * that span (verified against `Separator.tsx`'s own `ORIENTATION_CLASSES`
 * table, which was dropped entirely this way before this fix) while also
 * emitting a pile of garbage prose-fragment candidates. That is exactly the
 * UNDER-inclusion failure this file's header says is the only one that
 * matters — so rather than add real comment-awareness (`style-scan.ts`'s
 * heavier `computeSkipRegions` machinery) for a case this codebase never
 * actually needs, this scanner drops single-quote matching entirely:
 * confirmed by inspection that no atom anywhere in this package writes a
 * class-bearing string literal in single quotes — every real example
 * (`Button.tsx`, `Badge.tsx`, `Card.tsx`, every other atom) uses double
 * quotes exclusively, including for `cx(...)` calls and object-literal
 * class tables. A single-quoted arbitrary-value bracket segment like
 * Tailwind's own `content-['/']` still gets through fine: it lives INSIDE a
 * double-quoted string (`className="...content-['/']..."`), not as its own
 * JS string literal, so the double-quote branch already captures it whole,
 * and `CANDIDATE_SHAPE_RE`'s own bracket-content group is written to accept
 * the quote character *inside* a bracket.
 */
function extractStringLiterals(content: string): string[] {
  const literals: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.|\$(?!\{))*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const value = m[1] ?? m[2] ?? "";
    literals.push(value);
  }
  return literals;
}

function candidatesFromLiteral(literal: string, out: Set<string>): void {
  for (const token of literal.split(/\s+/)) {
    if (token.length === 0 || token.length > MAX_CANDIDATE_LENGTH) continue;
    if (CANDIDATE_SHAPE_RE.test(token)) out.add(token);
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
