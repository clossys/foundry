/**
 * `scanCopySourceTree` and `extractCopyCandidates` — the I/O half AND the
 * hard-analysis half of this gate, unlike the split `@vespeneventures/
 * strategy` draws between its own `scan.ts` (dumb directory walk) and
 * `facts-gate.ts` (the matchers). Here the walk is the easy part; finding
 * which string literals in a real source file are actually user-facing
 * copy — as opposed to a class name, an import specifier, an object key, a
 * `data-*`/`aria-*` attribute, an enum token, or a message meant for a
 * developer, not a user — is the genuinely hard problem, and it is a
 * problem about SOURCE TEXT, not about a file tree. So it lives here, next
 * to the walk that feeds it, and `copy-gate.ts` is left with the simpler
 * job: compare what this file found against a `CopyRecord` and report.
 *
 * NO PARSER LIBRARY — this repository's zero-runtime-dependency default for
 * every package here, `@vespeneventures/ui` (which wraps React) being the
 * one deliberate exception. What follows is a small hand-rolled character
 * scanner
 * that finds string/template literal BOUNDARIES correctly (the part that
 * is genuinely hard to get wrong-free with a regex: escaped quotes, nested
 * template interpolation, comments, and regex literals all look enough
 * like strings to confuse a naive `"[^"]*"` pattern), plus a set of
 * narrow, LOCAL, documented heuristics — never a full grammar — that look
 * at the raw text immediately around a literal to decide whether it is a
 * user-facing string. Every one of those heuristics is a real, stated
 * trade-off, not a black box: see "THE BOUNDARY" below for the full
 * reasoning, calibrated against real code in this same repository
 * (`packages/ui/src/blocks/Pagination.tsx`, `packages/ui/src/atoms/
 * Select.tsx`, `packages/ui/src/atoms/Table.tsx` — see each package's own
 * test fixtures, lifted near-verbatim from those three files).
 *
 * ============================================================================
 * THE BOUNDARY — what counts as a "copy candidate", and why
 * ============================================================================
 *
 * DEFAULT IS INCLUDE. A bare string or template literal used as a VALUE
 * (never a key, a specifier, or a type) is a copy candidate unless one of
 * the exclusions below applies. This is deliberate, not an oversight: this
 * package's own calibration example — `rangeSummary = "No results"` in
 * `Pagination.tsx` — is a plain literal assignment with NO special
 * surrounding syntax at all (no JSX attribute, no call argument, nothing
 * to allowlist against). A scanner that only fires inside a hand-picked
 * allowlist of "known copy positions" would silently miss exactly this
 * case, which is the single most common shape real UI copy actually takes
 * in this codebase. So the default has to be permissive, and the real work
 * is in a precise, narrow EXCLUDE list:
 *
 *   1. Import/export/require specifiers (`from "x"`, `import("x")`,
 *      `require("x")`) — a module path is an address, not copy.
 *   2. Object-literal / destructuring keys (`{ "some-key": value }`) —
 *      recognized as: the literal is immediately followed by `:`, AND its
 *      immediately preceding non-whitespace character is `{` or `,` (an
 *      object-literal position), AND that preceding character is NOT `?`
 *      (a ternary's `cond ? "a" : "b"` also has a literal immediately
 *      followed by `:`-shaped text further along, but the literal
 *      immediately BEFORE a ternary's `:` is preceded by `?`, never `{`/
 *      `,` — this distinction is exactly what keeps
 *      `totalItems === 0 ? "No results" : ...` — a real line from
 *      `Pagination.tsx` — correctly classified as copy, not a key).
 *   3. Values inside a `type` alias or `interface` body — TypeScript's own
 *      type language, never a runtime string a user sees.
 *   4. `aria-*` and `data-*` attribute/prop VALUES, in both JSX
 *      (`aria-label="Previous page"`) and camelCase-identifier form
 *      (`` "aria-label": ariaLabel = "Select all rows" ``, the exact shape
 *      `Table.tsx`'s `TableSelectAllCheckbox` uses). Stated explicitly,
 *      because it is the one exclusion most worth arguing with: an
 *      `aria-label` genuinely is read aloud to a screen-reader user, so it
 *      IS user-facing in the most literal sense. It is excluded anyway,
 *      for a scope reason, not a "doesn't matter" reason: this repository
 *      leans heavily on icon-only controls (`Pagination`'s prev/next
 *      buttons, `Table`'s row-selection checkboxes), each of which carries
 *      an `aria-label` as its ONLY accessible name. Registering those
 *      alongside visible copy would roughly double this gate's candidate
 *      volume on `packages/ui` alone, for a category (accessibility
 *      labels) that has a different owner, a different review cadence, and
 *      arguably needs a different check shape (e.g. "every icon-only
 *      control has SOME aria-label" is a presence check, not a
 *      traceability-to-copy check). Wiring accessibility labels into this
 *      gate is real, valid future scope — deliberately not this package's
 *      v1, the same way the icon-atom migration was deliberately excluded
 *      from its own PR. A denylisted attribute value is counted and
 *      reported (see `ExcludedLiteral`), never silently dropped.
 *   5. A fixed denylist of attribute/prop names that are structural, not
 *      textual, even though their values are strings: `className`, `class`,
 *      `id`, `key`, `htmlFor`, `role`, `type`, `rel`, `target`, `method`,
 *      `encType`, `autoComplete`, `inputMode`, `pattern`, `name`, `slot`,
 *      `variant`, `size`, `as`, `href`, `src`, `xmlns`, `viewBox`, `fill`,
 *      `stroke`, `d`, `strokeWidth`, `strokeLinecap`, `strokeLinejoin`,
 *      `testId`, `data-testid`. `className` is the canonical example this
 *      package's design brief calls out: a Tailwind utility string is not
 *      copy at all, in any sense.
 *   6. The literal-string argument list of a class-name BUILDER call —
 *      `cx(...)` (this repository's own helper, see
 *      `packages/ui/src/atoms/internal/cx.ts`), `clsx(...)`,
 *      `classNames(...)` — even a literal that ISN'T itself passed through
 *      a `className` prop can still be pure CSS-class text if it's an
 *      argument to one of these. Detected via a bounded backward paren-
 *      balance scan to find the nearest enclosing call's identifier — see
 *      `enclosingCallName`.
 *   7. The literal-string argument of a call this package treats as a
 *      developer diagnostic, not user copy: `console.log/warn/error/
 *      debug/info(...)`, `throw new Error(...)`, `assert(...)`,
 *      `invariant(...)`. The task brief's own words: "error messages meant
 *      for developers... look identical to a naive scanner" to real copy;
 *      this is the targeted fix for that specific confusion.
 *   8. Literals with no letters after trimming (`"…"`, `"‹"`, `"▾"`, a bare
 *      number or punctuation glyph) — decorative or symbolic, not
 *      language-bearing text a translator or copy reviewer would ever act
 *      on. `Pagination.tsx`'s `‹`/`›` ellipsis glyphs are exactly this
 *      case.
 *   9. A single lowercase "token" — no whitespace, matches
 *      `/^[a-z][a-z0-9-]*$/`, length <= 24 — is excluded under a heuristic
 *      reason (`enum-or-token-shaped`), NOT the type-context rule above:
 *      values like `"primary"`, `"ghost"`, `"sm"`, `"ascending"` are
 *      extremely common as component variant/size/state tokens passed as
 *      plain prop values (`<Button variant="ghost">`), a position this
 *      scanner's local-context heuristics cannot always trace back to a
 *      `type` declaration. Real visible copy in this codebase is, without
 *      exception in every example this task cites, EITHER multi-word
 *      ("No results", "Select an option", "Select all rows") OR starts
 *      with a capital letter ("Page", "Showing") — a bare, all-lowercase
 *      single word is a real, stated risk of a false NEGATIVE (a
 *      genuine one-word lowercase copy string, e.g. a placeholder
 *      literally `"search…"`, would be missed) traded deliberately against
 *      a much larger volume of false positives from variant tokens. Not
 *      silent: every such exclusion is counted and reported by reason.
 *  10. Files matching `*.test.ts(x)`, `*.spec.ts(x)`, or `*.check.ts(x)` —
 *      test fixtures and compile-time contract assertions are not shipped
 *      copy. This is a WHOLE-FILE skip, decided in `scanCopySourceTree`,
 *      not a per-literal exclusion — see `DEFAULT_SKIP_FILE_RE`.
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH, and why (mirroring
 * `@vespeneventures/strategy`'s `facts-gate.ts` doc comment, which states
 * its own non-goals the same way):
 *
 *   - Raw JSX TEXT NODES (`<span>Hello</span>` — the bare word `Hello`
 *     between tags, not inside any quote at all). This scanner only finds
 *     STRING and TEMPLATE LITERALS, because those have unambiguous lexical
 *     boundaries a character scanner can find reliably without a real JSX
 *     grammar; a text node's boundary is "wherever the surrounding markup
 *     says it is", which needs actual JSX parsing to get right in
 *     general. Every calibration example this task names —
 *     `Pagination.tsx`'s `rangeSummary` assignments, `Select.tsx`'s
 *     `"Select an option"` default, `Table.tsx`'s `"Select all rows"`/
 *     `"Select row"` defaults — is a string or template literal, not a
 *     bare JSX text node, so this is a real, currently-uncovered category,
 *     not a gap in THIS scan. A future version needs real JSX text-node
 *     handling to close it; tracked, not silently pretended away.
 *   - A fully general regex-vs-division disambiguation for `/`. This
 *     scanner uses the same last-significant-token heuristic every
 *     hand-rolled JS lexer uses (see `isRegexAllowedHere`), which is wrong
 *     on rare, contrived inputs (e.g. `/` immediately after a `)` that
 *     closed an `if` condition, when a regex was actually intended). If
 *     that heuristic ever desyncs the scanner badly enough that quote
 *     balance goes wrong by end of file, the file is reported as a PARSE
 *     FAILURE (see `ParseFailure`) and contributes zero candidates —
 *     never silently mis-scanned.
 *   - Full escape-sequence decoding (`\u{1F600}`, `\x41`, ...). Only the
 *     common cases (`\\`, `\'`, `\"`, `` \` ``, `\n`, `\r`, `\t`, `\$`) are
 *     unescaped for the `normalized`/`raw` text used in reporting and
 *     matching; anything else has its leading backslash stripped and the
 *     rest passed through verbatim. Reporting/matching text may therefore
 *     be very slightly off for a literal using an exotic escape — an
 *     accepted, narrow simplification, not a silent one (documented here).
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

/** `.test.ts(x)`, `.spec.ts(x)`, `.check.ts(x)`, and bare `.d.ts` — never shipped copy, see exclusion #10 and this file's top doc comment. */
const SKIP_FILE_RE = /\.(test|spec|check)\.(ts|tsx|js|jsx)$|\.d\.ts$/;

