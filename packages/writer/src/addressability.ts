/**
 * `scanAddressabilitySources` and `checkAddressability` — the
 * copy-ADDRESSABILITY gate: is user-facing prose resolved from a copy
 * registry BY ID, or typed directly into a component? A DIFFERENT, STRICTER
 * question than `copy-gate.ts`'s traceability check. Traceability accepts a
 * literal that happens to match a registered `CopyEntry.text`'s SHAPE, or
 * that carries a `copy:<id>` citation comment — both of which still leave
 * the actual sentence sitting in the component's own source. That is cheap
 * to verify but NOT cheap to change: marketing renaming a CTA means editing
 * every component that typed it, not one registry entry. Addressability is
 * the property that keeps that rename cheap: the component's own source
 * contains an id, never the sentence. This file does not accept a citation
 * or a text-shape match as satisfying — see `extractAddressabilityCandidates`
 * below, which has no `CopyRecord` input at all and therefore nothing to
 * match against; a literal is either not present as authored prose in a
 * position this gate can see, or it is a violation.
 *
 * Measured across four real sites at the time this gate was written: 2
 * inline prose strings on one, 4 attribute-borne on another, 0 elsewhere —
 * so the property currently holds, by luck rather than enforcement. This
 * file is what turns that measurement into something that stays true.
 *
 * NO PARSER LIBRARY, no new dependency — `packages/copy` ships zero runtime
 * dependencies and this file adds none. It reuses `scan.ts`'s
 * `extractCopyCandidates` for the genuinely hard part (finding every
 * string/template literal and JSX text-node BOUNDARY correctly — escaped
 * quotes, nested interpolation, comments, regex literals, and JSX itself),
 * and `path-exclusions.ts`'s `validatePathExclusions`/`matchesPathExclusion`
 * for the file-scope exclusion mechanism, exactly the way `scan.ts` itself
 * does. This file's own walker (`scanAddressabilitySources`) mirrors
 * `scan.ts`'s `scanCopySourceTree` and `@vespeneventures/ui`'s
 * `style-scan.ts`'s `scanStyleSources` closely (same extensions/skipDirs
 * defaults, same `SKIP_FILE_RE`, same fail-closed-on-unreadable-directory
 * contract) — a thin per-file dispatch loop, not a second tokenizer: the
 * actual literal/JSX-boundary parsing is ENTIRELY delegated to `scan.ts`.
 *
 * ============================================================================
 * THREE POSITIONS, THREE CLASSIFICATIONS
 * ============================================================================
 *
 * 1. MARKUP TEXT NODES (`<span>Hello</span>`'s `Hello`) — `scan.ts`'s own
 *    `kind: "jsx-text"` candidates. `scan.ts` already dropped
 *    whitespace-only and no-letters runs before these ever reach this
 *    file, so every one remaining is real, rendered prose authored
 *    directly in markup — never resolved through an id, by construction
 *    (a JSX text node IS the literal text; an id-resolved child would be
 *    an EXPRESSION child, `{copy(id)}`, which `scan.ts`'s tokenizer treats
 *    as code, never a text-node candidate at all — see `scan.ts`'s own
 *    top doc comment, "JSX TEXT NODES"). ALWAYS a violation.
 *
 * 2. THE FOUR USER-FACING ATTRIBUTES — `aria-label`, `placeholder`, `alt`,
 *    `title`. These carry prose a person reads (an accessible name, a
 *    hint, alt text, a tooltip) and are NOT text nodes; a scanner that
 *    only understands text nodes reports zero on a real component whose
 *    ENTIRE user-facing surface is `<input aria-label="..." placeholder=
 *    "..." />` and calls that a clean pass. `scan.ts` itself already
 *    excludes `aria-label` from its own candidate list (bundled under
 *    `"aria-or-data-attribute-value"` together with `aria-hidden`,
 *    `aria-describedby`, every `data-*` attribute — a deliberate SCOPE
 *    decision for traceability, see `scan.ts`'s exclusion #4) and leaves
 *    `placeholder`/`alt`/`title` as ordinary default-included candidates
 *    (neither aria/data-shaped nor on its structural denylist). This gate
 *    re-derives each literal's own attribute NAME locally — a string
 *    literal never spans a line (see `scan.ts`'s `scanStringLiteral`), so
 *    "the identifier immediately before this literal's own quote, on the
 *    SAME line" is an exact lookup, not an approximation — specifically to
 *    recover `aria-label` back into scope while leaving every OTHER
 *    aria-*, data-* attribute exactly where `scan.ts` already decided it
 *    belongs: out of copy governance entirely. A literal-valued occurrence
 *    of one of the four, carrying at least one letter, is ALWAYS a
 *    violation — there is no citation or registry-text-match escape hatch
 *    here (see this file's top comment for why) — UNLESS the assignment
 *    this gate re-derived is itself a DESTRUCTURING-PATTERN DEFAULT or a
 *    plain (non-destructured) PARAMETER DEFAULT (`{ "aria-label":
 *    ariaLabel = "Pagination" }`, `{ placeholder = "Search" }`,
 *    `function f(alt = "...")`), never a JSX attribute at all — see
 *    `isDestructuringOrParameterDefault`. A default value in a
 *    destructuring pattern is exactly the property this gate exists to
 *    protect: the CONSUMER can override it, so the component's own source
 *    does not lock the sentence in the way a hardcoded JSX attribute
 *    does. Reporting one as a violation would not just be a false
 *    positive — it would INVERT the verdict on a construct that is
 *    already correctly addressable.
 *
 * 3. EVERYTHING ELSE THIS GATE CANNOT CONFIDENTLY CLASSIFY — a template
 *    literal (in ANY position, including one of the four attributes above:
 *    a template can carry an interpolated copy id, a partial sentence, or
 *    genuine inline prose, and this gate does not attempt to tell those
 *    apart), an object/array literal VALUE (`scan.ts` only excludes object
 *    KEYS, never values — `{ tooltip: "Explain this" }`'s `"Explain
 *    this"` is a default-included candidate with no attribute name at
 *    all), or a plain string in a prop that is none of the four (a custom
 *    `tooltip`, a bare variable assignment, ...) — UNLESS that string is
 *    itself shaped like a CSS/Tailwind utility class LIST (`"border-t
 *    border-line-base pt-xs"`, `"grid-cols-1 tablet:grid-cols-2"`), which
 *    is definitively not prose and is excluded here for the same reason
 *    `scan.ts` already excludes that shape when it DOES have an attribute
 *    name to key off (a literal `className="..."` value) — see
 *    `looksLikeUtilityClassList`. Everything else in this category is
 *    NEVER silently treated as clean, and NEVER treated as a violation
 *    either — reported as `unchecked`, the same discipline `scan.ts`'s own
 *    `UncheckedItem` and `checkCopyTraceability`'s `unchecked` passthrough
 *    already hold JSX parse ambiguities to. A measurement may round an
 *    unknown down to "probably fine"; a gate may not — that is the whole
 *    reason this file exists rather than a grep for `aria-label="`.
 *
 * `scan.ts`'s own exclusions for genuinely non-user-facing literals
 * (`className`, `data-testid`, an import specifier, a `cx(...)` argument, a
 * developer diagnostic, a decorative no-letters glyph, an enum-shaped
 * single token, a `type`/`interface` context) apply here for free: a
 * literal `scan.ts` excludes for one of THOSE reasons never becomes a
 * `candidates` entry at all, so it never reaches this file's own
 * classification and is never reported by it, in any of the three
 * categories above. This is what keeps this gate from flagging `className`,
 * `data-*`, an import specifier, or a `testId` — see this file's own test
 * suite for a fixture proving exactly that.
 *
 * ============================================================================
 * THE TERNARY
 * ============================================================================
 *
 * Deliberately DIFFERENT from `copy-gate.ts`/`scan.ts`'s "an `unchecked[]`
 * list gates a `2` before findings are counted" precedence — see issue #407.
 * On this gate specifically, partial coverage of a real tree is not a rare
 * edge case: hundreds of string positions are token data (category 3 above)
 * this gate cannot classify BY DESIGN, on every real tree it has ever been
 * run against. Letting "at least one unclassified position" outrank a
 * confirmed violation therefore does not model "an occasional coverage gap
 * might be hiding something" — it makes the `"violated"` branch permanently
 * unreachable outside a fixture, because a real tree always has unclassified
 * positions somewhere. A gate that can only ever report `"indeterminate"` or
 * `"satisfied"` in production has one usable state, and a caller that
 * learns to treat `2` as "coverage is never complete, ignore it" will walk
 * straight past five named, file-and-line violations without ever seeing
 * them — see `packages/inspector/src/review-evidence.ts`'s own argument
 * against the mirror image of this mistake (folding an outage into a
 * verdict); this is folding a verdict into an outage.
 *
 *   - `"violated"` — at least one inline user-facing prose string found
 *     (category 1 or 2 above), REGARDLESS of how many string positions are
 *     unclassified. The coverage gap is not hidden: `reasons` and
 *     `unchecked` are still populated and still printed (`cli.ts`'s
 *     `printAddressabilityAccounting` reports `unchecked` unconditionally,
 *     independent of verdict) — a `"violated"` verdict never claims full
 *     coverage, it claims that what WAS seen included a definite violation,
 *     which is true regardless of what else was not seen.
 *   - `"indeterminate"` — zero violations, AND the source tree could not be
 *     read at all (this file's `scanAddressabilitySources` fails closed,
 *     throwing, exactly like `scan.ts`'s `scanCopySourceTree`), ZERO
 *     components were successfully scanned (nothing matched, or every
 *     matched file failed to parse), a `pathExclusions` entry was
 *     malformed, or ANY string position could not be confidently classified
 *     (category 3 above, or a JSX construct `scan.ts` itself could not
 *     resolve). The honest "found nothing, but did not see everything"
 *     case — it must never read as a pass.
 *   - `"satisfied"` — at least one component scanned, every string
 *     position classified, and no inline user-facing prose found.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { extractCopyCandidates } from "./scan.js";
import type { ParseFailure, SkippedFile } from "./scan.js";
import {
  matchesPathExclusion,
  validatePathExclusions,
  type ExcludedPath,
  type PathExclusion,
  type PathExclusionFinding,
  type ValidatedPathExclusion,
} from "./path-exclusions.js";

export type { ParseFailure, SkippedFile } from "./scan.js";
export type { ExcludedPath, PathExclusion, PathExclusionFinding } from "./path-exclusions.js";

// --------------------------------------------------------------- walking

export interface AddressabilityScanOptions {
  /** File extensions to read, each including the leading dot. Default: `.ts`, `.tsx`, `.js`, `.jsx`. */
  extensions?: string[];
  /** Directory names never descended into. Default: node_modules, .git, dist, build, coverage. */
  skipDirs?: string[];
  /** Same mechanism `scan.ts`'s `ScanOptions.pathExclusions` uses — see `path-exclusions.ts`. */
  pathExclusions?: PathExclusion[];
}

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);

