import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { __unstable__loadDesignSystem } from "tailwindcss";
import { declaredTokenValues } from "../compiled-css/declared-fallbacks.js";
import { compiledCssDeclaredSources } from "../compiled-css/generate.js";
import { TOKENS } from "../tokens/index.js";

/**
 * The highest-value test in this package (see the README's "Tests"
 * section). Every component, block, AND shell component styles with Tailwind
 * classes generated from this package's token layer, and separately with a
 * handful of raw `var(--ui-*)` reads for tokens that have no Tailwind
 * namespace. Neither of those is checked by TypeScript — a class name and a
 * `var()` argument are both just strings to the compiler. A typo like
 * `bg-surface-elevated` (no such token; the real name is `surface-raised`)
 * would compile clean, render with zero applied background, and produce no
 * error anywhere — this is the only thing that catches it.
 *
 * ── WHY THIS FILE WAS REDESIGNED ──────────────────────────────────────
 *
 * The previous version of this file was a hand-maintained regex: it matched
 * `\b(prefix)-(suffix)\b` for a fixed list of prefixes it knew were
 * token-derived (`bg-`, `text-`, `border-`, `rounded-`, ...), then checked
 * `suffix` against this package's `TOKENS` export. Anything
 * that wasn't a token — including Tailwind's OWN built-in vocabulary that
 * happens to share a prefix with a token family — had to be hand-enumerated
 * in an `ALLOWED_SUFFIXES` allow-list to avoid being rejected as invented.
 * That list drifted every time a legitimate Tailwind utility didn't happen
 * to be on it yet, and each drift forced a real workaround into shipped
 * code rather than a test fix: `EmptyState` dropped `text-center` for a
 * flex-only centering approach; `Shell` moved `border-b`/`mx-auto`/
 * `text-inherit`/`bg-transparent` into inline `style`; `Shell` abandoned
 * the `--ui-border-hairline` token for a hardcoded `"1px"` (the token's own
 * PROPERTY NAME contains the substring `border-hairline`, which the old
 * class-scanning regex matched as if it were an unresolved `border-hairline`
 * utility); and, most recently, `Table` and `Tabs` reached for a raw
 * `style` `borderCollapse`/inset `box-shadow` in place of `border-collapse`
 * and `border-b-2` — Tailwind border-WIDTH utilities that don't map to any
 * token this package owns, so the allow-list never grew an entry for them
 * either. Enumerating "every suffix Tailwind ships that isn't a token" is
 * trying to hand-copy another tool's entire vocabulary; it will always be
 * one utility behind.
 *
 * The fix here isn't a bigger list. It's asking Tailwind itself whether a
 * class is real, by literally compiling it — `tailwindcss`'s own
 * `__unstable__loadDesignSystem` JS API (a `devDependency` of this
 * package already), fed this package's own token CSS
 * (`@clossys/designer/theme.css`), the same way a consumer's real
 * build would. `designSystem.candidatesToCss(candidates)` returns, per
 * candidate, either a real CSS rule or `null` for "Tailwind has no idea
 * what this is" — variants (`hover:`, `not-last:`, custom breakpoints like
 * `desktop:`), arbitrary values (`shadow-[var(--ui-elevation-raised)]`,
 * `grid-cols-[auto_minmax(0,1fr)_auto]`), and Tailwind's own reserved
 * vocabulary (`sr-only`, `border-collapse`, `border-b-2`, text-align
 * keywords, ...) all resolve correctly with ZERO hand-maintained list,
 * because the compiler that will actually render this package's CSS is the
 * one answering the question, not a regex trying to predict its output.
 * This has zero false positives BY CONSTRUCTION — every one of the six
 * utilities in the paragraph above compiles clean here — while still
 * catching a genuinely invented token class exactly as before: an unknown
 * candidate produces no CSS anywhere, the same failure mode a browser would
 * actually hit.
 *
 * The one thing Tailwind's compiler *can't* police is this package's own
 * token vocabulary — `shadow-[var(--ui-elevation-raised)]` compiles to a
 * real `box-shadow` declaration whether or not `--ui-elevation-raised`
 * exists as a real token-layer entry, because from Tailwind's
 * point of view an arbitrary-value `var()` argument is just an opaque
 * string. That's exactly the class of bug the raw `var(--ui-*)` /
 * `var(--color-*)` scan below still exists for — it runs across the same
 * raw source text, so it independently catches a bad token name whether it
 * appears in a plain `style` object OR inside a Tailwind arbitrary value
 * like the one above. The two checks are complementary, not redundant:
 * Tailwind is the oracle for "is this a real utility"; `TOKENS`, plus the
 * package's declared sources for stock reads (see `DECLARED_SOURCES`), is the
 * oracle for "does this custom property actually exist".
 *
 * A second, structural side-effect of the redesign: the previous version
 * had to defend against a raw `var()` read's PROPERTY NAME leaking into the
 * class-name scan (`--ui-border-hairline` contains the substring
 * `border-hairline`, which its prefix/suffix regex read as an attempted
 * `border-hairline` utility) by blanking out every custom-property name in
 * a scratch copy of the source before running the class regex over it. That
 * whole class of bug is gone here, not patched: candidate CLASSES are only
 * ever extracted from three syntactic positions — a `className="..."` JSX
 * attribute, the arguments of a `cx(...)` call, and the string values of a
 * `Record<Variant, string>` "variant map" object literal (see
 * `extractCandidateClasses` below) — none of which a bare `var(--ui-*, ...)`
 * string assigned to its own constant (see `internal/ui-vars.ts`,
 * `shell/internal/shell-vars.ts`) ever appears inside. There is no text for
 * a property name to "leak into", because nothing here scans arbitrary
 * text for class-shaped substrings anymore.
 */

