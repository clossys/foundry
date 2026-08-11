/**
 * `scanStyleSources` and `extractStyleCandidates` — the visual mirror of
 * `@vespeneventures/copy`'s `scan.ts`. That file walks a source tree and
 * extracts every user-facing STRING; this file walks the same shape of
 * tree and extracts every hardcoded STYLING LITERAL — a hex color, a
 * `rgb()`/`rgba()`/`hsl()`/`hsla()`/`oklch()`/`oklab()`/`lab()`/`lch()`
 * color function, a raw CSS length (`13px`, `1.5rem`, `2em`, ...), or a
 * Tailwind arbitrary-value utility class (`bg-[#3b82f6]`, `p-[13px]`,
 * `w-[var(--x,64px)]`). This package's token layer owns the CONTRACT (the
 * 154-entry `TOKENS` registry); this file, `token-gate.ts`, and `cli.ts`
 * are `@vespeneventures/ui`'s copy of `copy`/`copy-gate.ts`/`cli.ts` —
 * before this package existed, `ui` shipped no gate at all: a hardcoded
 * `#3b82f6` or `padding: 13px` anywhere in this package was as invisible
 * as an unregistered string used to be before `copy` shipped its scanner.
 *
 * NO PARSER LIBRARY, same zero-runtime-dependency rule `copy/src/scan.ts`
 * states for itself — this repository's CI `safety` job runs gate scripts
 * with no `npm ci` at all, and `@vespeneventures/ui` itself is the one
 * package in this repo already exempted from "zero dependencies" for its
 * OWN runtime (it wraps React) — but that exemption does not extend to
 * THIS file: a scanner that a consumer might invoke standalone (via the
 * installed `ui-token-check` CLI) must not drag in a CSS parser, a
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
 * `atoms/internal/cx.ts`) maps each of these to a real CSS custom
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
 * EXACT pattern `@vespeneventures/copy`'s `scan.ts` uses (see its own
 * comment), reused verbatim rather than reinvented, and independently
 * justified here: `packages/ui/package.json`'s own `files` array already
 * excludes `src/**\/*.test.tsx` from what ships, so a hardcoded value that
 * lives only in a test fixture never reaches a real consumer's bundle —
 * scanning it would be reporting a finding about code nobody but this
 * package's own CI ever sees. `*.check.tsx` files (this package ships two:
 * `atoms/internal/icon-contract.check.tsx`,
 * `shell/internal/shell-contract.check.tsx`) are compile-time-only type
 * assertions, never imported at runtime — see
 * `scripts/check-typechecked-assertions.mjs` at the repo root for the
 * convention.
 */
const SKIP_FILE_RE = /\.(test|spec|check)\.(ts|tsx|js|jsx)$|\.d\.ts$/;

export type StyleCandidateKind = "hex-color" | "color-function" | "raw-length" | "tw-arbitrary";

export interface StyleCandidate {
  /** Repo-relative, `/`-joined path this candidate was found in. */
  file: string;
  /** 1-indexed line the literal starts on. */
  line: number;
  kind: StyleCandidateKind;
  /**
   * The full matched source text — `"#3b82f6"`, `"oklch(0.4748 0 0)"`,
   * `"13px"`, or (for `"tw-arbitrary"`) the WHOLE bracketed utility class,
   * e.g. `"bg-[#3b82f6]"`.
   */
  raw: string;
  /**
   * The value `token-gate.ts` actually classifies. Identical to `raw` for
   * every kind except `"tw-arbitrary"`, where it is just the bracket's
   * INNER text (`"#3b82f6"` for `raw: "bg-[#3b82f6]"`) — see this file's
   * top comment, "THE BOUNDARY".
   */
  value: string;
  /** Whether a `token-gate:ignore` marker (see `IGNORE_MARKER_RE`) is present on this candidate's own source line. */
  hasIgnoreMarker: boolean;
  /**
   * For `"hex-color"` / `"color-function"` / `"raw-length"` candidates:
   * the `--property` this literal is a `var()` fallback FOR, resolved
   * structurally by `resolveFallbackChain` against the file's own real
   * nesting — `undefined` for a bare literal reached by no `var(...)` at
   * all. Always `undefined` for `"tw-arbitrary"`: that candidate IS the
   * whole bracket, not a literal itself — a bracket's OWN embedded
   * literals (which individually MAY be fallbacks) are resolved by
   * `findEmbeddedStyleLiterals` on `value`, not here. See
   * `resolveFallbackChain`'s own doc comment for why this is resolved by
   * parsing structure, never by searching `TOKENS` for a same-valued
   * entry.
   */
  fallbackForProperty: string | undefined;
}

