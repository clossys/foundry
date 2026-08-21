/**
 * `parseBrandDeclarations` and `readBrandCss` — the I/O and parsing half
 * that makes `checkBrandFileCoverage` (`check-brand-file-coverage.ts`) usable
 * against a REAL file on disk, not just a hand-built `Record` in a test.
 * Mirrors the split every sibling package in this repository draws between
 * a pure parser and a caller-facing file reader:
 * `@vespeneventures/copy`'s `scan.ts` (`extractCopyCandidates`, pure, then
 * `scanCopySourceTree`, I/O) and `@vespeneventures/strategy`'s
 * `reader.ts`/`registry.ts` `read*` functions.
 *
 * ZERO RUNTIME DEPENDENCIES, HAND-WRITTEN — DELIBERATELY, NOT BY DEFAULT
 * --------------------------------------------------------------------------
 * `@vespeneventures/copy`'s `scan.ts` header comment gives the reason this
 * repository keeps making the same call: this repository's CI `safety` job
 * (`scripts/check-public-safety.mjs` et al.) runs gates with no `npm ci` —
 * a real CSS parser as a dependency would mean the gate cannot run in the
 * one place it matters most. `@vespeneventures/designer/tokens` already ships
 * one small, test-only CSS reader (`internal/parse-css.ts`) — this file is
 * NOT that one, and does not extend it, for a concrete reason: that reader
 * is scoped narrowly to what this package's OWN test suite needs (exactly
 * one bare `:root { ... }` block for `parseRootDeclarations`, and a small,
 * closed set of known selector strings for `parseDeclarationsForSelector`),
 * with no nesting and no nested `@media` handling — sufficient for THIS
 * package's own `styles/tokens.css` and `styles/brand-template.css`, which
 * this package fully controls, but not for an arbitrary consumer's real
 * `brand.css`, which this package does not control and must not assume the
 * shape of. This file is the general-purpose sibling: it walks arbitrary
 * nesting of selector blocks inside `@media`/`@supports`/`@layer` grouping
 * rules, to whatever depth the real file uses, and never assumes there is
 * exactly one relevant block.
 *
 * WHAT THIS PARSES, AND HOW
 * ---------------------------
 * A hand-rolled, brace-depth-aware walker — not a regex over the whole
 * file, because a single regex cannot correctly tell a `{`/`}` that opens
 * or closes a RULE apart from one that appears inside a quoted attribute
 * selector (`[data-theme="dark"]` contains no braces, but a value theoretically
 * could via a quoted string) without also tracking quote state:
 *
 *   1. Comments (`/* ... *\/`) are stripped first, each character replaced
 *      by a space EXCEPT newlines, which are kept — this preserves every
 *      subsequent line number and byte offset exactly, rather than
 *      shifting them the way a naive `.replace(re, "")` would.
 *   2. The (comment-stripped) text is walked for `{`/`}` pairs, skipping
 *      over quoted strings so a stray brace-shaped character inside a
 *      string can never be mistaken for a real block boundary. Each
 *      top-level `selector { body }` found this way is classified:
 *        - a `@media`, `@supports`, or `@layer` (with a block) selector is
 *          a GROUPING rule — its body is walked recursively for MORE
 *          nested `selector { body }` blocks, to unlimited depth. This is
 *          what makes `:root[data-brand-bound]:not([data-theme="light"])`
 *          nested inside `@media (prefers-color-scheme: dark) { ... }`
 *          resolve correctly — the exact shape
 *          `styles/brand-template.css` itself uses.
 *        - any other selector's body is a FLAT declaration list — scanned
 *          directly for `--property: value;` pairs (see below). This
 *          covers a bare `:root { ... }` and any number of OTHER selectors
 *          in the same file (`:root[data-brand-bound]`,
 *          `:root[data-brand-bound][data-theme="dark"]`, or a selector this
 *          package has no opinion about at all — every custom-property
 *          declaration found anywhere is reported, regardless of which
 *          selector it sits under; deciding whether that selector is one a
 *          brand SHOULD be using is `checkBrandFileCoverage`'s job, not this
 *          reader's).
 *   3. Inside a flat body, `(--[a-zA-Z0-9-]+)\s*:\s*([^;]*?)\s*(;|$)` finds
 *      every declaration. The value group is non-greedy up to the next
 *      `;`, OR the end of the body for a final declaration with no
 *      trailing semicolon (valid CSS) — both are real, common shapes, and
 *      `[^;]` (a negated character class, not `.`) matches a literal
 *      newline exactly as `.` cannot, so a value split across several
 *      lines is captured whole. Multiple declarations for the SAME
 *      property (e.g. the same slot restated in more than one selector
 *      block — `styles/brand-template.css`'s own light/dark blocks) resolve
 *      LAST-DECLARATION-WINS, in source order — a deliberate simplification,
 *      not a full CSS cascade/specificity resolver: for the coverage
 *      question this reader exists to answer ("did the brand supply SOME
 *      real value for this slot, anywhere"), which block's value would
 *      actually win in a real browser does not change the answer.
 *
 * WHAT GOES TO `unchecked` — NEVER SILENTLY DROPPED
 * -----------------------------------------------------
 * Matching this repository's other scanners (`@vespeneventures/copy`'s
 * `ScanResult.unchecked`, `@vespeneventures/strategy`'s parse-failure
 * handling): anything this reader recognizes as CSS-shaped but cannot
 * resolve is recorded, with a line number and detail, rather than being
 * quietly excluded from `declarations` with no trace:
 *
 *   - a `{` with no matching `}` before the relevant scope ends (an
 *     unterminated rule or grouping block);
 *   - trailing, non-whitespace content after the last recognizable rule,
 *     with no block at all (a stray selector, or truly malformed input);
 *   - inside a flat declaration body, any `--custom-property`-shaped token
 *     left over after every real `name: value;` pair has been matched and
 *     removed — e.g. `--broken-decl` with no colon, or a value that never
 *     finds a terminating `;` before the block's own end (which, for a
 *     value, cannot happen inside a body already isolated by matched
 *     braces — the one case this actually catches in practice is a
 *     malformed declaration missing its colon entirely);
 *   - an unterminated `/* ... *\/` comment — see
 *     `truncateAtUnterminatedComment`'s own doc comment for why this is
 *     load-bearing rather than cosmetic: everything from an unclosed `/*`
 *     to the end of the file is comment content in a real browser, so
 *     treating it as scannable CSS (the earlier version of this reader's
 *     actual bug) can silently report a slot as covered by a declaration
 *     the browser will never see at all.
 *
 * A file with ZERO declarations and ZERO unchecked entries (a genuinely
 * empty, comment-only, or rule-free CSS file) is not an error at the
 * reader level — `checkBrandFileCoverage` is where "zero declarations" earns
 * its own set of findings (see that file's header comment, "FAILS
 * CLOSED"), not here.
 */