const srcDir = dirname(dirname(fileURLToPath(import.meta.url)));

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    const ext = extname(full);
    if ((ext === ".ts" || ext === ".tsx") && !entry.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// ── Class-candidate extraction ──────────────────────────────────────────
//
// Deliberately three narrow syntactic positions, not "every quoted string
// in the file": a generic scan would also catch `gridArea: "header"` and
// `role={isError ? "alert" : "status"}` (both real strings in this
// package's source, neither a Tailwind class) and reject them as invented
// classes. Scoping to where this package ACTUALLY writes class lists avoids
// that without needing a second allow-list to exempt non-class strings —
// the same lesson the redesign above applies to Tailwind's own vocabulary,
// applied here to this package's own non-class string literals.

/** A plain `className="..."` / `className='...'` JSX attribute. */
const CLASSNAME_ATTR_RE = /\bclassName\s*=\s*"([^"]*)"|\bclassName\s*=\s*'([^']*)'/g;

/**
 * The string, template and regular-expression literals in `code`, as
 * [start, end) ranges of their contents. A `className=`, a `cx(` or a map
 * declaration that starts inside one is text the file holds (a source snapshot
 * in a fixture, a pattern like `/className="[^"]*"/`), not code that renders,
 * so the extractors below never read it. A `'` or `"` with no closing quote on
 * its line is JSX text (an apostrophe), not a string; a `/` opens a regular
 * expression only where an operand is expected, never after `<` (a closing
 * tag), `}` or `)` (a `/>`), an identifier or another literal.
 */
const REGEX_PRECEDERS = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";", "+", "-", "*", "%", "~", "^"]);
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await", "instanceof"]);

function literalSpans(code: string): ReadonlyArray<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = [];
  const templates: number[] = [];
  let depth = 0;
  let prev = "";
  let word = "";
  let wordEnded = false;
  const lineEnd = (from: number, close: string): number => {
    let inClass = false;
    for (let j = from; j < code.length && code[j] !== "\n"; j++) {
      const ch = code[j];
      if (ch === "\\") j++;
      else if (close === "/" && ch === "[") inClass = true;
      else if (close === "/" && ch === "]") inClass = false;
      else if (ch === close && !inClass) return j;
    }
    return -1;
  };
  const template = (from: number): number => {
    for (let j = from; j < code.length; j++) {
      if (code[j] === "\\") j++;
      else if (code[j] === "`") {
        spans.push([from, j]);
        return j + 1;
      } else if (code[j] === "$" && code[j + 1] === "{") {
        spans.push([from, j]);
        templates.push(depth++);
        return j + 2;
      }
    }
    spans.push([from, code.length]);
    return code.length;
  };
  let i = 0;
  while (i < code.length) {
    const ch = code[i] as string;
    if (/\s/.test(ch)) {
      wordEnded = true;
      i++;
      continue;
    }
    let end = -1;
    if (ch === '"' || ch === "'") end = lineEnd(i + 1, ch);
    else if (ch === "/" && (prev === "" || REGEX_PRECEDERS.has(prev) || (/[\w$]/.test(prev) && REGEX_KEYWORDS.has(word)))) end = lineEnd(i + 1, "/");
    if (end !== -1) {
      spans.push([i + 1, end]);
      i = end + 1;
      prev = ch;
      word = "";
      continue;
    }
    if (ch === "`" || (ch === "}" && templates.length > 0 && templates.at(-1) === depth - 1)) {
      if (ch === "}") {
        templates.pop();
        depth--;
      }
      i = template(i + 1);
      prev = "`";
      word = "";
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    word = /[\w$]/.test(ch) ? (wordEnded || !/[\w$]/.test(prev) ? ch : word + ch) : "";
    wordEnded = false;
    prev = ch;
    i++;
  }
  return spans;
}