export interface CopyCandidate {
  /** Repo-relative, `/`-joined path this candidate was found in. */
  file: string;
  /** 1-indexed line the literal starts on. */
  line: number;
  kind: "string" | "template";
  /** Original source text of the literal, including its quotes/backticks, trimmed for display. */
  raw: string;
  /**
   * The literal's STATIC text with every interpolation (`${...}`)
   * collapsed to `PLACEHOLDER_SENTINEL` — identical to `raw`'s unescaped
   * content for a plain string (zero interpolations). This is what
   * `copy-gate.ts` compares against a `CopyEntry.text` normalized the same
   * way (its own `{name}` placeholders collapsed to the same sentinel) —
   * comparing SHAPE, never a specific placeholder name, since this
   * scanner has no way to know what name a `CopyEntry` author chose for
   * an interpolation this source expression computes some other way.
   */
  normalized: string;
  /** Number of `${...}` interpolations found (0 for a plain string). */
  placeholderCount: number;
  /**
   * Every `copy:<id>` citation found on this candidate's own source line
   * (see `CITATION_RE`) — `copy-gate.ts`'s escape hatch, mirroring
   * `@vespeneventures/strategy`'s `fact:<key>`. Whether any of these ids
   * actually exist in a real `CopyRecord` is `copy-gate.ts`'s question to
   * ask, not this scanner's — this scanner only reports what text is
   * literally present on the line.
   */
  citedIds: string[];
  /** Whether a `copy-gate:ignore` marker (see `IGNORE_MARKER_RE`) is present on this candidate's own source line. */
  hasIgnoreMarker: boolean;
}