import { readFileSync } from "node:fs";

/** One region of `declarations`-bearing CSS this reader recognized but could not resolve into a real declaration. Never silently dropped — see this file's header comment. */
export interface BrandCssUnchecked {
  /** 1-indexed line in the ORIGINAL source text (comment-stripping preserves line numbers exactly — see this file's header comment). */
  line: number;
  detail: string;
}

export interface ParsedBrandCss {
  /**
   * Every `--property` name found declared anywhere in the CSS, mapped to
   * its value text, trimmed. Last declaration wins for a property declared
   * more than once — see this file's header comment for why that
   * simplification is fine for this reader's purpose. An empty string is a
   * real, valid result for a value here (`--x: ;`) — `checkBrandFileCoverage`,
   * not this reader, decides what an empty value means for coverage.
   */
  declarations: Record<string, string>;
  unchecked: BrandCssUnchecked[];
}

/** Replaces every `/* ... *\/` comment's content with spaces, EXCEPT newlines, which are preserved — keeps every subsequent index/line number identical to the original source. */
function stripCommentsPreservingLines(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
}

/**
 * A properly-closed `/* ... *\/` comment is fully matched and blanked out by
 * `stripCommentsPreservingLines`'s regex above — the ONLY way a literal
 * `/*` can still be present afterward is a comment that never closes: the
 * regex is non-greedy up to the NEAREST following `*\/`, wherever it is in
 * the rest of the file, so if no `*\/` exists anywhere after some `/*`,
 * that `/*` is guaranteed unterminated, full stop — not merely "far from
 * its closing marker."
 *
 * A real browser has no such thing as an unterminated comment recovering
 * partway through a file: once `/*` opens with no matching `*\/`, EVERY
 * remaining byte of the stylesheet — every selector, every declaration,
 * every subsequent `}` — is comment content, silently discarded. The
 * earlier version of this reader got this exactly backwards: it treated
 * anything after an unclosed `/*` as ordinary, scannable CSS, which meant
 * a brand author who wrote `/* --color-surface-base: #fff;` and forgot
 * the closing `*\/` had that declaration extracted as LIVE — reported as
 * covered by `checkBrandFileCoverage` — when a real browser would ignore it
 * entirely. A checker reporting a slot as bound when the browser will
 * never apply it is a false PASS, the exact failure mode this package's
 * whole design brief exists to refuse.
 *
 * The fix: find the first `/*` still present after comment-stripping (by
 * the reasoning above, there can be at most one — everything from it to
 * the end of `cleaned` is unterminated-comment content), blank out
 * EVERYTHING from that point to the end of the text (preserving
 * newlines, exactly like a real comment would — see
 * `stripCommentsPreservingLines`), and report where it started. The
 * caller (`parseBrandDeclarations`) turns that into an `unchecked` entry,
 * so a run with an unterminated comment can never exit clean — see
 * `cli.ts`'s exit-code discipline.
 */
