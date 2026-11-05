/**
 * `scanStyleSources` and `extractStyleCandidates` — the visual mirror of
 * `@example/copy`'s `scan.ts`. That file walks a source tree and
 * extracts every user-facing STRING; this file walks the same shape of
 * tree and extracts every hardcoded STYLING LITERAL — a hex color, a
 * `rgb()`/`rgba()`/`hsl()`/`hsla()`/`oklch()`/`oklab()`/`lab()`/`lch()`
 * color function, a raw CSS length (`13px`, `1.5rem`, `2em`, ...), or a
 * Tailwind arbitrary-value utility class (`bg-[#3b82f6]`, `p-[13px]`,
 * `w-[var(--x,64px)]`). This package's token layer owns the CONTRACT (the
 * 154-entry `TOKENS` registry); this file, `token-gate.ts`, and `cli.ts`
 * are `@clossys/designer`'s copy of `copy`/`copy-gate.ts`/`cli.ts` —
 * before this package existed, `ui` shipped no gate at all: a hardcoded
 * `#3b82f6` or `padding: 13px` anywhere in this package was as invisible
 * as an unregistered string used to be before `copy` shipped its scanner.
 *
 * NO PARSER LIBRARY, same zero-runtime-dependency rule `copy/src/scan.ts`
 * states for itself — this repository's CI `safety` job runs gate scripts
 * with no `npm ci` at all, and `@clossys/designer` itself is the one
 * package in this repo already exempted from "zero dependencies" for its
 * OWN runtime (it wraps React) — but that exemption does not extend to
 * THIS file: a scanner that a consumer might invoke standalone (via the
 * installed `designer-token-check` CLI) must not drag in a CSS parser, a
 * Tailwind dependency, or a TS/JSX parser just to find a hex code.
 *
 * ============================================================================
 * WHY THIS SCANNER IS SIMPLER THAN `copy`'s, AND WHERE THAT SIMPLICITY ENDS
 * ============================================================================
 *
 * `copy/src/scan.ts` is ~1800 lines because its hard problem is finding
 * STRING/JSX-TEXT-NODE BOUNDARIES correctly (escaped quotes, nested
 * template interpolation, comments, regex literals, and now JSX itself all
 * look enough like a string to confuse a naive scanner) and THEN deciding
 * whether the string found inside those boundaries is user-facing at all
 * (an object key vs. a value, an aria-label vs. visible copy, a variant
 * token vs. a sentence, ...).
 *
 * This file's job is different in kind: a styling literal is not a
 * syntactic position, it is a VALUE SHAPE — `#3b82f6` looks the same
 * whether it sits in a plain string, a template literal, a `style={{}}`
 * object, or a `className` string. So this scanner does not tokenize
 * string/template boundaries at all. It runs a small set of value-shape
 * regexes directly over each file's raw text (`content.matchAll(...)`),
 * and treats classification as almost entirely LOCAL and CONTEXT-FREE:
 * "does this text look like a hex color / color function / CSS length /
 * Tailwind arbitrary-value class", not "is this string in a position a
 * user would see". That is what keeps this file two orders of magnitude
 * smaller than `copy/src/scan.ts` while still being honest about coverage.
 *
 * The one place this scanner DOES need positional awareness, mirroring
 * `copy`'s own local-context heuristics, is telling real code apart from:
 *
 *   1. COMMENTS (`// ...` and `/* ... *\/`, including JSDoc) AND REGEX
 *      LITERALS. A single `computeSkipRegions` pass (below) finds every
 *      comment AND regex-literal span with one left-to-right walk that
 *      tracks "inside a quoted string" vs. "not" — just enough to know
 *      that `//` or `/*` appearing INSIDE a `"..."`/`'...'`/`` `...` ``
 *      literal (a URL like `"https://..."`, for instance) never opens a
 *      real comment — PLUS enough expression-position tracking (the exact
 *      "value vs. other" heuristic `copy/src/scan.ts` uses for the same
 *      disambiguation) to recognize a `/pattern/flags` regex literal and
 *      skip its own delimiters and character-class contents, which would
 *      otherwise be misread as quote/comment syntax (a regex character
 *      class containing a quote, like this very file's own
 *      `ATTR_CONTEXT_RE`, or a Tailwind-arbitrary-shaped substring inside
 *      a pattern like `TW_ARBITRARY_OPENER_RE`'s own source). A
 *      styling-shaped literal whose match position falls inside a comment
 *      OR regex-literal region is reported via `excluded` (reason
 *      `"comment"` or `"regex-literal"`), never silently dropped and never
 *      treated as a real candidate — `DataTable.tsx`'s own JSDoc
 *      (`` * Fixed column width (`"120px"`, `"10rem"`, ...) ``) and
 *      `Sparkline.tsx`'s inline `// keeps the 2px stroke ...` are the real
 *      COMMENT examples in this codebase this exclusion exists for; this
 *      file's own `ATTR_CONTEXT_RE`/`TW_ARBITRARY_OPENER_RE` are the real
 *      REGEX-LITERAL examples (found scanning this package's own source —
 *      see `computeSkipRegions`'s own header for the full story).
 *   2. STRUCTURAL / ACCESSIBILITY ATTRIBUTE VALUES — `href`, `src`, `id`,
 *      `key`, `xmlns`, `viewBox`, `d`, `points`, `testId`, `htmlFor`,
 *      `rel`, `target`, `role`, `name`, `slot`, `autoComplete`,
 *      `inputMode`, `pattern`, `method`, `encType`, and any `aria-*`/
 *      `data-*` name — mirrors `copy/src/scan.ts`'s own denylist
 *      (exclusions #4/#5 in that file's header). Detected the same
 *      LOCAL, textual way: the text immediately before a match, on the
 *      same line, is tested against `ATTR_CONTEXT_RE`. This is what keeps
 *      an SVG icon's `viewBox="0 0 24 24"` (no unit suffix, so it was
 *      never going to match anyway) and a contrived `href="#face"` (which
 *      WOULD otherwise match the hex-color shape — `face` is a valid hex
 *      run) both out of the candidate list, counted under `excluded`
 *      rather than silently vanishing.
 *
 * Both of these are LOCAL, textual heuristics — not a full grammar — the
 * same trade-off `copy/src/scan.ts` states and defends for its own
 * exclusions. The one thing this scanner is NOT trying to solve, unlike
 * `copy`, is "is this the right SYNTACTIC position for a styling value" —
 * every value-shaped literal this scanner finds outside a comment and
 * outside a denylisted attribute IS a candidate, full stop. Precision
 * about whether it is a real GATE FINDING (vs. a legitimate token
 * reference) is `token-gate.ts`'s job, exactly the way `copy-gate.ts` is
 * left with the simpler job once `copy/src/scan.ts` has already decided
 * what counts as copy.
 *
 * ============================================================================
 * THE BOUNDARY — Tailwind TOKEN classes vs. ARBITRARY-VALUE classes
 * ============================================================================
 *
 * `text-ink-primary`, `bg-surface-base`, `p-4`, `z-10`, `rounded-control`
 * are the LEGITIMATE way this package consumes tokens: Tailwind (via
 * this package's `styles/theme.css` `@theme inline` block, and
 * this package's own `extendTailwindMerge` config in
 * `components/internal/cx.ts`) maps each of these to a real CSS custom
 * property. None of them are STYLING LITERALS in the sense this file
 * cares about — they carry no hardcoded value at all, only a NAME — so
 * this scanner never needs a denylist of "known good" class names to
 * leave them alone. They simply never match any of the four extraction
 * patterns below: no `#`, no `rgb(`/`oklch(`/etc., no digit-immediately-
 * followed-by-a-CSS-length-unit, no `ident-[...]` bracket syntax. A gate
 * that flagged every className string would be noise; this scanner is
 * silent on all of them BY CONSTRUCTION, not by an allowlist that could
 * rot.
 *
 * The one gap Tailwind's own utility vocabulary leaves is the ARBITRARY-
 * VALUE escape hatch — `bg-[#3b82f6]`, `p-[13px]`, `w-[var(--x,64px)]` —
 * which is exactly how a real hardcoded value smuggles itself into an
 * otherwise all-token className string. Tailwind arbitrary-value classes
 * are candidates in this scanner's fourth category (`"tw-arbitrary"`),
 * extracted whole (`ident-[...]`, the full bracketed token) rather than
 * as a bare literal, because the bracket's CONTENT is what `token-gate.ts`
 * needs to classify — see that file's header for exactly how a bracket's
 * inner text decides finding-vs-clean (the one place this scanner leaves
 * a real, load-bearing judgment call to the gate rather than deciding it
 * here).
 *
 * ============================================================================
 * WHAT THIS SCANNER DELIBERATELY DOES NOT CATCH, and why it is `unchecked`
 * rather than silent
 * ============================================================================
 *
 *   - An `ident-[...]` opener with no matching `]` before the end of its
 *     own line (`"unterminated-tw-arbitrary"`) — real Tailwind arbitrary
 *     values never span a line break, so this is always a genuine parse
 *     ambiguity (a stray `[` in unrelated code that happened to follow an
 *     identifier-and-dash), never a coverage gap on well-formed input.
 *   - A color-function opener (`rgb(`, `oklch(`, ...) whose parens never
 *     balance before end of file (`"unterminated-color-function"`).
 *   - A `#`-prefixed hex run of a length CSS never accepts — not 3, 4, 6,
 *     or 8 hex digits (`"invalid-hex-length"`) — recognized as hex-COLOR-
 *     SHAPED but not a value any CSS engine would honor, so this scanner
 *     refuses to guess whether it was meant as a color at all.
 *
 * Every one of these is pushed to `unchecked`, never dropped — see
 * `cli.ts` for exactly where a non-empty `unchecked` list lands in the
 * exit-code contract (spoiler: the same place `copy-check` puts its own
 * JSX-parse ambiguities — exit 2, "could not run [fully]", never a silent
 * pass).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

// --------------------------------------------------------------- walking

export interface ScanOptions {
  /** File extensions to read, each including the leading dot. Default: `.ts`, `.tsx`, `.js`, `.jsx`. */
  extensions?: string[];
  /** Directory names never descended into. Default: node_modules, .git, dist, build, coverage. */
  skipDirs?: string[];
}

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);

