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
 * ============================================================================
 * JSX TEXT NODES (`<span>Hello</span>`) — closing issue #37
 * ============================================================================
 *
 * String/template literals are only half of what a `.tsx`/`.jsx` file can
 * show a user: `<span>Hello</span>`'s `Hello` is neither, it is a raw JSX
 * TEXT NODE, and a scanner that only understands literal boundaries is
 * blind to it — a gate whose entire job is "no untracked user-facing
 * copy" would report a clean pass over a file that is nothing but
 * untracked copy. This is exactly what made this scanner's own top-level
 * risk real once a JSX-heavy consumer (`@vespeneventures/ui` in this same
 * repo) existed: see issue #37.
 *
 * The fix stays inside "no parser library": a second, JSX-aware pass
 * inside `tokenize()`, triggered only in a `.tsx`/`.jsx` file (`isJsxFile`
 * — a `.ts`/`.js` file is NEVER scanned for JSX at all, so this can never
 * fire on plain TypeScript/JavaScript). It is mutually recursive in the
 * same style `skipInterpolation`/`skipTemplateFrom` already use for
 * nested template interpolations:
 *
 *   - `tryScanJsxElement` recognizes a `<` as a JSX element start ONLY
 *     when the last significant token was in "expression start" position
 *     (the exact same `lastTokenType === "other"` heuristic already used
 *     for the regex-vs-division call above) AND the next character is a
 *     valid tag-name start or `>` (a fragment `<>`). This one condition
 *     is what keeps `Map<string, string>` (preceded by the identifier
 *     `Map`, a VALUE token) and `a < b` (preceded by the identifier `a`,
 *     also a VALUE token) from ever being mistaken for JSX — a generic
 *     type argument and a comparison are structurally "value `<` ...",
 *     never "other `<` ...". A string containing `>`/`<`
 *     (`"a > b < c"`) never reaches this logic at all: the EXISTING
 *     string-literal branch above already consumes the whole literal,
 *     `<`/`>` included, before this code ever sees those characters. A
 *     `/.../ ` regex literal is the same story via the EXISTING regex
 *     branch. Once a `<` is accepted as JSX-element-shaped, this function
 *     scans the tag name and its attributes (each attribute value —
 *     quoted string or `{expression}` — skipped correctly, reusing the
 *     same string-skip and a JSX-aware sibling of `skipInterpolation`)
 *     through to the tag's own closing `>`/`/>`. Only once that full,
 *     well-formed head is found is this function COMMITTED to "this is
 *     real JSX" — a `<` that turns out to be TSX's `<T,>(x: T) => x`
 *     generic-arrow-function syntax (which also starts as `< identifier`
 *     in "other" position) fails immediately inside the attribute list,
 *     before commitment, and is silently treated as not-JSX with no
 *     `unchecked` noise at all, precisely because that failure happens
 *     too early to be good evidence either way.
 *   - `scanJsxChildren` (only reached once committed) walks the raw text
 *     between the opening tag's `>` and the next `<`, recording each
 *     non-whitespace-only run as a text-node candidate (collapsed per
 *     JSX's own whitespace rule — see `collapseJsxWhitespace` — and
 *     entity-decoded — see `decodeJsxEntities`). A `<` found here can only
 *     be a nested element (recurses back into `tryScanJsxElement`,
 *     finding that element's OWN text nodes too — this is how
 *     `{condition && <Foo>text</Foo>}`-shaped nesting inside an
 *     expression child, and plain sibling nesting like
 *     `<p>Hello <strong>there</strong> friend</p>`, both resolve: each
 *     text run between element boundaries becomes its own candidate,
 *     never concatenated across the boundary, never dropping the tail) or
 *     a closing tag (ends this element, returns to whichever caller is
 *     scanning ITS OWN children/expression one level up). A `{` starts an
 *     expression child — `{/* a JSX comment *\/}` and `{expression}` are
 *     both skipped as CODE, not text (see "WHAT THIS STILL DELIBERATELY
 *     DOES NOT CATCH" below for the one exception), via the JSX-aware
 *     sibling of `skipInterpolation` mentioned above, which is itself
 *     mutually recursive with `tryScanJsxElement`: an expression child
 *     that itself contains nested JSX (`{items.map((i) => <li
 *     key={i}>{i}</li>)}`) is walked correctly, finding ITS nested text
 *     nodes too.
 *   - Purely whitespace text runs (indentation between sibling JSX tags —
 *     the overwhelming majority of raw text a real, formatted `.tsx` file
 *     contains) are dropped at the point of collection, not even entering
 *     the candidate/exclusion pipeline. This is the one deliberate
 *     departure from "count and report every exclusion, never silently
 *     drop": that discipline exists so a REAL, AUTHORED literal a
 *     developer chose to write is never quietly reclassified without a
 *     trace. Indentation whitespace between tags was never authored
 *     content in that sense — it is the ABSENCE of a text node, exactly
 *     as invisible to a real JSX runtime as it is to this scanner, and
 *     counting it would drown `printScanAccounting`'s exclusion tally in
 *     noise proportional to a file's formatting, not its copy. A text run
 *     that IS present but decorative/symbolic (a bare `"—"` as JSX text,
 *     the direct JSX-text analogue of exclusion #8 above) still goes
 *     through the same `no-letters` exclusion as a literal would, and is
 *     still counted. The enum/token-shaped heuristic (exclusion #9) is
 *     deliberately NOT applied to JSX text: that heuristic's entire
 *     justification is "a bare lowercase word is usually a component
 *     variant/size/state PROP VALUE" — a JSX TEXT NODE can never be a
 *     prop value by construction (children and props are different
 *     syntactic positions), so the justification does not transfer, and
 *     applying it anyway would risk silently dropping exactly the short,
 *     literal words real UI badges/labels use as visible copy (`"new"`,
 *     `"beta"`, `"live"`).
 *   - Entity decoding (`decodeJsxEntities`): the common named entities
 *     (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&nbsp;`, plus a
 *     small set of typographic entities real copy actually uses —
 *     `&mdash;`, `&ndash;`, `&hellip;`, `&copy;`, `&reg;`, `&trade;`,
 *     curly quotes) and every numeric entity (`&#8212;`, `&#x2014;`) are
 *     decoded before matching/reporting. DECODED, not "classified as
 *     unchecked": unlike a genuinely ambiguous JSX construct (see below),
 *     a named entity is a closed, enumerable vocabulary — there is no
 *     parsing risk in getting it right, only a coverage question, so this
 *     mirrors the file's own existing precedent for escape sequences (see
 *     "Full escape-sequence decoding" below): decode the common,
 *     essentially-total-coverage-in-practice set, and for a named entity
 *     outside that set, leave it verbatim (undecoded, `&whatever;`
 *     literally in the candidate's text) rather than either guessing or
 *     inventing a whole HTML entity table — an accepted, narrow
 *     simplification, not a silent one (documented here, exactly as the
 *     escape-sequence one is).
 *
 * WHAT THIS STILL DELIBERATELY DOES NOT CATCH, and why it is reported via
 * `ScanResult.unchecked` instead of silently producing nothing:
 *
 *   - Malformed/unbalanced JSX this scanner cannot resolve once it has
 *     already committed to "this is real JSX" — an opening tag with no
 *     matching closing tag before end of file, an attribute's quoted
 *     value or `{expression}` that never terminates, an expression child
 *     whose braces never balance, or JSX nesting deep enough to trip the
 *     `MAX_JSX_DEPTH` safety bound. Each of these is recorded as one
 *     `ScanResult.unchecked` entry (`kind` names the specific situation,
 *     `detail` is a human-readable explanation) rather than silently
 *     contributing zero candidates for that construct — the same
 *     "never silently narrow coverage" discipline `ParseFailure` already
 *     holds string/template literal tokenizing to, extended to the one
 *     new category (JSX) this version adds. `checkCopyTraceability` and
 *     `copy-check` (`cli.ts`) both surface a non-empty `unchecked` list —
 *     see their own doc comments for exactly where it lands in each
 *     one's contract.
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
  /** 1-indexed line the literal/text node starts on. */
  line: number;
  /** `"jsx-text"` is a raw JSX text node (`<span>Hello</span>`'s `Hello`) — see this file's top doc comment, "JSX TEXT NODES". Unlike `"string"`/`"template"`, it has no quote/backtick delimiters at all. */
  kind: "string" | "template" | "jsx-text";
  /**
   * Original source text, trimmed for display. For `"string"`/`"template"`,
   * includes the literal's own quotes/backticks. For `"jsx-text"`, there
   * are no delimiters to include — this is the JSX-whitespace-collapsed,
   * entity-decoded text itself (see `collapseJsxWhitespace`/
   * `decodeJsxEntities`).
   */
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

/**
 * One construct this scanner recognized as JSX-shaped but could not
 * reliably classify — an unclosed element, an unterminated attribute
 * value or expression, a nested expression child whose braces never
 * balanced, or JSX nesting deep enough to trip the depth safety bound.
 * See this file's top doc comment, "WHAT THIS STILL DELIBERATELY DOES
 * NOT CATCH". NEVER how a genuine blind spot gets to stay invisible: a
 * consumer that only checks `candidates`/`excluded` and ignores this
 * field would be exactly the failure mode issue #37 was about — a scan
 * that narrowed its own coverage and reported the narrowed result as a
 * pass. `checkCopyTraceability` (`copy-gate.ts`) and `copy-check`
 * (`cli.ts`) both refuse to let a non-empty list here go unreported.
 */
export interface UncheckedItem {
  file: string;
  line: number;
  /** A short, stable machine-readable name for the situation, e.g. `"unclosed-jsx-element"`, `"malformed-jsx-expression"`, `"malformed-jsx-tag"`, `"unrecognized-jsx-child"`, `"jsx-depth-exceeded"`. */
  kind: string;
  /** Human-readable explanation, for a report or a human auditing the list. */
  detail: string;
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
  /** Constructs the scanner recognized as JSX-shaped but could not classify — see `UncheckedItem`. Empty is the ordinary, expected outcome for a well-formed file; it is never emptied to make a report look cleaner than it is. */
  unchecked: UncheckedItem[];
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
    unchecked: [],
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
      result.unchecked.push(...extracted.unchecked);
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

/** One raw JSX text-node run, as found by `tokenize`'s JSX-aware pass — pre-collapse, pre-entity-decode. See `scanJsxChildren`. */
interface JsxTextRun {
  /** 1-indexed line this run's first character sits on. */
  line: number;
  raw: string;
}

/** One JSX-shaped construct `tokenize`'s JSX-aware pass could not resolve. Mirrors `UncheckedItem` minus `file`, which `extractCopyCandidates` attaches. */
interface RawUnchecked {
  line: number;
  kind: string;
  detail: string;
}

interface TokenizeResult {
  literals: Literal[];
  jsxTexts: JsxTextRun[];
  unchecked: RawUnchecked[];
  /** Set when the scanner could not reach a consistent end-of-file state (unterminated string/template/comment, or a regex heuristic that desynced quote tracking). */
  failure?: string;
}

/** Safety bound on JSX nesting depth `tryScanJsxElement`/`scanJsxChildren` will recurse through — real component trees never come close; this exists only to keep adversarial/malformed input from recursing unboundedly. Exceeding it is reported via `UncheckedItem`, never a crash or a silent truncation. */
const MAX_JSX_DEPTH = 200;

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
 * Tokenizes `content` for string/template literals, comments, regex
 * literals, and — when `isJsxFile` is true — JSX elements and their text
 * nodes, tracking just enough state to know where each real boundary is.
 * `isJsxFile` gates ALL JSX handling: a `.ts`/`.js` file (`isJsxFile ===
 * false`) runs through exactly the same literal/comment/regex logic this
 * function always had, completely unchanged, and can never produce a
 * `"jsx-text"` candidate or a JSX `UncheckedItem` — see this file's top
 * doc comment for the regex/division heuristic (reused, unmodified, to
 * decide `<` too) and its documented limitation.
 */
function tokenize(content: string, isJsxFile: boolean): TokenizeResult {
  const literals: Literal[] = [];
  const jsxTexts: JsxTextRun[] = [];
  const unchecked: RawUnchecked[] = [];
  const n = content.length;
  let i = 0;
  let line = 1;
  // 'value' means the last significant token could end an expression (so a
  // following `/` divides it, and a following `<` is a comparison/generic,
  // never JSX); 'other' means an expression is expected next (so a
  // following `/` starts a regex, and a following `<` MAY start JSX).
  let lastTokenType: "value" | "other" = "other";

  function advanceLine(from: number, to: number): void {
    for (let k = from; k < to; k++) if (content[k] === "\n") line++;
  }

  function pushUnchecked(atLine: number, kind: string, detail: string): void {
    unchecked.push({ line: atLine, kind, detail });
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

  /** Set by `scanStringLiteral`/`scanTemplateLiteral` immediately before either returns `-1` — the failure-message side channel a plain `number` return can't carry. Read by every caller right after a `-1` result. */
  let literalFailure: string | undefined;

  /**
   * Scans a plain string literal starting at `pos`
   * (`content[pos] === '"' | "'"`), pushes it to `literals`, and returns
   * the index one past its closing quote — or `-1` (with `literalFailure`
   * set) if unterminated. SHARED by the main loop and every JSX
   * attribute-value / expression-container path below (`tryScanJsxElement`,
   * `skipJsxExpressionContainer`) — this is deliberate, not incidental
   * reuse: a string literal found ANYWHERE in a `.tsx` file, whether it
   * is ordinary JS code or a JSX attribute value or an expression child,
   * must produce the exact same `Literal` shape and flow through
   * `extractCopyCandidates`'s existing classification exactly the same
   * way. `precedingAssignmentName`/`enclosingCallName`/`isInTypeContext`
   * all re-derive their answer from `content` and a literal's own
   * `start` index, independent of which code path found it, so this is
   * enough to keep e.g. `<Button aria-label="Previous page">`'s
   * `"Previous page"` correctly excluded as an aria value — exactly as
   * it was before this file understood JSX at all — rather than being
   * silently swallowed as opaque tag-head text the moment JSX-awareness
   * was added. (One accepted simplification: real JSX attribute strings
   * have no backslash-escape mechanism at all, unlike a JS string; this
   * function applies JS's escape rules everywhere, including inside a
   * JSX attribute. Indistinguishable in practice — nobody writes a
   * backslash immediately before the closing quote of a JSX attribute —
   * so not worth a second, JSX-specific string scanner.)
   */
  function scanStringLiteral(pos: number): number {
    const quote = content[pos] as string;
    const startLine = line;
    const start = pos;
    let j = pos + 1;
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
    if (!closed) {
      literalFailure = `unterminated string starting at line ${startLine}`;
      return -1;
    }
    literals.push({
      kind: "string",
      line: startLine,
      raw: content.slice(start, j),
      staticParts: [unescape(value)],
      placeholderCount: 0,
      start,
      end: j,
    });
    return j;
  }

  /**
   * Scans a template literal starting at `pos` (`content[pos] === "\`"`),
   * collecting its static text segments and delegating every
   * `${...}` interpolation to `skipInterpolation` — exactly like the
   * main loop's own former inline template handling, now shared with
   * `tryScanJsxElement`/`skipJsxExpressionContainer` for the identical
   * reason `scanStringLiteral` is shared (see its own doc comment).
   * Pushes a `Literal` and returns the index one past the closing
   * backtick, or `-1` (with `literalFailure` set) if unterminated. NOT
   * used for a template nested inside another template's own
   * interpolation — that case still goes through the non-collecting
   * `skipTemplateFrom` above, unchanged pre-existing behavior this
   * change does not touch (see that function's own doc comment).
   */
  function scanTemplateLiteral(pos: number): number {
    const startLine = line;
    const start = pos;
    const staticParts: string[] = [];
    let placeholderCount = 0;
    let j = pos + 1;
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
        // THIS interpolation's own `${`, not the enclosing template
        // literal's `startLine` — a multi-line template can carry the
        // `${` many lines past its own opening backtick, and a message
        // claiming "starting at line X" must report where the thing it
        // names actually starts.
        const interpolationStartLine = line;
        const next = skipInterpolation(j + 2);
        if (next === -1) {
          literalFailure = `unterminated \${...} interpolation starting at line ${interpolationStartLine}`;
          return -1;
        }
        j = next;
        continue;
      }
      if (cj === "\n") line++;
      current += cj;
      j++;
    }
    if (!closed) {
      literalFailure = `unterminated template literal starting at line ${startLine}`;
      return -1;
    }
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
    return j;
  }

  /**
   * Skips a JSX `{...}` container — a spread attribute (`{...props}`), an
   * attribute value (`name={expr}`), or a children expression
   * (`{expression}`, including a JSX comment `{/* ... *\/}`, which is
   * just a block comment that this function's own comment-skipping
   * already consumes as opaque text — no special case needed). `pos` is
   * the index right after the opening `{`. Brace-depth-aware and
   * string/template/comment-safe, exactly like `skipInterpolation`
   * above, with ONE addition: a `<` encountered here in expression-start
   * position may open a NESTED JSX element (`{condition && <Foo>text
   * </Foo>}` is an ordinary React pattern), resolved via
   * `tryScanJsxElement` — which is what makes this function and
   * `tryScanJsxElement`/`scanJsxChildren` mutually recursive, the same
   * shape `skipInterpolation`/`skipTemplateFrom` already use one level
   * up. Deliberately NOT a call to `skipInterpolation` itself: that
   * function has no JSX awareness (by design — a `${...}` template
   * interpolation containing JSX is exotic enough not to be worth
   * teaching it), so this is its own, JSX-aware sibling rather than a
   * shared implementation. Returns the index one past the matching `}`,
   * or `-1` if it never closes.
   */
  function skipJsxExpressionContainer(pos: number, depth: number): number {
    let braceDepth = 1;
    let j = pos;
    let localLast: "value" | "other" = "other";
    while (j < n && braceDepth > 0) {
      const cj = content[j] as string;
      if (cj === "\n") {
        line++;
        j++;
        continue;
      }
      if (cj === " " || cj === "\t" || cj === "\r") {
        j++;
        continue;
      }
      if (cj === "/" && content[j + 1] === "/") {
        const nl = content.indexOf("\n", j);
        j = nl === -1 ? n : nl;
        continue;
      }
      if (cj === "/" && content[j + 1] === "*") {
        const close = content.indexOf("*/", j + 2);
        if (close === -1) return -1;
        advanceLine(j, close + 2);
        j = close + 2;
        continue;
      }
      if (cj === '"' || cj === "'") {
        const end = scanStringLiteral(j);
        if (end === -1) return -1;
        j = end;
        localLast = "value";
        continue;
      }
      if (cj === "`") {
        const end = scanTemplateLiteral(j);
        if (end === -1) return -1;
        j = end;
        localLast = "value";
        continue;
      }
      if (cj === "<" && isJsxFile && localLast === "other") {
        const elEnd = tryScanJsxElement(j, depth + 1);
        if (elEnd !== null) {
          j = elEnd;
          localLast = "value";
          continue;
        }
        // Not JSX after all — fall through and treat `<` as an ordinary
        // operator character (comparison/generic), same as the top-level
        // loop does.
      }
      if (cj === "{") {
        braceDepth++;
        j++;
        localLast = "other";
        continue;
      }
      if (cj === "}") {
        braceDepth--;
        j++;
        localLast = "value";
        continue;
      }
      if (cj === "(" || cj === "[") {
        j++;
        localLast = "other";
        continue;
      }
      if (cj === ")" || cj === "]") {
        j++;
        localLast = "value";
        continue;
      }
      if (/[A-Za-z_$]/.test(cj)) {
        let k = j;
        while (k < n && /[A-Za-z0-9_$]/.test(content[k] as string)) k++;
        const word = content.slice(j, k);
        localLast = REGEX_PRECEDING_KEYWORDS.has(word) ? "other" : "value";
        j = k;
        continue;
      }
      if (/[0-9]/.test(cj)) {
        let k = j;
        while (k < n && /[0-9a-fA-Fx.]/.test(content[k] as string)) k++;
        j = k;
        localLast = "value";
        continue;
      }
      if (cj === "/") {
        if (localLast === "other") {
          const lineEnd = (() => {
            const nl = content.indexOf("\n", j);
            return nl === -1 ? n : nl;
          })();
          let k = j + 1;
          let inClass = false;
          let found = -1;
          while (k < lineEnd) {
            const ck = content[k] as string;
            if (ck === "\\") {
              k += 2;
              continue;
            }
            if (ck === "[") inClass = true;
            else if (ck === "]") inClass = false;
            else if (ck === "/" && !inClass) {
              found = k;
              break;
            }
            k++;
          }
          if (found !== -1) {
            let m = found + 1;
            while (m < n && /[a-z]/i.test(content[m] as string)) m++;
            j = m;
            localLast = "value";
            continue;
          }
        }
        localLast = "other";
        j++;
        continue;
      }
      localLast = "other";
      j++;
    }
    return braceDepth === 0 ? j : -1;
  }

  /**
   * Walks the raw text between a JSX opening tag's `>` and its matching
   * closing tag, starting at `pos` (the index right after that `>`).
   * `tagName` is used only for `unchecked` messages (`""` for a
   * fragment). Every non-whitespace-only run of plain text between
   * element/expression boundaries becomes one `jsxTexts` entry (still
   * raw — collapsing per JSX's whitespace rule and entity decoding
   * happen once in `extractCopyCandidates`, alongside every other
   * candidate's classification). A purely-whitespace run (ordinary
   * indentation between sibling tags) is dropped here, silently, on
   * purpose — see this file's top doc comment for why that is the one
   * deliberate exception to "never silently drop". Returns the index one
   * past the matching closing tag's `>`.
   */
  function scanJsxChildren(pos: number, tagName: string, depth: number, openLine: number): number {
    let j = pos;
    let runStart = j;
    let runStartLine = line;

    const flush = (): void => {
      if (j > runStart) {
        const raw = content.slice(runStart, j);
        if (raw.trim().length > 0) jsxTexts.push({ line: runStartLine, raw });
      }
    };

    while (j < n) {
      const cj = content[j] as string;
      if (cj === "<") {
        flush();
        if (content[j + 1] === "/") {
          let k = j + 2;
          while (k < n && content[k] !== ">") {
            if (content[k] === "\n") line++;
            k++;
          }
          if (k >= n) {
            // `openLine` — the line of THIS element's own opening `<`,
            // threaded in from `tryScanJsxElement` — not `runStartLine`
            // (wherever the last child text run happened to start,
            // which drifts arbitrarily far from the element's actual
            // start the more children it has). A message claiming a
            // position it did not compute is worse than no message.
            pushUnchecked(
              openLine,
              "unclosed-jsx-element",
              `"<${tagName}>" opened at line ${openLine} has no matching closing tag before end of file`,
            );
            return n;
          }
          return k + 1;
        }
        const nestedEnd = tryScanJsxElement(j, depth + 1);
        if (nestedEnd === null) {
          // A `<` inside an already-committed JSX children region can
          // only be a nested element or a closing tag by JSX's own
          // grammar — unlike the top-level case, there is no legitimate
          // "actually this was TypeScript, not JSX" explanation here, so
          // this genuinely is worth surfacing. `line` here is accurate —
          // `tryScanJsxElement` restores it to this exact position
          // before returning null (see its own `backtrack`) — so this
          // is the TRUE line of this `<`, not wherever its failed
          // attempt gave up.
          pushUnchecked(
            line,
            "unrecognized-jsx-child",
            `"<" at line ${line}, inside the children of "<${tagName}>", did not parse as a nested element or a closing tag`,
          );
          j++;
          runStart = j;
          runStartLine = line;
          continue;
        }
        j = nestedEnd;
        runStart = j;
        runStartLine = line;
        continue;
      }
      if (cj === "{") {
        flush();
        const exprStartLine = line; // THIS expression child's own `{`, not wherever the failed scan below gives up
        const end = skipJsxExpressionContainer(j + 1, depth);
        if (end === -1) {
          pushUnchecked(
            exprStartLine,
            "malformed-jsx-expression",
            `"{...}" expression child starting at line ${exprStartLine}, inside "<${tagName}>", never closed`,
          );
          return n;
        }
        j = end;
        runStart = j;
        runStartLine = line;
        continue;
      }
      if (cj === "\n") {
        line++;
        j++;
        continue;
      }
      j++;
    }
    // Reached EOF still inside this element's children — flush whatever
    // text was collected (this element WAS committed as real JSX, so that
    // text is trustworthy) and report the missing closing tag, at ITS
    // OWN opening line (`openLine`), not wherever the scan happened to
    // reach EOF.
    flush();
    pushUnchecked(
      openLine,
      "unclosed-jsx-element",
      `"<${tagName}>" opened at line ${openLine} has no matching closing tag before end of file`,
    );
    return n;
  }

  /**
   * Attempts to parse a JSX element (or fragment) starting at `pos`
   * (`content[pos] === "<"`). Returns `null` if this position does not
   * look like a valid JSX opening tag AT ALL — the caller (the main loop,
   * or `skipJsxExpressionContainer` for a nested element) then treats `<`
   * as an ordinary character and continues normal JS scanning from
   * `pos + 1`. This is what keeps TSX's generic-arrow-function syntax
   * (`` <T,>(x: T) => x ``, which also starts as `< identifier` in
   * expression-start position) from misfiring: it fails immediately,
   * inside the attribute list, before a valid `>`/`/>` was ever found —
   * BEFORE this function commits to "this is real JSX" — so it returns
   * `null` with no `unchecked` note at all. Once a complete, well-formed
   * opening-tag HEAD is found (a valid `>` or `/>`), this function is
   * committed: any failure from that point on (an unterminated attribute
   * value, an unclosed element) is real, reportable ambiguity, recorded
   * via `pushUnchecked` — see `scanJsxChildren` and the `pushUnchecked`
   * call sites below.
   *
   * BACKTRACKING IS STATEFUL, so `backtrack()` restores every bit of
   * shared state a failed attempt may have mutated before returning
   * `null` — `line`, plus the shared `literals`/`jsxTexts`/`unchecked`
   * arrays, truncated back to their lengths at entry. This matters for
   * two independent reasons, both found in review (see this package's
   * PR history for the concrete repro):
   *
   *   1. LINE NUMBERS. Once this function has consumed any whitespace
   *      containing a newline (or delegated to `skipJsxExpressionContainer`
   *      for an attribute value, which can span many lines), the shared
   *      `line` counter has advanced past this element's own start. A
   *      caller that reads `line` AFTER such a failure — to build an
   *      `unchecked` message, or because the caller (the main loop) is
   *      about to reprocess `pos + 1` onward as ordinary JS — would
   *      either report the WRONG line (the failure/give-up position, not
   *      the construct's actual start — the bug this comment exists to
   *      prevent from coming back) or DOUBLE-COUNT every newline this
   *      attempt already saw once (the main loop's own `\n` handling
   *      would increment `line` again for the exact same characters when
   *      it re-walks them from `pos + 1`), corrupting every subsequent
   *      line number for the REST OF THE FILE.
   *   2. DUPLICATE CANDIDATES. An attribute string/template value that
   *      parses successfully (via `scanStringLiteral`/
   *      `skipJsxExpressionContainer`) before a LATER attribute in the
   *      same tag fails pushes a real entry onto `literals`/`jsxTexts`.
   *      Backtracking without removing it, then letting the caller
   *      reprocess the same source text as ordinary JS, would rediscover
   *      that same literal a second time — a silent duplicate candidate.
   *
   * Restoring all four pieces of state makes "return null and let the
   * caller reprocess from `pos + 1`" fully safe regardless of how far
   * into a tag this function got before failing — the `unchecked` entry
   * for the failure itself is pushed AFTER `backtrack()` runs, so it
   * alone survives.
   */
  function tryScanJsxElement(pos: number, depth: number): number | null {
    const entryLine = line;
    const entryLiteralsCount = literals.length;
    const entryJsxTextsCount = jsxTexts.length;
    const entryUncheckedCount = unchecked.length;

    function backtrack(): null {
      line = entryLine;
      literals.length = entryLiteralsCount;
      jsxTexts.length = entryJsxTextsCount;
      unchecked.length = entryUncheckedCount;
      return null;
    }

    if (depth > MAX_JSX_DEPTH) {
      // backtrack() FIRST (a no-op here — nothing has been consumed yet
      // at this depth-exceeded check, which runs before any parsing —
      // but ordering it this way, identically to every other call site
      // below, means this can never again accidentally truncate its OWN
      // pushUnchecked call the way an earlier version of this fix did:
      // backtrack() resets `unchecked.length` to its value at function
      // entry, so pushing BEFORE calling it would silently erase the
      // very entry just pushed).
      backtrack();
      pushUnchecked(
        entryLine,
        "jsx-depth-exceeded",
        `JSX nesting exceeded ${MAX_JSX_DEPTH} levels near line ${entryLine} — scanning of this subtree was abandoned`,
      );
      return null;
    }

    let j = pos + 1;
    let isFragment = false;
    let tagName = "";
    if (content[j] === ">") {
      isFragment = true;
      j++;
    } else if (j < n && /[A-Za-z_$]/.test(content[j] as string)) {
      const start = j;
      while (j < n && /[A-Za-z0-9_$.:-]/.test(content[j] as string)) j++;
      tagName = content.slice(start, j);
    } else {
      return backtrack(); // `<=`, `< `, `<<`, a stray `<` — not JSX
    }

    let selfClosing = false;
    if (!isFragment) {
      for (;;) {
        while (j < n && /\s/.test(content[j] as string)) {
          if (content[j] === "\n") line++;
          j++;
        }
        if (j >= n) return backtrack(); // ran off the end before the head ever closed — not committed, silently not-JSX

        const cj = content[j] as string;
        if (cj === "/" && content[j + 1] === ">") {
          selfClosing = true;
          j += 2;
          break;
        }
        if (cj === ">") {
          j++;
          break;
        }
        if (cj === "{") {
          // spread attribute: {...expr}. `spreadStartLine` — THIS
          // attribute's own `{`, captured before the (possibly
          // multi-line) scan below — is what gets reported, never
          // wherever that scan gave up.
          const spreadStartLine = line;
          const end = skipJsxExpressionContainer(j + 1, depth);
          if (end === -1) {
            backtrack();
            pushUnchecked(
              spreadStartLine,
              "malformed-jsx-tag",
              `spread attribute on "<${tagName}>" starting at line ${spreadStartLine} never closed`,
            );
            return null;
          }
          j = end;
          continue;
        }
        if (/[A-Za-z_$]/.test(cj)) {
          while (j < n && /[A-Za-z0-9_$:-]/.test(content[j] as string)) j++;
          let k = j;
          while (k < n && /[ \t]/.test(content[k] as string)) k++;
          if (content[k] === "=") {
            k++;
            while (k < n && /\s/.test(content[k] as string)) {
              if (content[k] === "\n") line++;
              k++;
            }
            const vc = content[k];
            // `valueStartLine` — THIS attribute value's own opening
            // quote/`{`, not wherever a multi-line scan below gives up.
            const valueStartLine = line;
            if (vc === '"' || vc === "'") {
              // Scanned via `scanStringLiteral` (not skipped inline) so
              // this attribute value produces a real `Literal` — see
              // that function's doc comment for why: an attribute
              // string must flow through `extractCopyCandidates`'s
              // classification exactly like every other literal
              // (`aria-or-data-attribute-value`,
              // `denylisted-attribute-or-prop-value`, ...), never be
              // silently swallowed as opaque tag-head text.
              const end = scanStringLiteral(k);
              if (end === -1) {
                backtrack();
                pushUnchecked(
                  valueStartLine,
                  "malformed-jsx-tag",
                  `an attribute value on "<${tagName}>" starting at line ${valueStartLine} was never terminated`,
                );
                return null;
              }
              j = end;
            } else if (vc === "{") {
              const end = skipJsxExpressionContainer(k + 1, depth);
              if (end === -1) {
                backtrack();
                pushUnchecked(
                  valueStartLine,
                  "malformed-jsx-tag",
                  `an attribute expression value on "<${tagName}>" starting at line ${valueStartLine} never closed`,
                );
                return null;
              }
              j = end;
            } else {
              return backtrack(); // `name=` followed by neither a quote nor `{` — not valid JSX attribute syntax
            }
          } else {
            j = k; // boolean attribute, no value
          }
          continue;
        }
        return backtrack(); // e.g. the `,` in TSX's `<T,>(x: T) => x` — not committed, silently not-JSX
      }
    }

    if (selfClosing) return j;
    return scanJsxChildren(j, isFragment ? "" : tagName, depth, entryLine);
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
      if (close === -1) return { literals, jsxTexts, unchecked, failure: `unterminated block comment starting at line ${line}` };
      advanceLine(i, close + 2);
      i = close + 2;
      continue;
    }

    // string literal
    if (c === '"' || c === "'") {
      const end = scanStringLiteral(i);
      if (end === -1) return { literals, jsxTexts, unchecked, failure: literalFailure };
      lastTokenType = "value";
      i = end;
      continue;
    }

    // template literal
    if (c === "`") {
      const end = scanTemplateLiteral(i);
      if (end === -1) return { literals, jsxTexts, unchecked, failure: literalFailure };
      lastTokenType = "value";
      i = end;
      continue;
    }

    // possible JSX element start — see this file's top doc comment, "JSX
    // TEXT NODES". Gated on `isJsxFile` (a .ts/.js file never reaches
    // `tryScanJsxElement` at all) and on `lastTokenType === "other"` —
    // the exact same "expression expected next" heuristic the regex
    // branch below uses for `/`, which is what keeps `Map<string,
    // string>` and `a < b` (both preceded by an identifier, a VALUE
    // token) from ever being tried as JSX.
    if (c === "<") {
      if (isJsxFile && lastTokenType === "other") {
        const end = tryScanJsxElement(i, 0);
        if (end !== null) {
          i = end;
          lastTokenType = "value";
          continue;
        }
      }
      lastTokenType = "other";
      i++;
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

  return { literals, jsxTexts, unchecked };
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

// ----------------------------------------------------------- JSX text nodes

/**
 * Collapses a raw JSX text-node run onto JSX's own whitespace rule: each
 * line is trimmed, blank lines are dropped, and the remaining lines are
 * joined with a single space. For a single-line run (the common case —
 * `<p>Hello world</p>`) this is exactly `.trim()`. A multi-line run
 * (`<p>\n  Hello\n  world\n</p>`, which prettier produces routinely for
 * wrapped text) collapses to `"Hello world"` rather than keeping the
 * source's own indentation/newlines as if they were part of the copy —
 * matching what a real JSX runtime actually renders (Babel's
 * `cleanJSXElementLiteralChild`), not a byte-for-byte slice of the
 * source. A simplified version of that algorithm, not a byte-for-byte
 * port: real JSX also treats a tab specially and preserves a required
 * single space between some line pairs slightly differently. Good enough
 * for what this scanner needs it for (a stable, readable candidate
 * string to match/report), not a JSX-whitespace reference implementation.
 */
function collapseJsxWhitespace(raw: string): string {
  const lines = raw.split(/\r\n|\r|\n/);
  if (lines.length === 1) return (lines[0] as string).trim();
  return lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(" ");
}

/**
 * The common named HTML/JSX entities real UI copy actually uses, plus
 * every numeric entity (`&#8212;`, `&#x2014;`) — decoded before a JSX
 * text candidate's `raw`/`normalized` is built. See this file's top doc
 * comment, "JSX TEXT NODES", for why decoding (not `unchecked`) is the
 * right call here, and why a named entity outside this set is left
 * verbatim rather than guessed at.
 *
 * `nbsp` decodes to an ORDINARY space (U+0020), not the "real" non-
 * breaking space (U+00A0) — a deliberate departure from strict HTML
 * semantics, in favor of `checkCopyTraceability`'s matching working the
 * way a human registering copy would expect: a `CopyEntry.text` author
 * overwhelmingly writes a normal space, never literally types U+00A0,
 * and `&nbsp;` in JSX is almost always a rendering choice (keep two
 * words from wrapping), not a claim that the text itself differs. A
 * literal U+00A0 in the decoded candidate would silently make an
 * otherwise-correct registration fail to match on nothing but that one
 * invisible codepoint — exactly the kind of spurious finding this gate
 * exists to avoid, not manufacture.
 */
const NAMED_JSX_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ", // an ORDINARY space (U+0020) -- spelled out via escape, not a literal space character, precisely so this can never again silently regress to an actual U+00A0 the way this line once did (caught by this file own test suite, not by inspection)
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

const JSX_ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g;

function decodeJsxEntities(text: string): string {
  return text.replace(JSX_ENTITY_RE, (whole, body: string) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return whole;
    }
    return NAMED_JSX_ENTITIES[body] ?? whole; // unrecognized named entity — left verbatim, documented above
  });
}

interface ExtractResult {
  candidates: CopyCandidate[];
  excluded: ExcludedLiteral[];
  citations: Citation[];
  /** See `ScanResult.unchecked` — this is the per-file slice `scanCopySourceTree` aggregates into it. */
  unchecked: UncheckedItem[];
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

/** `.tsx`/`.jsx`, case-insensitive — the only extensions `tokenize` is ever asked to run its JSX-aware pass against. See this file's top doc comment, "JSX TEXT NODES". */
const JSX_FILE_RE = /\.(tsx|jsx)$/i;

/**
 * Pure — no I/O. Tokenizes `content` and classifies every string/template
 * literal AND (in a `.tsx`/`.jsx` file) every JSX text node found as
 * either a copy candidate or an excluded literal (with a stated reason),
 * per "THE BOUNDARY" in this file's top doc comment. Exported so a test
 * (or a future consumer wanting extraction without a real directory
 * walk) can exercise the classification logic directly against a
 * source-text fixture.
 */
export function extractCopyCandidates(content: string, filePath: string): ExtractResult {
  const isJsxFile = JSX_FILE_RE.test(filePath);
  const { literals, jsxTexts, unchecked: rawUnchecked, failure } = tokenize(content, isJsxFile);
  if (failure) return { candidates: [], excluded: [], citations: [], unchecked: [], parseFailure: failure };

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

  // JSX text nodes — same citation/ignore-marker attribution (by line) as
  // every literal candidate above, via the SAME `citationsByLine`/
  // `ignoreLines` maps. Only `no-letters` applies here, not the
  // enum/token-shaped heuristic — see this file's top doc comment, "JSX
  // TEXT NODES", for why that heuristic does not transfer to a text-node
  // position.
  for (const run of jsxTexts) {
    const text = decodeJsxEntities(collapseJsxWhitespace(run.raw));

    if (hasNoLetters(text)) {
      excluded.push({ file: filePath, line: run.line, raw: text, reason: "no-letters" });
      continue;
    }

    candidates.push({
      file: filePath,
      line: run.line,
      kind: "jsx-text",
      raw: text,
      normalized: text,
      placeholderCount: 0,
      citedIds: citationsByLine.get(run.line) ?? [],
      hasIgnoreMarker: ignoreLines.has(run.line),
    });
  }

  const unchecked: UncheckedItem[] = rawUnchecked.map((u) => ({ file: filePath, line: u.line, kind: u.kind, detail: u.detail }));

  return { candidates, excluded, citations, unchecked };
}