/** `.test.ts(x)`, `.spec.ts(x)`, `.check.ts(x)`, and bare `.d.ts` — the identical pattern `scan.ts` and `@vespeneventures/ui`'s `style-scan.ts` both use, reused verbatim rather than reinvented (not exported by `scan.ts`, so redefined locally here — the same precedent `style-scan.ts` sets for its own copy of this constant). */
const SKIP_FILE_RE = /\.(test|spec|check)\.(ts|tsx|js|jsx)$|\.d\.ts$/;

export type AddressabilityPosition = "markup-text" | "user-facing-attribute";

export interface AddressabilityViolation {
  file: string;
  line: number;
  position: AddressabilityPosition;
  /** Set only for `"user-facing-attribute"` — which of the four this literal was the value of. */
  attribute?: "aria-label" | "placeholder" | "alt" | "title";
  /** The literal's own raw source text, for a human auditing the finding. */
  raw: string;
}

export interface AddressabilityUncheckedItem {
  file: string;
  line: number;
  /** A short, stable machine-readable name — see this file's top doc comment, category 3, and `extractAddressabilityCandidates`'s own inline comments for every kind this can be. */
  kind: string;
  detail: string;
}

export interface AddressabilityScanResult {
  /** Files whose content was successfully tokenized. Required to be > 0 for a satisfied verdict — see this file's top doc comment, "THE TERNARY". */
  filesScanned: number;
  violations: AddressabilityViolation[];
  /** Every string position this gate could not confidently classify — never silently dropped. See this file's top doc comment, category 3. */
  unchecked: AddressabilityUncheckedItem[];
  skippedByDesign: SkippedFile[];
  parseFailures: ParseFailure[];
  excludedFiles: ExcludedPath[];
  pathExclusionFindings: PathExclusionFinding[];
}