/**
 * `.test.ts(x)`, `.spec.ts(x)`, `.check.ts(x)`, and bare `.d.ts` — the
 * EXACT pattern `@example/copy`'s `scan.ts` uses (see its own
 * comment), reused verbatim rather than reinvented, and independently
 * justified here: `packages/ui/package.json`'s own `files` array already
 * excludes `src/**\/*.test.tsx` from what ships, so a hardcoded value that
 * lives only in a test fixture never reaches a real consumer's bundle —
 * scanning it would be reporting a finding about code nobody but this
 * package's own CI ever sees. `*.check.tsx` files (this package ships two:
 * `components/internal/icon-contract.check.tsx`,
 * `shell/internal/shell-contract.check.tsx`) are compile-time-only type
 * assertions, never imported at runtime — see
 * `scripts/check-typechecked-assertions.mjs` at the repo root for the
 * convention.
 */
const SKIP_FILE_RE = /\.(test|spec|check)\.(ts|tsx|js|jsx)$|\.d\.ts$/;

import { extractStyleCandidates } from "./style-extract.js";
import type { StyleCandidate, ExcludedOccurrence, UncheckedItem } from "./style-extract.js";
export { extractStyleCandidates, resolveFallbackChain, findEmbeddedStyleLiterals, isPureVarReference } from "./style-extract.js";
export type { StyleCandidateKind, StyleCandidate, ExcludedReason, ExcludedOccurrence, UncheckedItem, EmbeddedLiteral } from "./style-extract.js";
export interface SkippedFile {
  file: string;
  reason: "test-or-check-file";
}