export type ExcludedReason = "comment" | "regex-literal" | "structural-or-a11y-attribute-value";

export interface ExcludedOccurrence {
  file: string;
  line: number;
  /** The literal's raw matched text, for a human auditing the exclusion list. */
  raw: string;
  reason: ExcludedReason;
}

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
 * `@vespeneventures/copy`'s own `UncheckedItem` contract exactly.
 */
export interface UncheckedItem {
  file: string;
  line: number;
  /** A short, stable machine-readable name, e.g. `"unterminated-tw-arbitrary"`, `"unterminated-color-function"`, `"invalid-hex-length"`. */
  kind: string;
  /** Human-readable explanation, for a report or a human auditing the list. */
  detail: string;
}

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
 * `@vespeneventures/copy`'s `scanCopySourceTree` (see that file's own
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

// ------------------------------------------------------------- extraction

/** CSS length units this scanner treats as a "raw length" — deliberately COLOR- and LENGTH-scoped, not every CSS unit: time (`ms`/`s`) and angle (`deg`) units are out of scope (see this file's top comment) — a motion/duration hardcode is a real, different check, not this one. */
const LENGTH_UNITS = ["px", "rem", "em", "vmin", "vmax", "vh", "vw", "ch", "ex", "pt", "pc", "cm", "mm", "q", "in"];