/**
 * One `copy:<id>` citation found anywhere in a file, independent of
 * whether any candidate happens to share its line — mirrors
 * `@vespeneventures/strategy`'s `facts-gate.ts` Pass 1, which checks every
 * line for a `fact:<key>` citation regardless of whether that line also
 * carries a claim, so a citation to a rotted/misspelled id is caught even
 * when it sits on a line with no traceable literal at all (e.g. a stray
 * citation left behind after the copy it once annotated was deleted).
 */
export interface Citation {
  file: string;
  line: number;
  id: string;
}

// `copy:<id>` inside an HTML comment, a block comment, a JSX comment, or a
// line comment — deliberately loose about the closing delimiter (only the
// opener plus "copy:<id>" is required), mirroring
// `@vespeneventures/strategy`'s `FACT_CITATION_RE` so a stray missing
// `-->` doesn't silently defeat the citation. `id` allows the dots
// `CopyEntryId`'s shape requires (see `schema.ts`'s `COPY_ENTRY_ID_RE`),
// unlike a bare fact key.
const CITATION_RE = /(?:<!--|\/\*|\{\/\*|\/\/)\s*copy:([a-zA-Z0-9][a-zA-Z0-9.-]*)/g;
const IGNORE_MARKER_RE = /(?:<!--|\/\*|\{\/\*|\/\/)\s*copy-gate:ignore/i;

export type ExclusionReason =
  | "import-or-require-specifier"
  | "object-or-destructuring-key"
  | "type-or-interface-context"
  | "aria-or-data-attribute-value"
  | "denylisted-attribute-or-prop-value"
  | "classname-builder-argument"
  | "developer-diagnostic-argument"
  | "no-letters"
  | "enum-or-token-shaped";

export interface ExcludedLiteral {
  file: string;
  line: number;
  /** The literal's raw source text (quotes included), for a human auditing the exclusion list. */
  raw: string;
  reason: ExclusionReason;
}

export interface ParseFailure {
  file: string;
  /** Human-readable detail — an unterminated string/template/comment/regex, or the scanner ran off the end of the file in an inconsistent state. */
  detail: string;
}

export interface SkippedFile {
  file: string;
  reason: "test-or-check-file";
}

export interface ScanResult {
  /** Files whose content was successfully tokenized (whether or not it produced any candidates). This is the number `cli.ts` requires to be > 0 for a clean pass — see copy-gate.ts / cli.ts's exit-code discipline. */
  filesScanned: number;
  candidates: CopyCandidate[];
  /** Every literal this scanner found and deliberately excluded, with why — never silently dropped. See exclusions #1-#9 above. */
  excluded: ExcludedLiteral[];
  /** Every `copy:<id>` citation found anywhere in a scanned file — see `Citation`'s own doc comment for why this is file-wide, not just per-candidate. */
  citations: Citation[];
  /** Files matched by extension/walk but never tokenized at all — test/check/declaration files, by design (exclusion #10). Counted, never silent. */
  skippedByDesign: SkippedFile[];
  /** Files that were read but could not be reliably tokenized (unbalanced quote/comment/regex state at EOF) — contribute zero candidates. Counted, never silently treated as "0 findings". */
  parseFailures: ParseFailure[];
}

/**
 * Walks `root` recursively, reads every matching file, and extracts copy
 * candidates from each (see `extractCopyCandidates`). FAILS CLOSED on an
 * unreadable directory or file — throws a plain `Error`, matching
 * `@vespeneventures/strategy`'s `scanStrategyDirectory` and this
 * repository's own `scripts/check-contamination-classes.mjs` walker: a
 * directory this function could not read might be hiding an unknown,
 * unbounded amount of unregistered copy, and reporting "0 files scanned"
 * for that case would read as a clean pass when nothing was actually
 * verified. `cli.ts` is what turns this thrown error into exit code 2.
 */
export function scanCopySourceTree(root: string, options: ScanOptions = {}): ScanResult {
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
  const skipDirs = new Set(options.skipDirs ?? DEFAULT_SKIP_DIRS);

  const result: ScanResult = {
    filesScanned: 0,
    candidates: [],
    excluded: [],
    citations: [],
    skippedByDesign: [],
    parseFailures: [],
  };

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      throw new Error(
        `scanCopySourceTree: cannot read directory "${dir}": ${error instanceof Error ? error.message : String(error)}`,
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
          `scanCopySourceTree: cannot read file "${full}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const extracted = extractCopyCandidates(content, relPath);
      if (extracted.parseFailure) {
        result.parseFailures.push({ file: relPath, detail: extracted.parseFailure });
        continue; // no candidates trusted from a file we could not reliably tokenize
      }
      result.filesScanned++;
      result.candidates.push(...extracted.candidates);
      result.excluded.push(...extracted.excluded);
      result.citations.push(...extracted.citations);
    }
  }

  walk(root);
  return result;
}

// ------------------------------------------------------------- tokenizer

/**
 * Collapses every interpolation in a template literal's static text to one
 * comparable shape. `\uE000` is the first code point of the Unicode
 * Private Use Area — reserved by the standard for exactly this kind of
 * private, non-textual sentinel use, and something no legitimate JS/TS
 * source file authoring real UI copy will ever contain, so it can be
 * dropped in without risk of colliding with genuine copy text (unlike,
 * say, a literal space or `{}`, which real copy could plausibly contain).
 * Exported so `copy-gate.ts` normalizes `CopyEntry.text`'s `{name}`
 * placeholders to this exact same sentinel before comparing shapes.
 */
export const PLACEHOLDER_SENTINEL = "\uE000";

interface Literal {
  kind: "string" | "template";
  line: number;
  raw: string;
  staticParts: string[];
  placeholderCount: number;
  /** Index into `content` where this literal's opening quote/backtick sits — used for local-context classification. */
  start: number;
  /** Index one past this literal's closing quote/backtick. */
  end: number;
}

interface TokenizeResult {
  literals: Literal[];
  /** Set when the scanner could not reach a consistent end-of-file state (unterminated string/template/comment, or a regex heuristic that desynced quote tracking). */
  failure?: string;
}

const UNESCAPE_MAP: Record<string, string> = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  "`": "`",
  n: "\n",
  r: "\r",
  t: "\t",
  $: "$",
};

function unescape(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as string;
    if (c === "\\" && i + 1 < raw.length) {
      const next = raw[i + 1] as string;
      out += next in UNESCAPE_MAP ? UNESCAPE_MAP[next] : next;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

/** Keywords after which `/` cannot be a division operator — an expression is expected next, so `/` starts a regex. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

/**
 * Tokenizes `content` for string/template literals, comments, and regex
 * literals, tracking just enough state to know where each real string
 * boundary is. See this file's top doc comment for the regex/division
 * heuristic and its documented limitation.
 */
function tokenize(content: string): TokenizeResult {
  const literals: Literal[] = [];
  const n = content.length;
  let i = 0;
  let line = 1;
  // 'value' means the last significant token could end an expression (so a
  // following `/` divides it); 'other' means an expression is expected next
  // (so a following `/` starts a regex).
  let lastTokenType: "value" | "other" = "other";

  function advanceLine(from: number, to: number): void {
    for (let k = from; k < to; k++) if (content[k] === "\n") line++;
  }

  /**
   * Skips a `${...}` interpolation body, starting right after its opening
   * `${` (i.e. `pos` is the first character of the expression, not the
   * `$` or `{` themselves). Returns the index one past the matching `}`,
   * or `-1` if it never closes. Brace-depth-aware, and recurses into
   * `skipTemplateFrom` for a template literal nested inside the
   * expression (`` `outer ${`inner`}` ``) and handles a plain `'...'`/
   * `"..."` string and `//`/`/* *\/` comments inline — none of which can
   * prematurely close the interpolation just because they happen to
   * contain a `}` character. Mutually recursive with `skipTemplateFrom`
   * so an arbitrarily deep nesting of templates-within-interpolations
   * resolves correctly without ever re-tokenizing content this function
   * has already accounted for (the earlier, buggier version of this
   * function did that — see this file's history — by recursively calling
   * the OUTER `tokenize` on the remaining file text, which re-scanned
   * everything after the nested template as if it were a fresh file and
   * could misinterpret the true template's own closing backtick as a new
   * template's opening one).
   */
  function skipInterpolation(pos: number): number {
    let depth = 1;
    let j = pos;
    while (j < n && depth > 0) {
      const ck = content[j] as string;
      if (ck === "\n") {
        line++;
        j++;
        continue;
      }
      if (ck === "{") {
        depth++;
        j++;
        continue;
      }
      if (ck === "}") {
        depth--;
        j++;
        continue;
      }
      if (ck === '"' || ck === "'") {
        const q = ck;
        j++;
        while (j < n && content[j] !== q) {
          if (content[j] === "\\") j++;
          if (content[j] === "\n") line++;
          j++;
        }
        j++; // consume closing quote, or run past EOF — caught by the outer unterminated-template check
        continue;
      }
      if (ck === "`") {
        const next = skipTemplateFrom(j);
        if (next === -1) return -1;
        j = next;
        continue;
      }
      if (ck === "/" && content[j + 1] === "/") {
        const nl = content.indexOf("\n", j);
        j = nl === -1 ? n : nl;
        continue;
      }
      if (ck === "/" && content[j + 1] === "*") {
        const close = content.indexOf("*/", j + 2);
        if (close === -1) return -1;
        advanceLine(j, close + 2);
        j = close + 2;
        continue;
      }
      j++;
    }
    return depth === 0 ? j : -1;
  }

  /** Skips an entire template literal starting at `pos` (`content[pos] === "\`"`), including every interpolation it contains, recursively. Returns the index one past its closing backtick, or `-1` if unterminated. */
  function skipTemplateFrom(pos: number): number {
    let j = pos + 1;
    while (j < n) {
      const cj = content[j] as string;
      if (cj === "\\" && j + 1 < n) {
        j += 2;
        continue;
      }
      if (cj === "`") return j + 1;
      if (cj === "\n") {
        line++;
        j++;
        continue;
      }
      if (cj === "$" && content[j + 1] === "{") {
        const next = skipInterpolation(j + 2);
        if (next === -1) return -1;
        j = next;
        continue;
      }
      j++;
    }
    return -1;
  }

  while (i < n) {
    const c = content[i] as string;

    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }

    // line comment
    if (c === "/" && content[i + 1] === "/") {
      const nl = content.indexOf("\n", i);
      i = nl === -1 ? n : nl;
      continue;
    }

    // block comment
    if (c === "/" && content[i + 1] === "*") {
      const close = content.indexOf("*/", i + 2);
      if (close === -1) return { literals, failure: `unterminated block comment starting at line ${line}` };
      advanceLine(i, close + 2);
      i = close + 2;
      continue;
    }

    // string literal
    if (c === '"' || c === "'") {
      const quote = c;
      const startLine = line;
      const start = i;
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < n) {
        const cj = content[j] as string;
        if (cj === "\\" && j + 1 < n) {
          value += cj + content[j + 1];
          j += 2;
          continue;
        }
        if (cj === quote) {
          closed = true;
          j++;
          break;
        }
        if (cj === "\n") break; // unterminated on this line — a real JS/JSX string never spans a raw newline
        value += cj;
        j++;
      }
      if (!closed) return { literals, failure: `unterminated string starting at line ${startLine}` };
      literals.push({
        kind: "string",
        line: startLine,
        raw: content.slice(start, j),
        staticParts: [unescape(value)],
        placeholderCount: 0,
        start,
        end: j,
      });
      lastTokenType = "value";
      i = j;
      continue;
    }

    // template literal — collects the literal's own STATIC text segments
    // (what `PLACEHOLDER_SENTINEL`-joins into `normalized`) while
    // delegating every `${...}` interpolation to `skipInterpolation`,
    // which is what actually handles nested strings/templates/comments
    // inside the interpolation without them prematurely closing it.
    if (c === "`") {
      const startLine = line;
      const start = i;
      const staticParts: string[] = [];
      let placeholderCount = 0;
      let j = i + 1;
      let current = "";
      let closed = false;
      while (j < n) {
        const cj = content[j] as string;
        if (cj === "\\" && j + 1 < n) {
          current += cj + content[j + 1];
          j += 2;
          continue;
        }
        if (cj === "`") {
          closed = true;
          j++;
          break;
        }
        if (cj === "$" && content[j + 1] === "{") {
          staticParts.push(unescape(current));
          current = "";
          placeholderCount++;
          const next = skipInterpolation(j + 2);
          if (next === -1) return { literals, failure: `unterminated \${...} interpolation starting at line ${startLine}` };
          j = next;
          continue;
        }
        if (cj === "\n") line++;
        current += cj;
        j++;
      }
      if (!closed) return { literals, failure: `unterminated template literal starting at line ${startLine}` };
      staticParts.push(unescape(current));
      literals.push({
        kind: "template",
        line: startLine,
        raw: content.slice(start, j),
        staticParts,
        placeholderCount,
        start,
        end: j,
      });
      lastTokenType = "value";
      i = j;
      continue;
    }

    // possible regex literal
    if (c === "/") {
      const regexAllowed = lastTokenType === "other";
      if (regexAllowed) {
        // Regex literals never contain a raw newline — bounded to the
        // current line. If no closing `/` is found before the line ends,
        // this wasn't a regex after all; fall through and treat `/` as a
        // single punctuation character instead of failing the whole file.
        const lineEnd = (() => {
          const nl = content.indexOf("\n", i);
          return nl === -1 ? n : nl;
        })();
        let j = i + 1;
        let inClass = false;
        let found = -1;
        while (j < lineEnd) {
          const cj = content[j] as string;
          if (cj === "\\") {
            j += 2;
            continue;
          }
          if (cj === "[") inClass = true;
          else if (cj === "]") inClass = false;
          else if (cj === "/" && !inClass) {
            found = j;
            break;
          }
          j++;
        }
        if (found !== -1) {
          let k = found + 1;
          while (k < n && /[a-z]/i.test(content[k] as string)) k++;
          i = k;
          lastTokenType = "value";
          continue;
        }
        // not a regex — fall through
      }
      lastTokenType = "other";
      i++;
      continue;
    }

    // identifiers / keywords — only tracked to feed the regex heuristic
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(content[j] as string)) j++;
      const word = content.slice(i, j);
      lastTokenType = REGEX_PRECEDING_KEYWORDS.has(word) ? "other" : "value";
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9a-fA-Fx.]/.test(content[j] as string)) j++;
      i = j;
      lastTokenType = "value";
      continue;
    }

    if (c === ")" || c === "]") {
      lastTokenType = "value";
      i++;
      continue;
    }
    // `}` is ambiguous (block end vs. object-literal end); treat as
    // "other" (regex allowed after) — the more common case for a `}` that
    // precedes more code is a closed block, not an object literal used as
    // a value. Documented limitation, see this file's top doc comment.
    lastTokenType = "other";
    i++;
  }

  return { literals };
}