function insideLiteral(spans: ReadonlyArray<readonly [number, number]>, index: number): boolean {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = spans[mid] as readonly [number, number];
    if (index < start) hi = mid - 1;
    else if (index >= end) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * The literals of a `cx(...)` call's argument text that can be class lists.
 * Two positions inside a call are values the call compares or passes on,
 * never classes it renders, and are left out:
 * - an operand of `===`, `!==`, `==` or `!=` (`variant === "inverse" ? ...`,
 *   `typeof className === "function"`);
 * - anything inside a nested call's arguments or an element access
 *   (`buttonClassName("primary", "md")`, `TONE_CLASSES[tone ?? "neutral"]`).
 *   A nested `cx(...)` is read as its own call by `extractCallArgs`.
 * Every other literal, at any depth of a ternary, `&&` or grouping paren, is a
 * candidate class list whenever it is the branch selected at runtime.
 */
function classLiteralsInCall(args: string): string[] {
  const out: string[] = [];
  const passedOn: boolean[] = [];
  let prev = "";
  for (let i = 0; i < args.length; i++) {
    const ch = args[i] as string;
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < args.length && args[j] !== ch) j += args[j] === "\\" ? 2 : 1;
      let before = i - 1;
      while (before >= 0 && /\s/.test(args[before] as string)) before--;
      let after = j + 1;
      while (after < args.length && /\s/.test(args[after] as string)) after++;
      const comparand =
        (args[before] === "=" && (args[before - 1] === "=" || args[before - 1] === "!")) ||
        ((args[after] === "=" || args[after] === "!") && args[after + 1] === "=");
      if (!comparand && !passedOn.includes(true)) out.push(args.slice(i + 1, j));
      i = j;
      prev = ch;
      continue;
    }
    if (ch === "(" || ch === "[") passedOn.push(/[\w$)\].]/.test(prev));
    else if (ch === "{") passedOn.push(false);
    else if (ch === ")" || ch === "]" || ch === "}") passedOn.pop();
    if (!/\s/.test(ch)) prev = ch;
  }
  return out;
}

/**
 * Every top-level string/template literal inside `text` — used against a
 * `cx(...)` call's own argument text (so it sees every branch of a
 * ternary, e.g. `Menu.Item`'s `isDestructive ? "..." : "..."`) and against
 * a variant map's object body. Not scoped to comma-separated top-level
 * arguments specifically: a literal can appear at any nesting depth inside
 * a `cx(...)` call (a ternary, a `&&`), and every one of those branches is
 * a real candidate class list whenever it's the one selected at runtime.
 */
const QUOTED_STRING_RE = /"([^"]*)"|'([^']*)'|`([^`]*)`/g;

function stringLiteralsIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(QUOTED_STRING_RE)) {
    out.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return out;
}

/**
 * Finds every call to `calleeName(...)` and returns each call's full
 * argument text, quote- and nesting-aware. A plain regex can't do this on
 * its own: `cx("grid-cols-[auto_minmax(0,1fr)_auto]", className)` has
 * PARENTHESES inside its own string literal (`minmax(0,1fr)`), so a naive
 * "count parens" scan would think the call ends early. This walks the
 * source character-by-character, tracking whether it's currently inside a
 * quoted string (parens inside a string never affect nesting depth) and
 * only counting `(`/`)` outside of one — the minimum needed to find the
 * TRUE matching close-paren, without pulling in a real parser for it (this
 * package has none, the same reason `ladder.test.ts` stays regex-based —
 * see its own header comment).
 */
function extractCallArgs(code: string, calleeName: string, spans = literalSpans(code)): string[] {
  const args: string[] = [];
  const calleeRe = new RegExp(`\\b${calleeName}\\s*\\(`, "g");
  for (const match of code.matchAll(calleeRe)) {
    if (insideLiteral(spans, match.index)) continue;
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    let quote: string | null = null;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (quote) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
      }
      i++;
    }
    args.push(code.slice(start, i - 1));
  }
  return args;
}

/**
 * A "variant map": `const XXX_CLASSES: Record<SomeVariant, string> = {...}`
 * (or, for `Avatar`'s size map, `Record<AvatarSize, { box: string; text:
 * string }>` — a nested object, still string-valued throughout). Every
 * component's variant styling in this package is one of these, keyed by variant
 * name, looked up by a computed expression (`VARIANT_CLASSES[variant]`)
 * that a static scan can't resolve — so this reads the map's own DECLARATION
 * instead of trying to follow the reference into `cx(...)`. `[^=]*` (not
 * `[^={]*`) deliberately allows a `{` inside the type parameter itself
 * (`Avatar`'s nested object type) — the type annotation never contains a
 * bare `=`, so a lazy match up to the first one still lands on the real
 * assignment.
 */
const VARIANT_MAP_RE = /const\s+[A-Za-z_]*CLASSES\s*:\s*Record<[^=]*>\s*=\s*\{([\s\S]*?)\n\};/g;

/**
 * Every `Record<...>` map declaration, with its name — used by the coverage
 * assertion below, NOT by class extraction.
 */
const ANY_RECORD_MAP_RE = /const\s+([A-Za-z_]+)\s*:\s*Record</g;

/**
 * The initializer text of the declaration whose type annotation starts at
 * `from`: everything after its first top-level `=` (not `=>`, `==` or a
 * comparison) up to the top-level `;` that ends the statement (or the close
 * of the enclosing block), quote-aware. `from` is the annotation's `<`.
 * Empty when the declaration has no initializer.
 */
function declarationInitializer(code: string, from: number): string {
  let depth = 0;
  let start = -1;
  for (let i = from; i < code.length; i++) {
    const ch = code[i] as string;
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== ch) j += code[j] === "\\" ? 2 : 1;
      i = j;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{" || (start === -1 && ch === "<")) depth++;
    else if (ch === ")" || ch === "]" || ch === "}" || (start === -1 && ch === ">" && code[i - 1] !== "=")) depth--;
    else if (depth === 0 && start === -1 && ch === "=" && !/[=>]/.test(code[i + 1] ?? "") && !/[=!<>]/.test(code[i - 1] ?? "")) start = i + 1;
    else if (depth === 0 && start !== -1 && ch === ";") return code.slice(start, i);
    if (depth < 0) return start === -1 ? "" : code.slice(start, i);
  }
  return start === -1 ? "" : code.slice(start);
}