const HEX_RUN_RE = /#([0-9a-fA-F]{3,8})\b/g;
const COLOR_FN_OPENER_RE = /\b(rgba?|hsla?|oklch|oklab|lab|lch)\(/g;
const RAW_LENGTH_RE = new RegExp(`(?<![\\w.])(\\d+(?:\\.\\d+)?)(${LENGTH_UNITS.join("|")})(?![\\w])`, "g");
const TW_ARBITRARY_OPENER_RE = /([a-zA-Z_][\w:/-]*)-\[/g;

/**
 * Resolves whether the literal STARTING at `index` in `text` sits inside a
 * `var(--property, <fallback>)` call as that call's OWN fallback argument —
 * and if so, which `--property`. Returns `undefined` for a bare literal (no
 * enclosing `var(...)` at all, or the nearest enclosing call is some OTHER
 * function like `rgba(`/`min(`/`clamp(`).
 *
 * WHY THIS IS STRUCTURAL, NOT VALUE-BASED — the distinction this function
 * exists to get right: an earlier version of this gate decided "which token
 * does this literal belong to" by searching this package's token layer
 * `TOKENS` registry for an entry whose VALUE happened to equal the literal.
 * That is wrong for exactly the case that matters most: `atoms/Icon.tsx`'s
 * `"var(--ui-icon-sm, var(--spacing-lg, 16px))"` has its `16px` fallback
 * INSIDE `--spacing-lg`'s own `var(...)` — value-matching against the
 * registry happens to land on `--spacing-lg` too here, but only by
 * coincidence (nothing about a value-search KNOWS the literal is `--spacing-
 * lg`'s fallback specifically, as opposed to any other token that happens to
 * also be `"16px"`), and it silently breaks the moment two different tokens
 * ever share a value, or a literal fallback drifts to a value NO token has —
 * a value-search would then report "no token backs this", even while the
 * source text plainly says which property it is the fallback for. This
 * function instead PARSES the actual nesting: walk backward from `index`
 * tracking paren depth until the nearest UNMATCHED `(` is found (the
 * innermost function call enclosing this position), confirm that call's
 * name is literally `var`, then parse forward from that `(` to read the
 * `--property` name and confirm `index` falls after its first top-level
 * comma (i.e., in the fallback slot, not the property-name slot). Because
 * this walks OUTWARD from `index` and stops at the FIRST enclosing `(`, a
 * doubly-nested chain (`var(--a, var(--b, 16px))`) always resolves to the
 * INNERMOST wrapping property (`--b`), never an outer or unrelated one —
 * exactly the semantics a reader of the source text would expect, and the
 * literal-position analogue of `tokenize()`'s own "nearest enclosing call"
 * backward scan in `@vespeneventures/copy`'s `scan.ts`
 * (`enclosingCallName`), applied here to `var(...)` specifically instead of
 * a class-name builder.
 */
interface EnclosingCall {
  /** Index of the call's own opening "(". */
  openIndex: number;
  /** The identifier immediately before "(", e.g. "var", "clamp", "rgba" — "" if none (a bare grouping paren). */
  name: string;
}

/**
 * Backward, paren-depth-aware scan from `pos - 1` for the NEAREST still-open
 * `(` relative to `pos` — the innermost function call `pos` sits inside,
 * one layer at a time. Shared by `resolveFallbackChain` below, which calls
 * this repeatedly to peel through wrapping calls that are NOT `var(`.
 */
function findEnclosingCall(text: string, pos: number): EnclosingCall | null {
  let depth = 0;
  let i = pos - 1;
  while (i >= 0) {
    const c = text[i] as string;
    if (c === ")") {
      depth++;
      i--;
      continue;
    }
    if (c === "(") {
      if (depth > 0) {
        depth--;
        i--;
        continue;
      }
      let j = i - 1;
      while (j >= 0 && /\s/.test(text[j] as string)) j--;
      const nameEnd = j + 1;
      while (j >= 0 && /[A-Za-z_$]/.test(text[j] as string)) j--;
      return { openIndex: i, name: text.slice(j + 1, nameEnd) };
    }
    i--;
  }
  return null;
}

/**
 * Resolves whether the literal STARTING at `index` in `text` sits inside a
 * `var(--property, <fallback>)` call as that call's OWN fallback argument —
 * and if so, which `--property`. Returns `undefined` for a bare literal (no
 * enclosing `var(...)` anywhere, however many layers out).
 *
 * WHY THIS IS STRUCTURAL, NOT VALUE-BASED — the distinction this function
 * exists to get right: an earlier version of this gate decided "which token
 * does this literal belong to" by searching this package's token layer
 * `TOKENS` registry for an entry whose VALUE happened to equal the literal.
 * That is wrong for exactly the case that matters most: `atoms/Icon.tsx`'s
 * `"var(--ui-icon-sm, var(--spacing-lg, 16px))"` has its `16px` fallback
 * INSIDE `--spacing-lg`'s own `var(...)` — value-matching against the
 * registry happens to land on `--spacing-lg` too here, but only by
 * coincidence (nothing about a value-search KNOWS the literal is `--spacing-
 * lg`'s fallback specifically, as opposed to any other token that happens to
 * also be `"16px"`), and it silently breaks the moment two different tokens
 * ever share a value, or a literal fallback drifts to a value NO token has —
 * a value-search would then report "no token backs this", even while the
 * source text plainly says which property it is the fallback for. This
 * function instead PARSES the actual nesting via `findEnclosingCall`,
 * PEELING OUTWARD one call at a time:
 *
 *   1. Find the nearest enclosing `(...)`. If none exists at all, the
 *      literal is bare — return `undefined`.
 *   2. If that call's name is literally `var`, this is (subject to the
 *      comma check in step 4) the answer: the INNERMOST wrapping `var(...)`,
 *      never an outer or unrelated one. This is what makes a doubly-nested
 *      chain (`var(--a, var(--b, 16px))`) resolve to `--b`, not `--a` — the
 *      literal-position analogue of `tokenize()`'s own "nearest enclosing
 *      call" backward scan in `@vespeneventures/copy`'s `scan.ts`
 *      (`enclosingCallName`), applied here to `var(...)` specifically.
 *   3. If that call's name is anything ELSE — `clamp(`, `min(`, `calc(`,
 *      `rgba(`, ... — this is NOT a decision point, it is a layer to see
 *      PAST: `var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))` (the
 *      real shape `shell/internal/shell-vars.ts`'s `UI_WIDTH_PAGE_PADDING_X`
 *      uses) has its `16px`/`4vw`/`48px` each wrapped DIRECTLY by `clamp(`,
 *      but `clamp(...)`'s own result IS `--ui-width-page-padding-x`'s
 *      fallback value as a whole — from the "does this literal only take
 *      effect when the token is absent" question this gate cares about,
 *      being one non-`var` function away from the `var(...)` is no
 *      different from being zero away. So this case re-searches from
 *      BEFORE that wrapping call's own name (`clamp`), continuing outward
 *      until a `var(` is found or the search runs out of enclosing calls
 *      entirely.
 *   4. Once an enclosing `var(` is found, parse forward from its `(` to
 *      read `--property` and confirm the ORIGINAL `index` falls after that
 *      call's first top-level comma (the fallback slot, not the
 *      property-name slot).
 */
export function resolveFallbackChain(text: string, index: number): string | undefined {
  let searchFrom = index;
  for (;;) {
    const enclosing = findEnclosingCall(text, searchFrom);
    if (!enclosing) return undefined; // no enclosing call left at all — bare literal
    if (enclosing.name !== "var") {
      // Peel this layer: keep looking OUTWARD from just before this call's
      // own name (its identifier's start), not from its "(" — searching
      // from the "(" itself would immediately re-find this same call.
      searchFrom = enclosing.openIndex - enclosing.name.length;
      continue;
    }
    // Parse forward from "var("'s own "(" to read "--property" then
    // confirm the ORIGINAL `index` (not `searchFrom`, which may have
    // walked outward through intermediate wrapping calls) falls after
    // this var()'s first top-level comma.
    const propMatch = /^\(\s*(--[A-Za-z0-9_-]+)\s*,/.exec(text.slice(enclosing.openIndex));
    if (!propMatch) return undefined; // e.g. var(--x) with no comma at all — not a fallback context, isPureVarReference's territory
    const commaOffsetInMatch = (propMatch[0] as string).length - 1; // index of "," within propMatch[0]
    const commaIndex = enclosing.openIndex + commaOffsetInMatch;
    if (index <= commaIndex) return undefined; // `index` sits inside the property-name slot, not the fallback — cannot happen for a value-shaped literal in practice, checked anyway
    return propMatch[1] as string;
  }
}

/**
 * Every leaf value-shape this scanner recognizes, reused by `token-gate.ts`
 * to classify text INSIDE a `"tw-arbitrary"` candidate's bracket (see this
 * file's top comment, "THE BOUNDARY") without re-walking a whole file.
 */
export interface EmbeddedLiteral {
  kind: "hex-color" | "color-function" | "raw-length";
  raw: string;
  /** See `resolveFallbackChain` — the `--property` this literal is the `var()` fallback FOR, resolved structurally from `text`'s own nesting, or `undefined` for a bare literal. */
  fallbackForProperty: string | undefined;
}

/**
 * Finds every hex-color / color-function / raw-length literal embedded
 * anywhere in `text` (a short, already-isolated string — a Tailwind
 * arbitrary-value bracket's inner content, in practice). Deliberately
 * reuses the exact same leaf regexes the top-level scan uses, so a value
 * shape is recognized identically whether it sits in a plain string or
 * inside `[...]`. Unlike the top-level scan, this does NOT recurse into
 * nested `ident-[...]` brackets (Tailwind has no such nesting) and does
 * not compute comment/attribute exclusions (a bracket's own content is
 * never itself a comment or a denylisted attribute).
 */
export function findEmbeddedStyleLiterals(text: string): EmbeddedLiteral[] {
  const found: EmbeddedLiteral[] = [];
  for (const m of text.matchAll(new RegExp(HEX_RUN_RE.source, "g"))) {
    const len = (m[1] as string).length;
    if (len === 3 || len === 4 || len === 6 || len === 8) {
      found.push({ kind: "hex-color", raw: m[0], fallbackForProperty: resolveFallbackChain(text, m.index as number) });
    }
  }
  for (const m of text.matchAll(new RegExp(COLOR_FN_OPENER_RE.source, "g"))) {
    const start = m.index as number;
    let depth = 1;
    let j = start + m[0].length;
    while (j < text.length && depth > 0) {
      if (text[j] === "(") depth++;
      else if (text[j] === ")") depth--;
      j++;
    }
    if (depth === 0) {
      found.push({ kind: "color-function", raw: text.slice(start, j), fallbackForProperty: resolveFallbackChain(text, start) });
    }
  }
  for (const m of text.matchAll(new RegExp(RAW_LENGTH_RE.source, "g"))) {
    found.push({ kind: "raw-length", raw: m[0], fallbackForProperty: resolveFallbackChain(text, m.index as number) });
  }
  return found;
}

/** `true` for a bracket value that is EXACTLY a bare `var(--custom-property)` reference with no fallback — the one arbitrary-value shape `token-gate.ts` treats as clean rather than a finding. See `token-gate.ts`'s header for the full reasoning (including why a fallback DOES still count as a finding). */
export function isPureVarReference(text: string): boolean {
  return /^var\(\s*--[\w-]+\s*\)$/.test(text.trim());
}

/** `// token-gate:ignore [reason]`, `/* token-gate:ignore *\/`, or `{/* token-gate:ignore *\/}` — this scanner's escape hatch, mirroring `@vespeneventures/copy`'s `copy-gate:ignore` exactly (same requirement: explicit, on the candidate's own line, greppable — never a silent allowlist buried in config). */
const IGNORE_MARKER_RE = /(?:<!--|\/\*|\{\/\*|\/\/)\s*token-gate:ignore/i;

/**
 * Structural / accessibility attribute NAMES whose values this scanner
 * never treats as a styling literal, even when the value happens to be
 * hex-shaped or length-shaped — mirrors `@vespeneventures/copy`'s
 * `scan.ts` exclusions #4/#5 (aria/data values; a fixed denylist of
 * structural prop names), independently justified here: `viewBox`/`d`/
 * `points`/`xmlns` are SVG geometry, not color/length CSS; `href`/`src`/
 * `id`/`key`/`testId`/`htmlFor`/`rel`/`target`/`role`/`name`/`slot`/
 * `autoComplete`/`inputMode`/`pattern`/`method`/`encType` are identifiers
 * or protocol values that can coincidentally be hex-shaped (`href="#face"`
 * is valid HTML and `face` is a valid hex run) or, in principle, contain a
 * digit-unit-shaped substring. Detected the same LOCAL, textual way
 * `copy`'s own denylist is: the text immediately before a match, on the
 * SAME LINE, ending in `<name>` followed by `=`/`:` and an optional quote/
 * brace — a real limitation (a value that legitimately spans multiple
 * lines before reaching this attribute is not traced back), stated here
 * rather than silently assumed away.
 */
const ATTR_CONTEXT_RE =
  /(?:aria-[\w-]+|data-(?!\[)[\w-]+|href|src|id|key|xmlns|viewBox|d|points|testId|htmlFor|rel|target|role|name|slot|autoComplete|inputMode|pattern|method|encType)\s*[:=]\s*["'{]?\s*$/;

interface Region {
  start: number;
  end: number;
  kind: "comment" | "regex-literal";
}

/** Keywords after which `/` cannot be a division operator — an expression is expected next, so `/` starts a regex. Same convention `@vespeneventures/copy`'s `scan.ts` uses for the identical disambiguation (`REGEX_PRECEDING_KEYWORDS`), reused independently here rather than imported, since this file has zero runtime dependencies, including on its own sibling package. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

/**
 * Single left-to-right walk over `content` that identifies every COMMENT
 * span (`// ...` to end of line; `/* ... *\/`, including JSDoc) and every
 * REGEX LITERAL span, WITHOUT treating a `"`/`'`/`` ` `` found inside
 * either as a real string delimiter — the string-awareness this file
 * needs (see top comment) plus, as of the fix for a self-scan finding
 * this package's own PR review surfaced (a regex character class
 * containing a quote character, `["'{]` in this very file's
 * `ATTR_CONTEXT_RE`, was desyncing this function's quote tracking for
 * everything after it — see this file's CHANGELOG-worthy history if this
 * comment is ever extracted verbatim), the regex-literal awareness this
 * function ALSO needs so a `/pattern/flags` literal's own delimiters and
 * character-class contents are never mistaken for real quote/comment
 * syntax either.
 *
 * Regex-vs-division disambiguation reuses EXACTLY the heuristic
 * `copy/src/scan.ts` documents and defends for its own tokenizer: a `/`
 * starts a regex literal only when the last significant token could not
 * itself end an expression (`lastSig === "other"` below) — a `)` or `]`
 * closing a prior expression, or an identifier that is not one of
 * `REGEX_PRECEDING_KEYWORDS`, means the NEXT `/` is division, never
 * regex. This is a real, accepted, documented simplification with the
 * same known limitation `copy`'s own heuristic states (wrong on rare,
 * contrived inputs where the heuristic desyncs) — the difference here is
 * scope: this function only needs a CORRECT SKIP, not a fully classified
 * token stream, so a regex literal this heuristic fails to recognize
 * simply falls through to being scanned as ordinary text, the same
 * pre-existing (accepted) behavior this file always had for `/`.
 *
 * Deliberately NOT a full tokenizer in one further respect: it does not
 * track `${...}` template interpolation depth (a `//`/`/*`/regex inside a
 * nested interpolation's own string is treated as plain string content
 * the same as anywhere else — correct for every real case in this
 * codebase, which has no such nesting).
 */
function computeSkipRegions(content: string): Region[] {
  const regions: Region[] = [];
  const n = content.length;
  let i = 0;
  let lastSig: "value" | "other" = "other";

  while (i < n) {
    const c = content[i] as string;

    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n) {
        if (content[i] === "\\" && i + 1 < n) {
          i += 2;
          continue;
        }
        if (content[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      lastSig = "value";
      continue;
    }

    if (c === "/" && content[i + 1] === "/") {
      const nl = content.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      regions.push({ start: i, end, kind: "comment" });
      i = end;
      continue; // a comment never changes expression-start state
    }

    if (c === "/" && content[i + 1] === "*") {
      const close = content.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      regions.push({ start: i, end, kind: "comment" });
      i = end;
      continue;
    }

    if (c === "/" && lastSig === "other") {
      // Attempt a regex literal: scan for its closing "/", never inside a
      // "[...]" character class (where an unescaped "/" is legal and NOT
      // the delimiter), bailing (falling through to ordinary-character
      // handling below) the moment a raw newline is hit — a real regex
      // literal never spans a line, so hitting one means this was never a
      // regex to begin with (most likely plain division after all, on an
      // input this heuristic's simplification doesn't correctly classify
      // — see this function's own header).
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const cj = content[j] as string;
        if (cj === "\n") break;
        if (cj === "\\" && j + 1 < n) {
          j += 2;
          continue;
        }
        if (cj === "[") {
          inClass = true;
          j++;
          continue;
        }
        if (cj === "]") {
          inClass = false;
          j++;
          continue;
        }
        if (cj === "/" && !inClass) {
          j++;
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        while (j < n && /[a-zA-Z]/.test(content[j] as string)) j++; // flags
        regions.push({ start: i, end: j, kind: "regex-literal" });
        i = j;
        lastSig = "value";
        continue;
      }
      // Not a valid single-line regex literal — fall through and treat
      // this "/" as an ordinary character (division), same as the
      // pre-existing behavior for a "/" that reaches neither branch above.
    }

    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(content[j] as string)) j++;
      const word = content.slice(i, j);
      lastSig = REGEX_PRECEDING_KEYWORDS.has(word) ? "other" : "value";
      i = j;
      continue;
    }

    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9a-fA-Fx.]/.test(content[j] as string)) j++;
      lastSig = "value";
      i = j;
      continue;
    }

    if (c === ")" || c === "]") {
      lastSig = "value";
      i++;
      continue;
    }

    // Every other punctuation character (operators, "(", "[", "{", "}",
    // ",", ...) leaves an expression expected next.
    lastSig = "other";
    i++;
  }
  return regions;
}

/** Regions are pushed in strictly increasing `start` order by `computeSkipRegions`'s single forward pass, so a linear scan that stops the moment a region starts past `index` is correct and, for the file sizes this scanner runs against, plenty fast — no need for a binary search over what is typically a handful of comment/regex spans per file. Returns the matching region's `kind` (or `undefined`) rather than a bare boolean so a caller can report the right `ExcludedReason`. */
function regionAt(index: number, regions: Region[]): Region["kind"] | undefined {
  for (const r of regions) {
    if (r.start > index) break;
    if (index < r.end) return r.kind;
  }
  return undefined;
}

function computeLineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** Binary search for the greatest `lineStarts[k] <= index` — `lineStarts` is sorted ascending by construction. */
function lineOf(index: number, lineStarts: number[]): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lineStarts[mid] as number) <= index) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans + 1; // 1-indexed
}