// ---------------------------------------------------------- classification

const ARIA_DATA_ATTR_RE = /^(aria|data)[-A-Z]/i;

const DENYLISTED_ATTRS = new Set(
  [
    "classname", "class", "id", "key", "htmlfor", "role", "type", "rel", "target", "method", "enctype",
    "autocomplete", "inputmode", "pattern", "name", "slot", "variant", "size", "as", "href", "src", "xmlns",
    "viewbox", "fill", "stroke", "d", "strokewidth", "strokelinecap", "strokelinejoin", "testid", "datatestid",
  ].map((s) => s.replace(/-/g, "")),
);

const CLASSNAME_BUILDER_CALLS = new Set(["cx", "clsx", "classnames"]);
const DIAGNOSTIC_CALLS = new Set(["log", "warn", "error", "debug", "info", "assert", "invariant", "Error"]);

/** Converts `ariaLabel` -> `arialabel`, `aria-label` -> `arialabel`, for a single case/hyphen-insensitive comparison. */
function normalizeIdentifier(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/-/g, "");
}

/** Finds the identifier immediately before the nearest unmatched `(` enclosing `pos`, bounded to avoid an unbounded backward scan on a huge file. */
function enclosingCallName(content: string, pos: number): string | undefined {
  let depth = 0;
  const floor = Math.max(0, pos - 2000);
  for (let j = pos - 1; j >= floor; j--) {
    const ch = content[j] as string;
    if (ch === ")") {
      depth++;
      continue;
    }
    if (ch === "(") {
      if (depth === 0) {
        let k = j - 1;
        while (k >= 0 && /\s/.test(content[k] as string)) k--;
        const end = k + 1;
        while (k >= 0 && /[A-Za-z0-9_$.]/.test(content[k] as string)) k--;
        const name = content.slice(k + 1, end);
        const parts = name.split(".");
        return parts[parts.length - 1] || undefined;
      }
      depth--;
      continue;
    }
  }
  return undefined;
}