function truncateAtUnterminatedComment(cleaned: string): { text: string; unterminatedAt: number } {
  const idx = cleaned.indexOf("/*");
  if (idx === -1) return { text: cleaned, unterminatedAt: -1 };
  const truncated = cleaned.slice(0, idx) + cleaned.slice(idx).replace(/[^\n]/g, " ");
  return { text: truncated, unterminatedAt: idx };
}

/** 1-indexed line number of `index` within `text`. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

function snippetOf(text: string, max = 80): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Finds the next unquoted `{` at or after `from` (< `end`), skipping over `'...'`/`"..."` string content so a brace-shaped character inside a string is never mistaken for a block boundary. Returns `-1` if none is found. */
function findNextOpenBrace(text: string, from: number, end: number): number {
  let inQuote: string | null = null;
  for (let j = from; j < end; j++) {
    const ch = text[j];
    if (inQuote) {
      if (ch === "\\") {
        j++;
        continue;
      }
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === "{") return j;
  }
  return -1;
}

/** Finds the index of the `}` matching an already-consumed `{` (i.e. `from` is the index right after that `{`, at brace depth 1), quote-aware like `findNextOpenBrace`. Returns `-1` if the block never closes before `end`. */
function findMatchingCloseBrace(text: string, from: number, end: number): number {
  let depth = 1;
  let inQuote: string | null = null;
  for (let j = from; j < end; j++) {
    const ch = text[j];
    if (inQuote) {
      if (ch === "\\") {
        j++;
        continue;
      }
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** A grouping at-rule whose block contains NESTED rules, not declarations directly — the only shapes this reader recurses into. `@font-face`/`@keyframes`/any other at-rule (or an unrecognized one) is treated as a flat declaration body instead, matching how a plain selector is handled — see this file's header comment. */
const GROUPING_AT_RULE_RE = /^@(media|supports|layer)\b/i;

/** `--property: value;` (or a final declaration with no trailing `;`, terminated by the end of `body` instead). Value capture is non-greedy so it stops at the next real `;`, not the last one in the body. */
const DECLARATION_RE = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]*?)\s*(;|$)/g;

/** `--property`-shaped text left over in a flat body after every real declaration has been matched and blanked out — see `extractDeclarations`. */
const LEFTOVER_CUSTOM_PROPERTY_RE = /--[a-zA-Z][a-zA-Z0-9-]*/g;

/**
 * Scans a FLAT declaration body (already isolated between a non-grouping
 * selector's `{`/`}`) for `--property: value;` declarations, writing each
 * into `declarations` (last-wins) and recording any leftover
 * `--property`-shaped text that didn't parse as a complete declaration into
 * `unchecked`. `bodyStart` is `body`'s absolute offset into the ORIGINAL
 * source text (post comment-stripping, which preserves offsets — see this
 * file's header comment) — needed to report accurate line numbers for
 * `unchecked` entries found inside `body`.
 */
function extractDeclarations(
  originalText: string,
  bodyStart: number,
  body: string,
  declarations: Record<string, string>,
  unchecked: BrandCssUnchecked[],
): void {
  const residual = body.split("");
  DECLARATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DECLARATION_RE.exec(body)) !== null) {
    const [full, name, rawValue] = match as unknown as [string, string, string, string];
    declarations[name] = rawValue.trim();
    for (let k = match.index; k < match.index + full.length; k++) residual[k] = " ";
    // A zero-length match (theoretically possible if a future edit loosens
    // the value/terminator groups) would spin `exec` in place forever —
    // guard defensively, matching the same discipline
    // `@vespeneventures/copy`'s scanner uses around every `matchAll`/`exec`
    // loop over untrusted text.
    if (full.length === 0) DECLARATION_RE.lastIndex++;
  }

  const leftover = residual.join("");
  LEFTOVER_CUSTOM_PROPERTY_RE.lastIndex = 0;
  let leftoverMatch: RegExpExecArray | null;
  while ((leftoverMatch = LEFTOVER_CUSTOM_PROPERTY_RE.exec(leftover)) !== null) {
    unchecked.push({
      line: lineAt(originalText, bodyStart + leftoverMatch.index),
      detail: `found "${leftoverMatch[0]}" that does not parse as a complete "--name: value;" declaration`,
    });
  }
}

