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
 *    here (see this file's top comment for why).
 *
 * 3. EVERYTHING ELSE THIS GATE CANNOT CONFIDENTLY CLASSIFY — a template
 *    literal (in ANY position, including one of the four attributes above:
 *    a template can carry an interpolated copy id, a partial sentence, or
 *    genuine inline prose, and this gate does not attempt to tell those
 *    apart), an object/array literal VALUE (`scan.ts` only excludes object
 *    KEYS, never values — `{ tooltip: "Explain this" }`'s `"Explain
 *    this"` is a default-included candidate with no attribute name at
 *    all), or a plain string in a prop that is none of the four (a custom
 *    `tooltip`, a bare variable assignment, ...). NEVER silently treated
 *    as clean, and NEVER treated as a violation either — reported as
 *    `unchecked`, the same discipline `scan.ts`'s own `UncheckedItem` and
 *    `checkCopyTraceability`'s `unchecked` passthrough already hold JSX
 *    parse ambiguities to. A measurement may round an unknown down to "probably
 *    fine"; a gate may not — that is the whole reason this file exists
 *    rather than a grep for `aria-label="`.
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
 * Mirrors `copy-gate.ts`/`scan.ts`'s existing convention exactly: an
 * `unchecked[]` list gates a `2` BEFORE findings are counted, the same
 * "could not run [fully]" precedence `cli.ts` already documents and tests
 * for `copy-check` ("a partial parse failure outranks a real finding").
 *
 *   - `"indeterminate"` — the source tree could not be read at all (this
 *     file's `scanAddressabilitySources` fails closed, throwing, exactly
 *     like `scan.ts`'s `scanCopySourceTree`), ZERO components were
 *     successfully scanned (nothing matched, or every matched file failed
 *     to parse), a `pathExclusions` entry was malformed, or ANY string
 *     position could not be confidently classified (category 3 above, or a
 *     JSX construct `scan.ts` itself could not resolve). Wins over
 *     `"violated"` even when both are true in the same run — a partial
 *     picture is never allowed to read as a completed one just because it
 *     also happened to find something real.
 *   - `"violated"` — zero indeterminate positions, at least one inline
 *     user-facing prose string found (category 1 or 2 above).
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
    claimed.add(`${c.line}::${c.raw}`);
    violations.push({ file: c.file, line: c.line, position: "user-facing-attribute", attribute, raw: c.raw });
  }

  // ---- position 3: everything else scan.ts kept as a real candidate —
  // never silently treated as clean, never treated as a violation either.
  for (const c of candidates) {
    if (c.kind === "jsx-text") continue; // already position 1
    if (c.kind === "string" && claimed.has(`${c.line}::${c.raw}`)) continue; // already position 2
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
  /** Human-readable reasons the verdict is `"indeterminate"` — empty for `"satisfied"`/`"violated"`. */
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

  // unchecked/zero-scanned/invalid-config wins over a real finding — the
  // same "a 2 gates before findings are counted" precedence copy-gate.ts's
  // and scan.ts's own doc comments describe, and cli.test.ts's
  // "a partial parse failure outranks a real finding" test already proves
  // for copy-check.
  if (reasons.length > 0) return { verdict: "indeterminate", reasons, ...base };
  if (scan.violations.length > 0) return { verdict: "violated", reasons, ...base };
  return { verdict: "satisfied", reasons, ...base };
}