/** The identifier/attribute name immediately before `pos` in a `name=` or `name: ` position, or `undefined` if none is found within a short lookback. */
function precedingAssignmentName(content: string, pos: number): string | undefined {
  const from = Math.max(0, pos - 80);
  const before = content.slice(from, pos);
  const m = /([A-Za-z_$][A-Za-z0-9_$-]*)\s*(?::|=)\s*\{?\s*$/.exec(before);
  return m?.[1];
}

/**
 * Whether `pos` (a literal's start index) sits inside a `type X = ...;` or
 * `interface X ... { ... }` declaration — a rough, line-bounded scan, not
 * a real parser; see this file's top doc comment. An `interface`'s HERITAGE
 * clause (`interface Foo extends Omit<Bar, "className" | "style"> { ... }`)
 * counts as type context too, not just the body between `{`/`}` — a real,
 * common pattern in this repository's own `packages/ui` (every block/atom
 * that extends `Omit<SomeAriaProps, "className" | "children" | ...>`), and
 * missing it was a real bug this scanner's own calibration run against
 * `Pagination.tsx`/`Table.tsx` caught: `"onChange"`, `"className"`,
 * `"style"`, and `"children"` were all initially misreported as copy
 * candidates because they sit BEFORE the interface's opening `{`.
 */
function isInTypeContext(content: string, pos: number): boolean {
  // interface: find the nearest preceding `interface` keyword whose `{`
  // has not yet been closed by `pos` — the type-context region runs from
  // the keyword itself (covering the heritage clause) through that `}`.
  const before = content.slice(0, pos);
  let idx = before.lastIndexOf("interface ");
  while (idx !== -1) {
    const braceOpen = content.indexOf("{", idx);
    if (braceOpen !== -1) {
      if (pos >= idx && pos < braceOpen) return true; // heritage/generic clause, before the body opens
      if (pos >= braceOpen) {
        let depth = 1;
        let k = braceOpen + 1;
        while (k < content.length && depth > 0) {
          if (content[k] === "{") depth++;
          else if (content[k] === "}") depth--;
          k++;
        }
        if (pos < k) return true;
      }
    }
    idx = before.lastIndexOf("interface ", idx - 1);
  }
  // type alias: find the nearest preceding `type X =` whose terminating
  // top-level `;` has not yet been reached by `pos`.
  const typeRe = /\btype\s+[A-Za-z_$][A-Za-z0-9_$]*(<[^=]*>)?\s*=/g;
  let match: RegExpExecArray | null;
  let lastStart = -1;
  let lastEqEnd = -1;
  while ((match = typeRe.exec(before))) {
    lastStart = match.index;
    lastEqEnd = match.index + match[0].length;
  }
  if (lastStart !== -1 && lastEqEnd <= pos) {
    let depth = 0;
    let k = lastEqEnd;
    let terminator = -1;
    while (k < content.length) {
      const ck = content[k] as string;
      if (ck === "(" || ck === "[" || ck === "{" || ck === "<") depth++;
      else if (ck === ")" || ck === "]" || ck === "}" || ck === ">") depth--;
      else if (ck === ";" && depth <= 0) {
        terminator = k;
        break;
      }
      k++;
    }
    const end = terminator === -1 ? lastEqEnd + 2000 : terminator;
    if (pos >= lastStart && pos < end) return true;
  }
  return false;
}

function hasNoLetters(text: string): boolean {
  return !/\p{L}/u.test(text.trim());
}

const ENUM_TOKEN_RE = /^[a-z][a-z0-9-]*$/;

function isEnumOrTokenShaped(text: string): boolean {
  return text.length > 0 && text.length <= 24 && !/\s/.test(text) && ENUM_TOKEN_RE.test(text);
}

interface ExtractResult {
  candidates: CopyCandidate[];
  excluded: ExcludedLiteral[];
  citations: Citation[];
  parseFailure?: string;
}

/**
 * Every `copy:<id>` citation and every `copy-gate:ignore` marker in
 * `content`, keyed by 1-indexed line number. A plain raw-line regex scan —
 * deliberately NOT tokenizer-aware, mirroring
 * `@vespeneventures/strategy`'s `facts-gate.ts`, which scans every line
 * for `fact:<key>`/`facts-gate:ignore` regardless of fence/comment state.
 * A citation only makes sense written inside a comment by construction
 * (the regex itself requires a comment-opening delimiter immediately
 * before it), so there is nothing a real tokenizer pass would add here
 * that a line scan doesn't already get right.
 */
function scanLineMarkers(content: string, filePath: string): { citations: Citation[]; ignoreLines: Set<number> } {
  const citations: Citation[] = [];
  const ignoreLines = new Set<number>();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    for (const m of line.matchAll(CITATION_RE)) {
      citations.push({ file: filePath, line: i + 1, id: m[1] as string });
    }
    if (IGNORE_MARKER_RE.test(line)) ignoreLines.add(i + 1);
  }
  return { citations, ignoreLines };
}