/**
 * One construct this scanner recognized as styling-SHAPED but could not
 * reliably resolve to a concrete value — see this file's top comment,
 * "WHAT THIS SCANNER DELIBERATELY DOES NOT CATCH". Never how a genuine
 * blind spot gets to stay invisible: `token-gate.ts` and `cli.ts` both
 * refuse to let a non-empty list here go unreported, mirroring
 * `@example/copy`'s own `UncheckedItem` contract exactly.
 */
export interface StyleScanResult {
  /** Files whose content was successfully read. This is the number `cli.ts` requires to be > 0 for a clean pass. */
  filesScanned: number;
  candidates: StyleCandidate[];
  /** Every styling-shaped literal this scanner found and deliberately excluded, with why — never silently dropped. */
  excluded: ExcludedOccurrence[];
  /** Files matched by extension/walk but never scanned at all — test/check/declaration files, by design. Counted, never silent. */
  skippedByDesign: SkippedFile[];
  /** See `UncheckedItem`. Empty is the ordinary, expected outcome for a well-formed file. */
  unchecked: UncheckedItem[];
}

/**
 * Walks `root` recursively, reads every matching file, and extracts style
 * candidates from each (see `extractStyleCandidates`). FAILS CLOSED on an
 * unreadable directory or file — throws a plain `Error`, matching
 * `@example/copy`'s `scanCopySourceTree` (see that file's own
 * comment for why "0 files scanned" must never read as a clean pass for a
 * directory this function could not actually read). `cli.ts` is what turns
 * this thrown error into exit code 2.
 *
 * Unlike `copy`'s scanner, there is no per-file `parseFailures` concept
 * here, and that absence is deliberate, not an oversight: this scanner
 * never TOKENIZES a file's grammar (see this file's top comment) — it runs
 * regexes over raw text, which cannot "fail to parse" the way a
 * quote-balance-tracking tokenizer can desync on malformed input. The
 * closest analogue this scanner has to a partial failure is a single
 * unresolved CONSTRUCT within an otherwise-fine file, reported via
 * `unchecked`, not a whole file rejected outright.
 */
export function scanStyleSources(root: string, options: ScanOptions = {}): StyleScanResult {
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
  const skipDirs = new Set(options.skipDirs ?? DEFAULT_SKIP_DIRS);

  const result: StyleScanResult = {
    filesScanned: 0,
    candidates: [],
    excluded: [],
    skippedByDesign: [],
    unchecked: [],
  };

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      throw new Error(
        `scanStyleSources: cannot read directory "${dir}": ${error instanceof Error ? error.message : String(error)}`,
      );
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
        result.skippedByDesign.push({ file: relPath, reason: "test-or-check-file" });
        continue;
      }

      let content: string;
      try {
        content = readFileSync(full, "utf8");
      } catch (error) {
        throw new Error(
          `scanStyleSources: cannot read file "${full}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const extracted = extractStyleCandidates(content, relPath);
      result.filesScanned++;
      result.candidates.push(...extracted.candidates);
      result.excluded.push(...extracted.excluded);
      result.unchecked.push(...extracted.unchecked);
    }
  }

  walk(root);
  return result;
}