/**
 * The string literals an initializer holds in value positions: every literal
 * except an object key (one that follows `{` or `,` and is followed by `:`).
 */
function stringValuesIn(initializer: string): string[] {
  const out: string[] = [];
  let prev = "";
  for (let i = 0; i < initializer.length; i++) {
    const ch = initializer[i] as string;
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < initializer.length && initializer[j] !== ch) j += initializer[j] === "\\" ? 2 : 1;
      let after = j + 1;
      while (after < initializer.length && /\s/.test(initializer[after] as string)) after++;
      if (!((prev === "{" || prev === ",") && initializer[after] === ":")) out.push(initializer.slice(i + 1, j));
      i = j;
      prev = ch;
      continue;
    }
    if (!/\s/.test(ch)) prev = ch;
  }
  return out;
}

/** A lone lowercase word: as much an English word or a prop value as a class. */
const BARE_WORD_RE = /^[a-z]+$/;

/**
 * Whether a map is a style table: one of its string values holds a token
 * Tailwind parses as a utility, compiled or not (`px-sm`, and a mistyped
 * `bg-surface-elevated` alike), that is not a lone lowercase word. A map of
 * numbers, nodes, an empty accumulator, or of strings that are no utility at
 * all (slot ids, attribute names, export names) holds no style name to check,
 * and neither does one whose only Tailwind-shaped strings are bare words such
 * as a prop value `outline` or a property name `size`.
 */
function holdsStyleNames(initializer: string): boolean {
  return stringValuesIn(initializer).some((value) =>
    value.split(/\s+/).some((token) =>
      token !== "" && !BARE_WORD_RE.test(token) && designSystem.parseCandidate(token).length > 0));
}

/**
 * Maps that are deliberately NOT class lists, and so are deliberately not
 * scanned. Each entry is a promise that the map holds something else —
 * `Stat`'s trend indicators hold a glyph and a label, because encoding
 * direction by colour alone fails accessibility, so the glyph and the
 * words are the non-colour channel.
 *
 * This list exists so that skipping a map is a DELIBERATE act. The class
 * extractor above only reads maps named `*CLASSES`, which is precise but
 * would otherwise fail open: a class map named `BUTTON_STYLES` would
 * silently never be checked, and a typo inside it would ship. The
 * assertion that consumes this list closes that hole — every `Record` map
 * that holds a style name (see `holdsStyleNames`) must be either scanned or
 * named here, so a new class map cannot quietly escape both.
 */
const KNOWN_NON_CLASS_MAPS = new Set([
  // Foundry importer builds nested DTCG token groups, not Tailwind classes.
  "importers/foundry.ts:root",
  // Integrated consumer-library records: DTCG nodes and selected members.
  "catalog-core/library.ts:root",
  "catalog-core/library.ts:values",
  "catalog-core/model.ts:result",
  "catalog-core/resolve.ts:chosen",
  "catalog-core/resolve.ts:members",
  "importers/shared.ts:root",
  // Asset records contain dimensions, source dependencies and SVG bytes.
  "catalog-assets/check.ts:values",
  "catalog-assets/identity.ts:INPUTS",
  "catalog-assets/identity.ts:values",
  "catalog-assets/emit.ts:glyphs",
  "catalog-assets/emit.ts:names",
  "catalog-assets/svg.ts:attrs",
  "catalog-assets/svg.ts:geometry",
  // Importer maps hold permitted token members, glyph nodes and CSS values.
  "importers/foundry-offered.ts:SUBSETS",
  "importers/lucide.ts:nodes",
  "importers/tailwind-default.ts:rules",
  // Token preview's authored CSS application signatures, never class strings.
  "tokens/preview/index.tsx:applications",
  // Token preview's ReactNode specimens, never class strings.
  "tokens/preview/index.tsx:specimens",
  // backdrop/consumer-art.ts — aspect -> intrinsic geometry pair, not classes.
  "aspects",
  // blocks/scene/Scene.tsx — document-format labels, never class names.
  "formats",
  // Validated saved-view fields copied into plain data, not rendered classes.
  "blocks/table-model/model.ts:result",
  // DataTable envelope fields are validated saved data, never class names.
  "blocks/data-table/view-model.ts:result",
  // blocks/FeatureGrid.tsx — treatment -> linked-item frame name (a
  // stretched-link.tsx key), not a class string.
  "LINK_FRAMES",
  "TREND_GLYPH",
  "TREND_LABEL",
  // charts/internal/chart-vars.ts — slot-number -> fallback-hex lookups fed
  // into a `var(--token, <fallback>)` string, never used as a class name.
  "CHART_CATEGORICAL_FALLBACK",
  // `tokens/read-brand-css.ts`: parsed CSS custom-property values, not classes.
  "declarations",
  "CHART_SEQUENTIAL_FALLBACK",
  // components/Icon.tsx — size -> `var(--ui-icon-*, <fallback>)` string lookup,
  // read via `style.width`/`style.height`, never a Tailwind class name (the
  // same reason `CHART_*_FALLBACK` above is non-class, not a scan gap).
  "SIZE_VARS",
  // components/StatusMark.tsx — tone -> Lucide glyph name (rendered as
  // `data-shape`), shape name -> glyph data, and tone -> Kibo UI status
  // vocabulary; the mark's colour class lives in `MARK_CLASSES`, which is scanned.
  "SHAPES",
  "SHAPE_GLYPHS",
  "KIBO_STATUS",
  // token-gate.ts — StyleCandidateKind -> human-readable report label
  // ("hex color", "arbitrary-value class", ...), interpolated into a
  // TokenGateFinding's `message` string, never a Tailwind class name.
  "KIND_LABEL",
  // token-gate.ts — EmbeddedLiteral["kind"] -> human-readable report label
  // ("embedded hex color", ...), same role as KIND_LABEL above, one level
  // down (for a literal embedded inside a tw-arbitrary bracket).
  "EMBEDDED_KIND_LABEL",
  // theme/ThemeToggle.tsx — ThemePreference -> human-readable label
  // ("System"/"Light"/"Dark"), interpolated into the button's aria-label
  // and the live-region announcement text, never a Tailwind class name.
  "PREFERENCE_LABEL",
  // blocks/StatusList.tsx — editorial readiness state -> semantic status
  // tone key used to select SECTION_GROUND_CLASSES.status, never a class.
  "STATE_TONES",
  // theme/ThemeToggle.tsx — ThemePreference -> IconNode glyph data
  // (Monitor/Sun/Moon), passed to Icon's `glyph` prop, never a class name.
  "PREFERENCE_GLYPH",
  // tokens/internal/registry-from-css.ts — CSS custom-property name ->
  // synthesized TokenDefinition, built from parsed tokens.css declarations
  // for the contrast gate to resolve var() aliases against; never a
  // Tailwind class name, the same role "declarations" above already has.
  "registry",
  // required-utility name -> closed CSS
  // selector needles already written with Tailwind's `\:` form. Lookup
  // table, not a class map the parity scanner should compile.
  "UTILITY_RULE_NEEDLES",
  // tokens/identity-checks.ts — IdentityCheckId -> {verdict, findings}
  // judgement record, one per identity-kit check (contrast/minimum-size/
  // clear-space/single-colour-legibility). Report data, never a Tailwind
  // class name.
  "checkVerdicts",
]);