/**
 * Pure — no I/O. Tokenizes `content` and classifies every string/template
 * literal found as either a copy candidate or an excluded literal (with a
 * stated reason), per "THE BOUNDARY" in this file's top doc comment.
 * Exported so a test (or a future consumer wanting extraction without a
 * real directory walk) can exercise the classification logic directly
 * against a source-text fixture.
 */
export function extractCopyCandidates(content: string, filePath: string): ExtractResult {
  const { literals, failure } = tokenize(content);
  if (failure) return { candidates: [], excluded: [], citations: [], parseFailure: failure };

  const { citations, ignoreLines } = scanLineMarkers(content, filePath);
  const citationsByLine = new Map<number, string[]>();
  for (const c of citations) {
    const list = citationsByLine.get(c.line);
    if (list) list.push(c.id);
    else citationsByLine.set(c.line, [c.id]);
  }

  const candidates: CopyCandidate[] = [];
  const excluded: ExcludedLiteral[] = [];

  for (const lit of literals) {
    const raw = lit.raw;
    const normalized = lit.staticParts.join(PLACEHOLDER_SENTINEL);
    const fullText = lit.staticParts.join(""); // for shape checks (letters/enum-shape) — placeholders don't count as "the text"

    const before = content.slice(Math.max(0, lit.start - 80), lit.start);
    const afterStart = lit.end;
    const after = content.slice(afterStart, Math.min(content.length, afterStart + 20));

    const exclude = (reason: ExclusionReason): void => {
      excluded.push({ file: filePath, line: lit.line, raw, reason });
    };

    // 1. import/export/require specifier
    if (/\bfrom\s*$/.test(before) || /\brequire\s*\(\s*$/.test(before) || /\bimport\s*\(\s*$/.test(before)) {
      exclude("import-or-require-specifier");
      continue;
    }

    // 2. object-literal / destructuring key. Requiring the PRECEDING
    // character to be `{`/`,` (an object-literal position) — rather than
    // just checking "is this literal followed by `:`" — is exactly what
    // keeps a ternary correctly classified as copy: in
    // `totalItems === 0 ? "No results" : ...` (a real line from
    // `Pagination.tsx`), "No results" IS followed by `:`, but its
    // preceding character is `?`, not `{`/`,`, so it never reaches this
    // branch. A ternary's FALSE branch (preceded by `:`, not `{`/`,`)
    // is excluded from this branch the same way.
    const precedingNonWs = [...before].reverse().find((ch) => !/\s/.test(ch));
    const followsWithColon = /^\s*:/.test(after);
    if (followsWithColon && (precedingNonWs === "{" || precedingNonWs === ",")) {
      exclude("object-or-destructuring-key");
      continue;
    }

    // 3. type/interface context
    if (isInTypeContext(content, lit.start)) {
      exclude("type-or-interface-context");
      continue;
    }

    // 4/5. attribute/prop name immediately before this literal
    const attrName = precedingAssignmentName(content, lit.start);
    if (attrName !== undefined) {
      const normalizedAttr = normalizeIdentifier(attrName);
      if (ARIA_DATA_ATTR_RE.test(attrName)) {
        exclude("aria-or-data-attribute-value");
        continue;
      }
      if (DENYLISTED_ATTRS.has(normalizedAttr)) {
        exclude("denylisted-attribute-or-prop-value");
        continue;
      }
    }

    // 6/7. enclosing call name — classname builder or developer diagnostic
    const callName = enclosingCallName(content, lit.start);
    if (callName !== undefined) {
      if (CLASSNAME_BUILDER_CALLS.has(callName.toLowerCase())) {
        exclude("classname-builder-argument");
        continue;
      }
      if (DIAGNOSTIC_CALLS.has(callName)) {
        exclude("developer-diagnostic-argument");
        continue;
      }
    }

    // 8. no letters at all — decorative/symbolic
    if (hasNoLetters(fullText)) {
      exclude("no-letters");
      continue;
    }

    // 9. bare lowercase single-token — likely a variant/size/state enum value
    if (isEnumOrTokenShaped(fullText)) {
      exclude("enum-or-token-shaped");
      continue;
    }

    candidates.push({
      file: filePath,
      line: lit.line,
      kind: lit.kind,
      raw: raw.length > 200 ? `${raw.slice(0, 200)}…` : raw,
      normalized,
      placeholderCount: lit.placeholderCount,
      citedIds: citationsByLine.get(lit.line) ?? [],
      hasIgnoreMarker: ignoreLines.has(lit.line),
    });
  }

  return { candidates, excluded, citations };
}