interface ExtractResult {
  candidates: StyleCandidate[];
  excluded: ExcludedOccurrence[];
  unchecked: UncheckedItem[];
}

/**
 * Extracts every style candidate from a single file's already-read
 * `content`. Pure (no I/O) and exported directly — mirrors
 * `@vespeneventures/copy`'s `extractCopyCandidates` — so a test can
 * exercise extraction against a short in-memory string without touching a
 * real file, and so `scanStyleSources` above is left with only the
 * directory-walk half.
 */
export function extractStyleCandidates(content: string, file: string): ExtractResult {
  const candidates: StyleCandidate[] = [];
  const excluded: ExcludedOccurrence[] = [];
  const unchecked: UncheckedItem[] = [];

  const skipRegions = computeSkipRegions(content);
  const lineStarts = computeLineStarts(content);
  // Spans already reported as a "tw-arbitrary" or "color-function" candidate
  // — a literal INSIDE one of these (e.g. the `#3b82f6` inside
  // `bg-[#3b82f6]`, or a stray hex inside an `rgba(...)` argument list) is
  // reported ONCE, as part of that outer candidate, never a second time as
  // its own bare `hex-color`/`raw-length` candidate. This is deduplication,
  // not information loss — the underlying text is still fully accounted
  // for, just under one candidate instead of two (see `token-gate.ts` for
  // how a `tw-arbitrary` candidate's own bracket content is classified).
  const claimed: Array<{ start: number; end: number }> = [];

  function isClaimed(index: number): boolean {
    // Unlike `regionAt` (which scans a SINGLE pass's naturally
    // start-sorted output), `claimed` is appended to across TWO separate
    // passes (tw-arbitrary, then color-function) — each individually
    // increasing but not merged, so an early "start > index" break here
    // would be wrong. A full linear scan is still cheap: at most a
    // handful of claimed spans per file.
    for (const r of claimed) {
      if (index >= r.start && index < r.end) return true;
    }
    return false;
  }

  function lineTextOf(line1: number): string {
    const start = lineStarts[line1 - 1] as number;
    const nextStart = lineStarts[line1] as number | undefined;
    const end = nextStart === undefined ? content.length : nextStart - 1;
    return content.slice(start, end);
  }

  function hasIgnoreMarkerOnLine(line1: number): boolean {
    return IGNORE_MARKER_RE.test(lineTextOf(line1));
  }

  function isAttrContextExcluded(index: number, line1: number): boolean {
    const lineStart = lineStarts[line1 - 1] as number;
    const prefix = content.slice(lineStart, index);
    return ATTR_CONTEXT_RE.test(prefix);
  }

  // ---- pass 1: tw-arbitrary openers (claims its own span) ----
  for (const m of content.matchAll(new RegExp(TW_ARBITRARY_OPENER_RE.source, "g"))) {
    const idx = m.index as number;
    const line = lineOf(idx, lineStarts);
    const skipKind = regionAt(idx, skipRegions);
    if (skipKind !== undefined) {
      excluded.push({ file, line, raw: m[0], reason: skipKind });
      continue;
    }
    let depth = 1;
    let j = idx + m[0].length;
    let unterminated = false;
    while (j < content.length && depth > 0) {
      const ch = content[j] as string;
      if (ch === "\n") {
        unterminated = true; // Tailwind arbitrary-value classes never span a line break
        break;
      }
      if (ch === "[") depth++;
      else if (ch === "]") depth--;
      j++;
    }
    if (unterminated || depth !== 0) {
      // Claim the span we DID manage to scan (opener through wherever the
      // forward scan stopped) even though it never resolved to a real
      // candidate — otherwise a leaf pass (hex-color/raw-length) below
      // would independently rediscover the same underlying text and
      // report it a second time as its OWN candidate, which would read as
      // "this is both unchecked AND a finding" for one piece of source
      // text. One unresolved construct, one `unchecked` entry.
      claimed.push({ start: idx, end: j });
      unchecked.push({
        file,
        line,
        kind: "unterminated-tw-arbitrary",
        detail: `arbitrary-value class opener "${m[0]}" has no matching "]" before end of line`,
      });
      continue;
    }
    if (isAttrContextExcluded(idx, line)) {
      excluded.push({ file, line, raw: content.slice(idx, j), reason: "structural-or-a11y-attribute-value" });
      continue;
    }
    claimed.push({ start: idx, end: j });
    const full = content.slice(idx, j);
    const value = content.slice(idx + m[0].length, j - 1);
    candidates.push({
      file,
      line,
      kind: "tw-arbitrary",
      raw: full,
      value,
      hasIgnoreMarker: hasIgnoreMarkerOnLine(line),
      // A "tw-arbitrary" candidate IS the whole bracket, never itself a
      // literal inside a var() call — its own EMBEDDED literals (which
      // individually may be fallbacks) are resolved separately, from
      // `value` alone, by `findEmbeddedStyleLiterals` in token-gate.ts.
      fallbackForProperty: undefined,
    });
  }

  // ---- pass 2: color-function openers (claims its own span) ----
  for (const m of content.matchAll(new RegExp(COLOR_FN_OPENER_RE.source, "g"))) {
    const idx = m.index as number;
    const line = lineOf(idx, lineStarts);
    if (isClaimed(idx)) continue;
    const skipKind = regionAt(idx, skipRegions);
    if (skipKind !== undefined) {
      excluded.push({ file, line, raw: m[0], reason: skipKind });
      continue;
    }
    let depth = 1;
    let j = idx + m[0].length;
    while (j < content.length && depth > 0) {
      if (content[j] === "(") depth++;
      else if (content[j] === ")") depth--;
      j++;
    }
    if (depth !== 0) {
      claimed.push({ start: idx, end: j });
      unchecked.push({
        file,
        line,
        kind: "unterminated-color-function",
        detail: `color function "${m[0]}" never closes its parentheses before end of file`,
      });
      continue;
    }
    if (isAttrContextExcluded(idx, line)) {
      excluded.push({ file, line, raw: content.slice(idx, j), reason: "structural-or-a11y-attribute-value" });
      continue;
    }
    claimed.push({ start: idx, end: j });
    const full = content.slice(idx, j);
    candidates.push({
      file,
      line,
      kind: "color-function",
      raw: full,
      value: full,
      hasIgnoreMarker: hasIgnoreMarkerOnLine(line),
      fallbackForProperty: resolveFallbackChain(content, idx),
    });
  }

  // ---- pass 3: hex colors (leaf — no span of its own to claim) ----
  for (const m of content.matchAll(new RegExp(HEX_RUN_RE.source, "g"))) {
    const idx = m.index as number;
    const line = lineOf(idx, lineStarts);
    if (isClaimed(idx)) continue;
    const skipKind = regionAt(idx, skipRegions);
    if (skipKind !== undefined) {
      excluded.push({ file, line, raw: m[0], reason: skipKind });
      continue;
    }
    const digits = m[1] as string;
    const len = digits.length;
    if (len !== 3 && len !== 4 && len !== 6 && len !== 8) {
      unchecked.push({
        file,
        line,
        kind: "invalid-hex-length",
        detail: `"${m[0]}" looks like a hex color but has ${len} hex digit(s) — not a valid CSS hex length (3, 4, 6, or 8)`,
      });
      continue;
    }
    if (isAttrContextExcluded(idx, line)) {
      excluded.push({ file, line, raw: m[0], reason: "structural-or-a11y-attribute-value" });
      continue;
    }
    candidates.push({
      file,
      line,
      kind: "hex-color",
      raw: m[0],
      value: m[0],
      hasIgnoreMarker: hasIgnoreMarkerOnLine(line),
      fallbackForProperty: resolveFallbackChain(content, idx),
    });
  }

  // ---- pass 4: raw lengths (leaf) ----
  for (const m of content.matchAll(new RegExp(RAW_LENGTH_RE.source, "g"))) {
    const idx = m.index as number;
    const line = lineOf(idx, lineStarts);
    if (isClaimed(idx)) continue;
    const skipKind = regionAt(idx, skipRegions);
    if (skipKind !== undefined) {
      excluded.push({ file, line, raw: m[0], reason: skipKind });
      continue;
    }
    if (isAttrContextExcluded(idx, line)) {
      excluded.push({ file, line, raw: m[0], reason: "structural-or-a11y-attribute-value" });
      continue;
    }
    candidates.push({
      file,
      line,
      kind: "raw-length",
      raw: m[0],
      value: m[0],
      hasIgnoreMarker: hasIgnoreMarkerOnLine(line),
      fallbackForProperty: resolveFallbackChain(content, idx),
    });
  }

  // Stable sort (V8's Array#sort is stable) — ties keep the pass order
  // above (tw-arbitrary, color-function, hex-color, raw-length), which is
  // immaterial to correctness and only affects report readability.
  candidates.sort((a, b) => a.line - b.line);
  return { candidates, excluded, unchecked };
}