function isKnownNonClassMap(file: string, name: string): boolean {
  const path = relative(srcDir, file).split(sep).join("/");
  return KNOWN_NON_CLASS_MAPS.has(name) || KNOWN_NON_CLASS_MAPS.has(`${path}:${name}`);
}

/**
 * The style-table `Record` maps in `code` (see `holdsStyleNames`) that are
 * neither scanned as classes (named `*CLASSES`) nor declared non-class. A map
 * that holds no style name cannot hold a class list, so it needs neither; a
 * declaration written inside a string literal is text, not a map.
 */
function unaccountedRecordMaps(file: string, code: string): string[] {
  const spans = literalSpans(code);
  const out: string[] = [];
  for (const match of code.matchAll(ANY_RECORD_MAP_RE)) {
    const name = match[1] as string;
    if (insideLiteral(spans, match.index)) continue;
    if (name.includes("CLASSES")) continue;
    if (isKnownNonClassMap(file, name)) continue;
    if (!holdsStyleNames(declarationInitializer(code, match.index + match[0].length - 1))) continue;
    out.push(name);
  }
  return out;
}

interface CandidateClasses {
  /** Every class token this file writes in a class position. */
  classes: Set<string>;
  /** Tokens written only inside a class list copied verbatim from the stock registry (see `STOCK_CLASS_LISTS`). */
  stock: Set<string>;
}

function extractCandidateClasses(code: string): CandidateClasses {
  const spans = literalSpans(code);
  const chunks: string[] = [];

  for (const match of code.matchAll(CLASSNAME_ATTR_RE)) {
    if (!insideLiteral(spans, match.index)) chunks.push(match[1] ?? match[2] ?? "");
  }
  for (const args of extractCallArgs(code, "cx", spans)) {
    chunks.push(...classLiteralsInCall(args));
  }
  for (const match of code.matchAll(VARIANT_MAP_RE)) {
    if (!insideLiteral(spans, match.index)) chunks.push(...stringLiteralsIn(match[1] ?? ""));
  }

  const classes = new Set<string>();
  const stock = new Set<string>();
  for (const chunk of chunks) {
    const target = STOCK_CLASS_LISTS.has(chunk) ? stock : classes;
    for (const token of chunk.split(/\s+/)) {
      if (token) target.add(token);
    }
  }
  for (const token of classes) stock.delete(token);
  return { classes, stock };
}

/**
 * The class tokens of one file that do not resolve, given which candidates
 * Tailwind compiled. A token Tailwind compiles to no rule still resolves when
 * it is one of three things a stylesheet, not a utility, gives meaning to:
 * - a hook class the package's own stylesheets select (`PACKAGE_HOOK_CLASSES`);
 * - a Tailwind marker class, `group` or `peer` (optionally `/name`), which
 *   Tailwind's `group-*` and `peer-*` variants select;
 * - a token of a class list copied verbatim from the stock registry that
 *   Tailwind does not parse as a utility at all (stock's `toaster` hook).
 *   A stock token Tailwind parses as a utility but cannot compile (a missing
 *   keyframe, say) still fails.
 */