/**
 * Walks `root` recursively, reads every matching file, and extracts
 * addressability violations/unchecked positions from each (see
 * `extractAddressabilityCandidates`). FAILS CLOSED on an unreadable
 * directory or file — throws a plain `Error`, matching `scan.ts`'s
 * `scanCopySourceTree` exactly, for the identical reason: a directory this
 * function could not read might be hiding an unknown amount of inline
 * prose, and reporting "0 files scanned" for that case would read as a
 * clean pass when nothing was actually verified.
 */
export function scanAddressabilitySources(root: string, options: AddressabilityScanOptions = {}): AddressabilityScanResult {
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
  const skipDirs = new Set(options.skipDirs ?? DEFAULT_SKIP_DIRS);

  const pathExclusionValidation = validatePathExclusions(options.pathExclusions);
  const matchCounts = new Map<ValidatedPathExclusion, number>();
  for (const exclusion of pathExclusionValidation.valid) matchCounts.set(exclusion, 0);

  const result: AddressabilityScanResult = {
    filesScanned: 0,
    violations: [],
    unchecked: [],
    skippedByDesign: [],
    parseFailures: [],
    excludedFiles: [],
    pathExclusionFindings: [...pathExclusionValidation.findings],
  };

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      throw new Error(
        `scanAddressabilitySources: cannot read directory "${dir}": ${error instanceof Error ? error.message : String(error)}`,
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

      let matchedExclusion: ValidatedPathExclusion | undefined;
      for (const exclusion of pathExclusionValidation.valid) {
        if (matchesPathExclusion(relPath, exclusion)) {
          matchCounts.set(exclusion, (matchCounts.get(exclusion) ?? 0) + 1);
          matchedExclusion ??= exclusion;
        }
      }
      if (matchedExclusion) {
        result.excludedFiles.push({ file: relPath, reason: matchedExclusion.reason, pattern: matchedExclusion.path });
        continue;
      }

      if (SKIP_FILE_RE.test(entry)) {
        result.skippedByDesign.push({ file: relPath, reason: "test-or-check-file" });
        continue;
      }

      let content: string;
      try {
        content = readFileSync(full, "utf8");
      } catch (error) {
        throw new Error(
          `scanAddressabilitySources: cannot read file "${full}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const extracted = extractAddressabilityCandidates(content, relPath);
      if (extracted.parseFailure) {
        result.parseFailures.push({ file: relPath, detail: extracted.parseFailure });
        continue; // no positions trusted from a file scan.ts could not reliably tokenize
      }
      result.filesScanned++;
      result.violations.push(...extracted.violations);
      result.unchecked.push(...extracted.unchecked);
    }
  }

  walk(root);

  for (const exclusion of pathExclusionValidation.valid) {
    if ((matchCounts.get(exclusion) ?? 0) === 0) {
      result.pathExclusionFindings.push({
        rule: "path-exclusion-unused",
        severity: "warning",
        message: `pathExclusions entry "${exclusion.path}" (reason: "${exclusion.reason}") did not match any scanned file. Remove it, or check for a typo/renamed path.`,
        path: exclusion.path,
      });
    }
  }

  return result;
}

// ------------------------------------------------------------- extraction

/** `ariaLabel` -> `arialabel`, `aria-label` -> `arialabel` — the identical case/hyphen-insensitive normalization `scan.ts`'s own `normalizeIdentifier` performs (not exported, so reimplemented locally — a one-line heuristic, not worth a cross-file dependency). */
function normalizeAttrName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/-/g, "");
}

function hasProse(text: string): boolean {
  return /\p{L}/u.test(text.trim());
}

/**
 * Finds the identifier immediately before `raw` on its own source line —
 * `raw` INCLUDES its own quotes, exactly as `scan.ts` slices it, so
 * `lineText.indexOf(raw)` lands on the literal's own opening quote. Safe
 * ONLY for a plain string literal: `scan.ts`'s `scanStringLiteral` never
 * lets a string span a raw newline (an unterminated string ends the
 * literal at end-of-line instead), so a single-line lookup is exact here,
 * never an approximation — unlike a template literal, which CAN span
 * multiple lines and is never passed through this function (see
 * `extractAddressabilityCandidates`, which routes every template literal
 * straight to `unchecked` without ever attempting this lookup).
 */
function attributeNameFor(lines: string[], line: number, raw: string): string | undefined {
  const lineText = lines[line - 1];
  if (lineText === undefined) return undefined;
  const idx = lineText.indexOf(raw);
  if (idx === -1) return undefined;
  const prefix = lineText.slice(0, idx);
  const match = /([A-Za-z_$][A-Za-z0-9_$-]*)\s*=\s*\{?\s*$/.exec(prefix);
  return match?.[1];
}

/**
 * How many lines of LEADING context `isDestructuringOrParameterDefault`
 * looks back through to find the `{`/`(`/`,` that precedes a destructured
 * property or parameter — each property in a real multi-line destructure
 * (see `Pagination.tsx`'s own `PaginationProps` destructure) is normally
 * its own line, so the delimiter is usually one line up, on the PRIOR
 * property's trailing comma. A small, bounded window, not an attempt to
 * parse the whole enclosing pattern.
 */
const DESTRUCTURING_CONTEXT_LINES = 5;

/**
 * `{`/`(` (the pattern's or parameter list's own opening delimiter) or a
 * bare `,` (separating this property/parameter from the previous one),
 * optionally preceded by a rename (`identifier:` or `"quoted-key":`, for
 * `{ "aria-label": ariaLabel = "..." }`), then the bound identifier
 * itself and `=` — anchored at the END of the search text, matching
 * exactly what precedes a destructuring-pattern DEFAULT VALUE or a plain
 * (non-destructured) parameter default. Deliberately does NOT match
 * through any OTHER non-whitespace token: if something this narrow
 * heuristic cannot account for sits between the delimiter and the
 * identifier, the match simply fails and `isDestructuringOrParameterDefault`
 * returns `false`, falling back to the pre-existing (JSX-attribute)
 * assumption rather than guessing.
 */
const DESTRUCTURING_OR_PARAMETER_DEFAULT_RE =
  /[{(,]\s*(?:(?:"[^"]*"|'[^']*'|[A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*)?[A-Za-z_$][A-Za-z0-9_$-]*\s*=\s*\{?\s*$/;

/**
 * Whether the `identifier =` assignment `attributeNameFor` found
 * immediately before `raw` is actually a DESTRUCTURING-PATTERN DEFAULT
 * (`{ label = "Save" }`, or renamed `{ "aria-label": ariaLabel = "Save"
 * }`) or a plain, non-destructured PARAMETER DEFAULT (`function
 * f(ariaLabel = "Save")`) — never a JSX attribute assignment at all
 * (`aria-label="Save"`). `attributeNameFor`'s own regex cannot tell these
 * apart on its own: both are exactly `identifier = "..."` in the raw
 * source text it looks at. They ARE distinguishable, though, by what
 * immediately precedes the identifier once an optional rename is skipped
 * over: a JSX attribute is always preceded by a tag name, another
 * attribute's already-finished value, or `<` itself — NEVER by `{`, `(`,
 * or `,`. A destructuring pattern's own property, or a parameter list's
 * own argument, is ALWAYS preceded by exactly one of those three (`{`/`(`
 * for the first property/argument, `,` for every one after) — JSX
 * attributes, by contrast, are never comma-separated, and neither a
 * pattern nor a parameter list opens with `<`. See
 * `DESTRUCTURING_OR_PARAMETER_DEFAULT_RE`'s own doc comment for exactly
 * what is and is not matched.
 */
function isDestructuringOrParameterDefault(lines: string[], line: number, raw: string): boolean {
  const lineText = lines[line - 1];
  if (lineText === undefined) return false;
  const idx = lineText.indexOf(raw);
  if (idx === -1) return false;
  const start = Math.max(0, line - 1 - DESTRUCTURING_CONTEXT_LINES);
  const context = [...lines.slice(start, line - 1), lineText.slice(0, idx)].join("\n");
  return DESTRUCTURING_OR_PARAMETER_DEFAULT_RE.test(context);
}

/**
 * Each token in a CSS/Tailwind-shaped utility class LIST: an optional
 * leading `-` (negative utilities, e.g. `-mt-2`), a lowercase
 * alphanumeric run, then one or more `-`/`:`/`/`-separated lowercase
 * alphanumeric segments — `border-t`, `border-line-base`, `pt-xs`,
 * `grid-cols-1`, `tablet:grid-cols-2` all match; a bare English word
 * (`flex`, `hidden`, `low`, `open`) does NOT, because it has no separated
 * segment at all (the trailing group requires at least one repetition).
 * That asymmetry is deliberate — see `looksLikeUtilityClassList`'s own
 * doc comment.
 */
const CLASS_TOKEN_RE = /^-?[a-z0-9]+(?:[:/-][a-z0-9.]+)+$/;

/**
 * Whether `raw` (a plain string literal's own raw source text, quotes
 * included — never a template literal, see this function's call site)
 * is shaped like a space-separated list of CSS/Tailwind utility class
 * names rather than prose. `scan.ts` already excludes this exact shape
 * when the literal sits in an actual `className` ATTRIBUTE (see this
 * file's top doc comment, "THREE POSITIONS"); this catches the SAME
 * shape one level removed — a class list assigned to a variable or
 * sitting in an object-literal value (`Faq.tsx`'s `"border-t
 * border-line-base pt-xs"`, `FieldGroup.tsx`'s `"grid-cols-1
 * tablet:grid-cols-2"`) — which has no attribute name for `scan.ts`'s own
 * exclusion to key off, and so reaches this file as an ordinary "string"
 * candidate instead.
 *
 * Deliberately conservative: EVERY token must match `CLASS_TOKEN_RE`,
 * which requires at least one `-`/`:`/`/`-separated segment — a shape a
 * hand-typed English sentence does not reliably have across every one of
 * its words, but a Tailwind utility name always does. A bare,
 * separator-free utility class (`"flex"`, `"hidden"`) mixed into such a
 * list still fails this check and is left `unchecked` rather than risk a
 * real short English word (`"low"`, `"open"`) being swept in as
 * definitively clean — an intentional under-classification, not an
 * oversight; see this file's own test suite.
 */
function looksLikeUtilityClassList(raw: string): boolean {
  const quote = raw[0];
  if (quote !== '"' && quote !== "'") return false; // a template literal never reaches this — see this function's call site
  const text = raw.slice(1, -1).trim();
  if (text.length === 0 || text.length > 300) return false;
  const tokens = text.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 40) return false;
  return tokens.every((t) => t.length <= 60 && CLASS_TOKEN_RE.test(t));
}

interface AddressabilityExtractResult {
  violations: AddressabilityViolation[];
  unchecked: AddressabilityUncheckedItem[];
  parseFailure?: string;
}

/**
 * Pure — no I/O. Classifies every string/template literal and JSX text
 * node `scan.ts`'s `extractCopyCandidates` finds in `content` into one of
 * this file's three positions (see top doc comment). Exported so a test
 * can exercise classification directly against a source-text fixture,
 * mirroring `extractCopyCandidates` itself.
 */
export function extractAddressabilityCandidates(content: string, filePath: string): AddressabilityExtractResult {
  const { candidates, excluded, unchecked: jsxUnchecked, parseFailure } = extractCopyCandidates(content, filePath);
  if (parseFailure) return { violations: [], unchecked: [], parseFailure };

  const lines = content.split("\n");
  const violations: AddressabilityViolation[] = [];
  const unchecked: AddressabilityUncheckedItem[] = [];

  // JSX constructs scan.ts itself recognized but could not resolve
  // (unclosed elements, unterminated attribute values/expressions, ...) —
  // passed through unchanged. A region scan.ts could not classify is a
  // region THIS gate cannot classify either.
  for (const u of jsxUnchecked) {
    unchecked.push({ file: u.file, line: u.line, kind: u.kind, detail: u.detail });
  }

  // ---- position 1: markup text nodes — always a violation ----
  for (const c of candidates) {
    if (c.kind !== "jsx-text") continue;
    violations.push({ file: c.file, line: c.line, position: "markup-text", raw: c.raw });
  }

  // ---- position 2a: aria-label, recovered from scan.ts's own excluded
  // "aria-or-data-attribute-value" bucket, which bundles it together with
  // every OTHER aria-*/data-* attribute (see this file's top doc comment).
  for (const e of excluded) {
    if (e.reason !== "aria-or-data-attribute-value") continue;
    // scan.ts's own attribute-name check (which decided this literal
    // belongs here) runs identically regardless of quote kind, so this
    // bucket can contain either a plain string OR a template literal —
    // `attributeNameFor`'s single-line lookup is safe for both here
    // specifically because a template literal used as an ATTRIBUTE VALUE
    // is always `name={`...`}` on one line in practice (a multi-line one
    // would fail this lookup and fall into "unresolved-attribute-name"
    // below, never silently misattributed).
    const attrName = attributeNameFor(lines, e.line, e.raw);
    if (attrName === undefined) {
      // scan.ts confirmed this literal sits in an aria-*/data-* attribute
      // position, but this file's own (deliberately simpler, JSX-only)
      // lookup could not re-derive which one — never silently dropped.
      unchecked.push({
        file: e.file,
        line: e.line,
        kind: "unresolved-attribute-name",
        detail: `an aria-*/data-* attribute value ${e.raw} could not be traced back to its own attribute name on the same line`,
      });
      continue;
    }
    if (normalizeAttrName(attrName) !== "arialabel") continue; // a different aria-*/data-* attribute — out of this gate's scope, same as scan.ts's own traceability gate
    if (isDestructuringOrParameterDefault(lines, e.line, e.raw)) continue; // a default value the consumer can override, not a JSX attribute at all — see isDestructuringOrParameterDefault
    if (e.raw.startsWith("`")) {
      // A template literal in the ONE attribute this gate DOES track —
      // could carry an interpolated copy id or genuine inline prose, and
      // this gate does not attempt to tell those apart (see this file's
      // top doc comment, category 3). Indeterminate, never a violation.
      unchecked.push({
        file: e.file,
        line: e.line,
        kind: "template-literal",
        detail: `template literal ${e.raw} (aria-label) could carry an interpolated copy id, a partial sentence, or genuine inline prose — this gate does not attempt to tell those apart`,
      });
      continue;
    }
    if (!hasProse(e.raw)) continue; // e.g. aria-hidden-shaped booleans/empty values that happened to still match the aria/data check
    violations.push({ file: e.file, line: e.line, position: "user-facing-attribute", attribute: "aria-label", raw: e.raw });
  }

  // ---- position 2b: placeholder/alt/title — not aria/data-shaped and not
  // on scan.ts's structural denylist, so these are already ordinary
  // default-included "string" candidates. Reclassified here rather than
  // left to fall through to position 3 below.
  const claimed = new Set<string>();
  for (const c of candidates) {
    if (c.kind !== "string") continue;
    const attrName = attributeNameFor(lines, c.line, c.raw);
    if (attrName === undefined) continue;
    const normalized = normalizeAttrName(attrName);
    // "arialabel" never reaches this branch in practice — scan.ts already
    // routed it into `excluded` (see position 2a above) before it could
    // ever become a "string"-kind candidate — but the explicit exclusion
    // documents that this loop is deliberately NOT the aria-label path.
    const attribute = (["placeholder", "alt", "title"] as const).find((n) => n === normalized);
    if (!attribute) continue;
    // Handled here either way (violation OR a default value excluded
    // below) — `claimed` marks it done so position 3 below never
    // re-examines it and reports it as unclassified instead.
    claimed.add(`${c.line}::${c.raw}`);
    if (isDestructuringOrParameterDefault(lines, c.line, c.raw)) continue; // a default value the consumer can override, not a JSX attribute at all — see isDestructuringOrParameterDefault
    violations.push({ file: c.file, line: c.line, position: "user-facing-attribute", attribute, raw: c.raw });
  }

  // ---- position 3: everything else scan.ts kept as a real candidate —
  // never silently treated as clean, never treated as a violation either
  // — except a plain string shaped like a utility class LIST, which is
  // definitively not prose (see looksLikeUtilityClassList).
  for (const c of candidates) {
    if (c.kind === "jsx-text") continue; // already position 1
    if (c.kind === "string" && claimed.has(`${c.line}::${c.raw}`)) continue; // already position 2
    if (c.kind === "string" && looksLikeUtilityClassList(c.raw)) continue; // a class-name list, not prose
    unchecked.push({
      file: c.file,
      line: c.line,
      kind: c.kind === "template" ? "template-literal" : "unclassified-string-position",
      detail:
        c.kind === "template"
          ? `template literal ${c.raw} could carry an interpolated copy id, a partial sentence, or genuine inline prose — this gate does not attempt to tell those apart`
          : `string ${c.raw} is not a JSX markup text node or one of aria-label/placeholder/alt/title — could be an object/array literal value or some other prop this gate does not classify`,
    });
  }

  return { violations, unchecked };
}

// ------------------------------------------------------------------- gate

export type AddressabilityVerdict = "satisfied" | "violated" | "indeterminate";

export interface AddressabilityGateResult {
  verdict: AddressabilityVerdict;
  violations: AddressabilityViolation[];
  unchecked: AddressabilityUncheckedItem[];
  filesScanned: number;
  /**
   * Human-readable reasons coverage is incomplete — empty for `"satisfied"`.
   * Since #407, this can be non-empty for `"violated"` too: a run can find a
   * definite violation AND have unclassified positions left over in the
   * same scan. Only `"indeterminate"` requires `reasons.length > 0`; a
   * `"violated"` verdict does not promise `reasons` is empty, only that at
   * least one real finding exists regardless of what else `reasons` lists.
   */
  reasons: string[];
}

/**
 * Pure — takes an already-computed `AddressabilityScanResult`, decides the
 * ternary verdict. Mirrors `copy-gate.ts`'s `checkCopyTraceability` split
 * from `scan.ts`: this function does no I/O and never throws.
 */
export function checkAddressability(scan: AddressabilityScanResult): AddressabilityGateResult {
  const reasons: string[] = [];

  if (scan.filesScanned === 0) {
    reasons.push(
      scan.parseFailures.length > 0
        ? "every matched file failed to parse — nothing was actually scanned"
        : "no components were scanned",
    );
  } else if (scan.parseFailures.length > 0) {
    reasons.push(`${scan.parseFailures.length} matched file(s) could not be parsed and were never examined`);
  }

  const invalidPathExclusions = scan.pathExclusionFindings.filter((f) => f.severity === "error");
  if (invalidPathExclusions.length > 0) {
    reasons.push(
      `${invalidPathExclusions.length} pathExclusions entr${invalidPathExclusions.length === 1 ? "y is" : "ies are"} invalid`,
    );
  }

  if (scan.unchecked.length > 0) {
    reasons.push(`${scan.unchecked.length} string position(s) could not be confidently classified`);
  }

  const base = { violations: scan.violations, unchecked: scan.unchecked, filesScanned: scan.filesScanned };

  // A real finding wins over an incomplete picture — see this file's top
  // doc comment, "THE TERNARY", and issue #407. Deliberately the OPPOSITE
  // of copy-gate.ts's/scan.ts's "a 2 gates before findings are counted"
  // precedence: on THIS gate, partial coverage (category 3's unclassified
  // positions) is the PERMANENT state of any real tree, so letting it
  // outrank a violation makes "violated" unreachable outside a fixture.
  // The coverage gap is not lost by returning "violated" here — `reasons`
  // is still populated below and still printed unconditionally by
  // `cli.ts`'s `printAddressabilityAccounting`; only the verdict/exit-code
  // changes.
  if (scan.violations.length > 0) return { verdict: "violated", reasons, ...base };
  if (reasons.length > 0) return { verdict: "indeterminate", reasons, ...base };
  return { verdict: "satisfied", reasons, ...base };
}