/**
 * Walks `text[start, end)` for top-level `selector { body }` blocks,
 * recursing into a grouping at-rule's body (see `GROUPING_AT_RULE_RE`) and
 * extracting declarations from every other block's body directly. Shared
 * by the initial top-level call and every recursive descent into a
 * `@media`/`@supports`/`@layer` block — the exact same logic applies at
 * any nesting depth, so this is the one function both cases call.
 */
function scanBlocks(
  originalText: string,
  start: number,
  end: number,
  declarations: Record<string, string>,
  unchecked: BrandCssUnchecked[],
): void {
  let i = start;
  while (i < end) {
    const braceIdx = findNextOpenBrace(originalText, i, end);
    if (braceIdx === -1) {
      const rest = originalText.slice(i, end);
      if (rest.trim().length > 0) {
        unchecked.push({
          line: lineAt(originalText, i),
          detail: `unrecognized content with no rule block following it: "${snippetOf(rest)}"`,
        });
      }
      return;
    }

    const selector = originalText.slice(i, braceIdx).trim();
    const bodyStart = braceIdx + 1;
    const closeIdx = findMatchingCloseBrace(originalText, bodyStart, end);

    if (closeIdx === -1) {
      unchecked.push({
        line: lineAt(originalText, braceIdx),
        detail: `selector "${snippetOf(selector) || "(empty)"}" opens with "{" but has no matching "}"`,
      });
      return; // cannot reliably resume scanning past an unterminated block
    }

    const body = originalText.slice(bodyStart, closeIdx);
    if (GROUPING_AT_RULE_RE.test(selector)) {
      scanBlocks(originalText, bodyStart, closeIdx, declarations, unchecked);
    } else {
      extractDeclarations(originalText, bodyStart, body, declarations, unchecked);
    }

    i = closeIdx + 1;
  }
}