function unresolvedClasses(candidates: CandidateClasses, compiles: (className: string) => boolean): string[] {
  const out: string[] = [];
  for (const className of candidates.classes) {
    if (compiles(className) || PACKAGE_HOOK_CLASSES.has(className) || TAILWIND_MARKER_RE.test(className)) continue;
    out.push(className);
  }
  for (const className of candidates.stock) {
    if (compiles(className) || designSystem.parseCandidate(className).length === 0) continue;
    out.push(className);
  }
  return out;
}

// ── Raw var(--...) read validation — unchanged in approach ─────────────
//
// Tailwind can't validate these (see the header comment above): a
// `var(--anything)` argument, whether written as a plain `style` value or
// tucked inside a Tailwind arbitrary value, is opaque to Tailwind's
// compiler. This stays a list-based check against the real `TOKENS` export,
// run over each file's full, UNMODIFIED source — nothing here needs to
// dodge the class-name scan the way the old version's blanking pass did,
// because (per the header comment) the class scan no longer looks at
// arbitrary text at all.
const VAR_RE = /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,|\))/g;

// A read also resolves when the package's declared sources give the name a
// value: the same sources, by code, that `generateCompiledCss` reads its
// fallbacks from (`compiled-css/declared-fallbacks.ts`): tokens.css, theme.css
// with theme-keys.css, the package default theme (the stock shadcn theme
// fills) and the installed Tailwind default theme, plus the variables the
// package's own sources set inline. One source, never a typed list: Tailwind's
// `--spacing` or shadcn's `--foreground` resolve because the installed theme
// declares them, and a name no source declares still fails.
const DECLARED_SOURCES = compiledCssDeclaredSources(join(dirname(srcDir), "styles"));
const DECLARED_VARIABLES: ReadonlySet<string> = new Set([
  ...declaredTokenValues(DECLARED_SOURCES, "").keys(),
  ...DECLARED_SOURCES.runtimeSetVariables,
]);

/**
 * Class names the package's own stylesheets select (`.frame-header-grid`,
 * `& .site-header-nav-inline`): read from the selector preludes of the same
 * declared sources, tokens.css and theme.css with theme-keys.css inlined. A
 * class Tailwind cannot compile is still real when the package styles it.
 */
const SELECTOR_CLASS_RE = /\.(-?[_a-zA-Z][\w-]*)(?![\w\\-])/g;

function selectorClasses(css: string): Set<string> {
  const out = new Set<string>();
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  for (const prelude of cleaned.matchAll(/([^{};]+)\{/g)) {
    for (const match of (prelude[1] ?? "").matchAll(SELECTOR_CLASS_RE)) out.add(match[1] as string);
  }
  return out;
}

const PACKAGE_HOOK_CLASSES: ReadonlySet<string> = selectorClasses(`${DECLARED_SOURCES.tokensCss}\n${DECLARED_SOURCES.themeCss}`);

/** Tailwind's marker classes: they emit no rule, and `group-*` / `peer-*` variants select them. */
const TAILWIND_MARKER_RE = /^(?:group|peer)(?:\/[\w-]+)?$/;

/**
 * Every `className="..."` class list the stock registry snapshots this package
 * vendors write (`references/shadcn-aria`, the registry its components are
 * copied from). Only a whole class list equal to one of these counts as stock.
 */
const STOCK_REGISTRY_DIR = join(dirname(srcDir), "references", "shadcn-aria");

function stockClassLists(dir: string, out = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) stockClassLists(full, out);
    else if (extname(full) === ".tsx") {
      for (const match of readFileSync(full, "utf8").matchAll(CLASSNAME_ATTR_RE)) out.add(match[1] ?? match[2] ?? "");
    }
  }
  return out;
}

const STOCK_CLASS_LISTS: ReadonlySet<string> = stockClassLists(STOCK_REGISTRY_DIR);

function isDeclaredVariable(property: string): boolean {
  return property in TOKENS || DECLARED_VARIABLES.has(property);
}

/** Every `var(--x)` read in `code` that neither TOKENS nor a declared source resolves. */
function unresolvedVarFindings(relFile: string, code: string): Finding[] {
  const out: Finding[] = [];
  for (const match of code.matchAll(VAR_RE)) {
    const property = match[1] as string;
    if (isDeclaredVariable(property)) continue;
    out.push({
      file: relFile,
      kind: "var",
      text: property,
      reason: `"${property}" is not a token in @clossys/designer/tokens' TOKENS export, and no declared source (tokens.css, theme.css, the package default theme, Tailwind's default theme, an inline setter) declares it`,
    });
  }
  return out;
}

// ── Compile Tailwind once, using this package's real token CSS ─────────
//
// `require.resolve` (via `createRequire`, since this file is ESM) rather
// than a hardcoded path: this package's token CSS and
// `tailwindcss` are all real npm dependencies resolved through the normal
// module graph (an npm workspace symlink in this monorepo, a real
// `node_modules` install for an external consumer of this package) — using
// Node's own resolver is what makes this the same "real build" a consumer
// would get, not a path that only happens to work in this repository's
// layout. `tailwindcss`'s bare specifier needs one explicit rewrite to
// `tailwindcss/index.css`: `@import "tailwindcss"` in a real build resolves
// through that package's own `exports` map's `style` CONDITION, which
// Node's plain CJS `require.resolve` (no loader for a `style` export
// condition exists) can't follow on its own — every other specifier this
// package imports (`@clossys/designer/theme.css`, and that file's own
// relative `./tokens.css`) already names its `.css` file explicitly, so no
// such rewrite is needed for them.
const require = createRequire(import.meta.url);

async function loadStylesheet(id: string, base: string) {
  let resolved: string;
  if (id.startsWith(".") || id.startsWith("/")) {
    resolved = require.resolve(id, { paths: [base] });
  } else if (id === "tailwindcss") {
    resolved = require.resolve("tailwindcss/index.css");
  } else {
    resolved = require.resolve(id);
  }
  return { path: resolved, base: dirname(resolved), content: readFileSync(resolved, "utf8") };
}

const TOKEN_CSS_ENTRY = [
  '@import "tailwindcss";',
  '@import "@clossys/designer/theme.css";',
].join("\n");

// One compile for the whole file, not one per class: `candidatesToCss`
// accepts the full candidate list at once and is the only Tailwind call
// this file makes — see the README's "Tests" section for why that matters
// for keeping this fast.
const designSystem = await __unstable__loadDesignSystem(TOKEN_CSS_ENTRY, {
  base: srcDir,
  loadStylesheet,
});

interface Finding {
  file: string;
  kind: "class" | "var";
  text: string;
  reason: string;
}

const findings: Finding[] = [];
const sourceFiles = collectSourceFiles(srcDir);

const allCandidateClasses = new Set<string>();
const classesByFile = new Map<string, CandidateClasses>();
const varsByFile = new Map<string, string[]>();

for (const file of sourceFiles) {
  const raw = readFileSync(file, "utf8");
  const code = stripComments(raw);
  const relFile = file.slice(srcDir.length + 1);

  const candidates = extractCandidateClasses(code);
  classesByFile.set(file, candidates);
  for (const c of [...candidates.classes, ...candidates.stock]) allCandidateClasses.add(c);

  const vars = [...code.matchAll(VAR_RE)].map((match) => match[1] as string);
  varsByFile.set(file, vars);
  findings.push(...unresolvedVarFindings(relFile, code));
}

// One compiler call for every candidate across every file, then a map
// lookup per file below — the compile is the expensive part, and it only
// happens once regardless of how many files or classes there are.
const candidateList = [...allCandidateClasses];
const compiledResults = designSystem.candidatesToCss(candidateList);
const invalidClasses = new Set(
  candidateList.filter((_, i) => compiledResults[i] === null),
);

for (const [file, candidates] of classesByFile) {
  const relFile = file.slice(srcDir.length + 1);
  for (const className of unresolvedClasses(candidates, (c) => !invalidClasses.has(c))) {
    findings.push({
      file: relFile,
      kind: "class",
      text: className,
      reason: "Tailwind compiled this to no CSS rule at all, and no package stylesheet, Tailwind marker or stock class list gives it meaning",
    });
  }
}