/**
 * Parses `css` text for every custom-property declaration it contains, at
 * any selector, at any nesting depth inside a `@media`/`@supports`/
 * `@layer` grouping rule. Pure: no I/O, never throws — anything this
 * reader cannot resolve is recorded into the result's `unchecked` list
 * instead (see this file's header comment). Exported standalone (not only
 * via `readBrandCss`) so a caller that already has CSS text in hand — from
 * a bundler, a template string, a test fixture — never needs to write it
 * to a real file first just to parse it.
 */
export function parseBrandDeclarations(css: string): ParsedBrandCss {
  const commentsStripped = stripCommentsPreservingLines(css);
  const { text: cleaned, unterminatedAt } = truncateAtUnterminatedComment(commentsStripped);
  const declarations: Record<string, string> = {};
  const unchecked: BrandCssUnchecked[] = [];
  if (unterminatedAt !== -1) {
    unchecked.push({
      line: lineAt(cleaned, unterminatedAt),
      detail:
        `unterminated comment ("/*" with no matching "*/") — in a real browser, everything from here to the end of the file is comment content and does not exist; nothing after this point was scanned for declarations`,
    });
  }
  scanBlocks(cleaned, 0, cleaned.length, declarations, unchecked);
  return { declarations, unchecked };
}

/** Why `path` did not become a readable brand CSS file — see `readBrandCss`. */
export type BrandCssReadIssueReason = "unreadable";

export interface BrandCssReadIssue {
  reason: BrandCssReadIssueReason;
  detail: string;
}

export interface BrandCssReadResult {
  /** The path this result was read from, exactly as given. */
  path: string;
  declarations: Record<string, string>;
  unchecked: BrandCssUnchecked[];
  /** Empty means `path` was read successfully. Non-empty means `declarations`/`unchecked` are both `{}`/`[]` — see `BrandCssReadIssueReason`. */
  issues: BrandCssReadIssue[];
  /**
   * `true` exactly when `path` was read successfully — mirrors
   * `@vespeneventures/copy`'s `CopyRegistryReadResult.complete` and
   * `@vespeneventures/strategy`'s `StrategyBundle.complete`. Unlike those
   * two, `complete` here says nothing about whether every declaration in
   * the file was successfully classified — this reader never fails to
   * produce SOME result for readable text, it only ever accumulates
   * `unchecked` entries for the parts it could not resolve (the same
   * reason `@vespeneventures/copy`'s `ScanResult` keeps `unchecked` as its
   * own field rather than folding it into a boolean). A caller deciding
   * whether a read can be trusted as fully accounted for should check
   * BOTH `complete` and `unchecked.length === 0`, not `complete` alone —
   * `cli.ts` does exactly that.
   */
  complete: boolean;
}

/**
 * Reads and parses the brand CSS file at `path`. Never throws: an
 * unreadable file (missing, a directory, permission denied) is recorded
 * into `issues` and reflected in `.complete`, the same discipline
 * `@vespeneventures/copy`'s `readCopyRecord` and
 * `@vespeneventures/strategy`'s `readStrategy` hold to for their own I/O.
 */
export function readBrandCss(path: string): BrandCssReadResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return {
      path,
      declarations: {},
      unchecked: [],
      issues: [{ reason: "unreadable", detail: error instanceof Error ? error.message : String(error) }],
      complete: false,
    };
  }

  const { declarations, unchecked } = parseBrandDeclarations(raw);
  return { path, declarations, unchecked, issues: [], complete: true };
}