describe("token parity: every Tailwind class and var() read resolves against a real compile", () => {
  it("found at least one Tailwind class to check (sanity — a passing test with zero coverage proves nothing)", () => {
    expect(allCandidateClasses.size).toBeGreaterThan(10);
  });

  it("found at least one raw var(--ui-*) read to check", () => {
    const totalVarsChecked = [...varsByFile.values()].reduce((n, vars) => n + vars.length, 0);
    expect(totalVarsChecked).toBeGreaterThan(0);
  });

  it("every className/cx()/variant-map class resolves to a real Tailwind rule, and every var() read resolves to a real token", () => {
    if (findings.length > 0) {
      const report = findings
        .map((f) => `  ${f.file}: ${f.kind} "${f.text}" — ${f.reason}`)
        .join("\n");
      throw new Error(`${findings.length} unresolved reference(s):\n${report}`);
    }
    expect(findings).toEqual([]);
  });

  /**
   * The declared sources widen what resolves to what the installed theme
   * really declares, never to "anything": a name that no token and no source
   * declares is still a finding, beside stock reads that do resolve.
   */
  it("an unknown css variable still fails token parity", () => {
    const unknown = "--ui-no-such-token-anywhere";
    expect(isDeclaredVariable(unknown)).toBe(false);
    const probe = `<div style={{ color: "var(${unknown})", margin: "calc(var(--spacing) * 2)", borderColor: "var(--border)" }} />`;
    expect(unresolvedVarFindings("probe.tsx", probe).map((f) => f.text)).toEqual([unknown]);
  });

  /**
   * The cx() precision rules leave out compared values, values passed on to a
   * nested call or element access, and code written inside a string — never
   * the class branches the call renders. A mistyped class in a ternary branch
   * is still the one finding, beside every value the rules leave out.
   */
  it("a real unknown class inside cx() still fails", () => {
    const probe = [
      'const label = \'cx("not-a-class")\';',
      'export const X = ({ variant, tone }) => <div className={cx(variant === "inverse" ? "bg-surface-elevated" : "bg-surface-raised", size("md"), TONE[tone ?? "neutral"], "group")} />;',
    ].join("\n");
    const compiles = (className: string) => designSystem.candidatesToCss([className])[0] !== null;
    expect(unresolvedClasses(extractCandidateClasses(probe), compiles)).toEqual(["bg-surface-elevated"]);
    // A stock class list copied verbatim keeps its non-utility hook (`toaster`), never a utility Tailwind cannot compile.
    const stock = 'export const Y = () => <><div className="toaster group" /><div className="h-4 w-px animate-caret-blink bg-foreground duration-1000" /></>;';
    expect(unresolvedClasses(extractCandidateClasses(stock), compiles)).toEqual(["animate-caret-blink"]);
  });

  /**
   * The map check counts a `Record` map only when its values hold a style
   * name, so a map of slot ids, numbers or prop values needs no declaration —
   * but a string-valued class map under any other name than `*CLASSES` still
   * fails, mistyped class and all, and a declaration written inside a string
   * is not a map.
   */
  it("a string-valued class map without a declaration still fails", () => {
    const probe = [
      'const BUTTON_STYLES: Record<Size, string> = { sm: "px-sm bg-surface-elevated", md: "px-md" };',
      'const ROW_CLASSES: Record<Size, string> = { sm: "px-sm" };',
      'const SLOT_IDS: Record<Size, string> = { sm: "components.button", md: "Impl0" };',
      "const ORDER: Record<Size, number> = { sm: 1, md: 2 };",
      'const PROPS: Record<string, { property: string; value: string }> = { a: { property: "size", value: "outline" } };',
      `const note = 'const TEXT_STYLES: Record<Size, string> = { sm: "px-sm" };';`,
    ].join("\n");
    expect(unaccountedRecordMaps(join(srcDir, "probe.ts"), probe)).toEqual(["BUTTON_STYLES"]);
  });

  /**
   * A permanent regression guard for the exact failure this file was
   * redesigned to fix, independent of what today's real components happen
   * to use — checked directly against the compiled design system, not by
   * scanning any file. If a future Tailwind upgrade ever stopped
   * recognizing one of these, this fails with a clear "which utility"
   * signal instead of a contributor rediscovering it by hand a fifth time.
   */
  it("compiles every utility that previously forced a workaround, and still rejects an invented token class", () => {
    const previouslyRejectedButLegitimate = [
      "text-center", // EmptyState — was deleted for a flex-only centering approach
      "mx-auto", // Shell.Main — was moved to inline `marginInline: "auto"`
      "text-inherit", // was moved to inline `style`
      "bg-transparent", // was moved to inline `style`
      "border-collapse", // Table — was `style={{ borderCollapse: "collapse" }}`
      "border-b-2", // Tabs — was an inset box-shadow standing in for a real border
      "border-b-0", // was avoided via a `not-last:` variant instead
    ];
    const invented = ["bg-surface-elevated"]; // no such token — the real name is `surface-raised`

    const results = designSystem.candidatesToCss([...previouslyRejectedButLegitimate, ...invented]);

    previouslyRejectedButLegitimate.forEach((className, i) => {
      expect(results[i], `expected "${className}" to compile to a real rule`).not.toBeNull();
    });
    invented.forEach((className, i) => {
      const result = results[previouslyRejectedButLegitimate.length + i];
      expect(result, `expected invented class "${className}" to produce no rule`).toBeNull();
    });
  });

  /**
   * Closes the fail-open hole in the class extractor. It only reads maps
   * named `*CLASSES`, which is precise — but on its own it would mean a
   * class map named anything else is silently never checked, and a typo
   * inside it ships unnoticed. A test that quietly stops covering things
   * is worse than no test, because it still reads as green.
   *
   * So: every `Record<...>` map in the source that holds a style name must
   * be either scanned (named `*CLASSES`) or explicitly listed as a known
   * non-class map.
   * Adding a map that is neither fails here, and the fix is to name it
   * correctly or declare why it holds something other than classes.
   */
  it("every Record map is either scanned as classes or explicitly declared non-class", () => {
    const unaccounted: string[] = [];

    for (const file of sourceFiles) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const name of unaccountedRecordMaps(file, code)) {
        unaccounted.push(`  ${file.slice(srcDir.length + 1)}: ${name}`);
      }
    }

    if (unaccounted.length > 0) {
      throw new Error(
        `${unaccounted.length} Record map(s) neither scanned nor declared non-class:\n` +
          `${unaccounted.join("\n")}\n\n` +
          `A map holding Tailwind classes must be named *CLASSES so the parity ` +
          `check reads it. A map holding anything else must be added to ` +
          `KNOWN_NON_CLASS_MAPS, which documents what it holds instead.`,
      );
    }
    expect(unaccounted).toEqual([]);
  });

  it("qualifies preview non-class declarations without accepting those names elsewhere", () => {
    const preview = join(srcDir, "tokens", "preview", "index.tsx");
    for (const name of ["applications", "specimens"]) {
      expect(isKnownNonClassMap(preview, name), name).toBe(true);
      expect(isKnownNonClassMap(join(srcDir, "blocks", "Example.tsx"), name), name).toBe(false);
      expect(isKnownNonClassMap(join(srcDir, "tokens", "preview-other", "index.tsx"), name), name).toBe(false);
    }
    expect(isKnownNonClassMap(preview, "unknownMap")).toBe(false);
    expect(isKnownNonClassMap(join(srcDir, "other.ts"), "aspects")).toBe(true);
  });
});
