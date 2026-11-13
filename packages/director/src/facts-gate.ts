/** Grounding scans numeric and superlative claims against findings.
 * Numeric detection, citation matching, ignores and CSS masking retain their
 * established behavior. Finding values, units and aliases provide evidence.
 */

import { buildFactIndex, isTracedSurfaceForm, type FactIndex } from "./fact-index.js";
import type { Finding } from "./format/types.js";

export interface ScannedFile {
  /** A stable label for this file in reported findings — typically a repo-relative path. Never interpreted as a real filesystem path by this function. */
  path: string;
  content: string;
}

export type FactsGateRule = "untraced-numeric-claim" | "untraced-superlative-claim" | "unknown-fact-citation";

export interface FactsGateFinding {
  rule: FactsGateRule;
  /** Always `"error"` — every rule this gate has is a hard failure; there is no warning tier. A claim either traces to a fact or it doesn't. */
  severity: "error";
  file: string;
  line: number;
  message: string;
  /** The matched text or line, trimmed and length-capped, for a human scanning a report. */
  snippet: string;
}

export interface FactsGateIgnored {
  file: string;
  line: number;
  snippet: string;
}

export interface FactsGateResult {
  findings: FactsGateFinding[];
  /** Every claim explicitly suppressed via a `facts-gate:ignore` marker — recorded, never silent. See this file's doc comment and the README's "Escape hatch" section. */
  ignored: FactsGateIgnored[];
  filesScanned: number;
  /** Total claim-shaped matches found across every scanned file, traced or not — a sanity total, so a caller can tell "zero findings because nothing looked like a claim" apart from "zero findings because every claim traced cleanly". */
  claimsScanned: number;
}

export interface FactsGateOptions {
  /**
   * When true, percentage literals inside CSS/style construction contexts are
   * scanned like prose claims. Default false — `color-mix()` mixes,
   * `style={{…}}` values, and declaration-shaped `prop: N%` fragments are
   * not audience-facing claims.
   */
  scanStyleLiterals?: boolean;
}

// --------------------------------------------------------------- matchers

const UNIT_WORDS = [
  "users",
  "customers",
  "employees",
  "countries",
  "downloads",
  "installs",
  "installations",
  "transactions",
  "partners",
  "clients",
  "subscribers",
  "companies",
  "offices",
  "markets",
  "merchants",
  "vendors",
  "locations",
  "stores",
  "branches",
  "teams",
  "members",
].join("|");

const CATALOGUE_COUNT_UNIT_WORDS = "packages|records";

const NUMERIC_CLAIM_RE = new RegExp(
  [
    String.raw`[$€£]\s?\d[\d,]*(?:\.\d+)?\s?[kKmMbB]?\b`, // currency: $4.2M, $250,000, €99
    String.raw`\b\d+(?:\.\d+)?\s?%`, // percent: 12%, 4.5 %
    String.raw`\b\d+(?:\.\d+)?[xX]\b`, // multiplier: 10x, 3.5x
    String.raw`\b\d{1,3}(?:,\d{3})+\b`, // grouped count: 500,000
    String.raw`\b\d+(?:\.\d+)?\s?(?:million|billion|thousand)\b`, // spelled-out magnitude
    String.raw`\b\d+(?:\.\d+)?\s?(?:${UNIT_WORDS})\b`, // count + business unit word
    String.raw`\b(?:twenty-one|twenty|\d+)\s+(?:${CATALOGUE_COUNT_UNIT_WORDS})\b`, // catalogue-count: spelled or digit + packages/records
  ].join("|"),
  "gi",
);

const SUPERLATIVE_RE =
  /\b(the only|the first|the largest|the smallest|the fastest[- ]growing|the leading|world'?s first|industry[- ]first)\b|#1\b/gi;

// `fact:<key>` inside an HTML comment, a block comment, a JSX comment, or a
// line comment — deliberately loose about the closing delimiter (only the
// opener plus "fact:<key>" is required) so a stray missing `-->` doesn't
// silently defeat the citation.
const FACT_CITATION_RE = /(?:<!--|\/\*|\{\/\*|\/\/)\s*(?:fact|finding):([a-zA-Z][a-zA-Z0-9-]*)/g;
const IGNORE_MARKER_RE = /(?:<!--|\/\*|\{\/\*|\/\/)\s*facts-gate:ignore\b/i;

const FENCE_RE = /^\s*(```|~~~)/;
const INLINE_CODE_RE = /`[^`]*`/g;
const URL_RE = /https?:\/\/\S+/gi;

/** Replaces every character of each match with a space, preserving line length/columns without leaving scannable text behind. */
function blank(text: string, re: RegExp): string {
  return text.replace(re, (m) => " ".repeat(m.length));
}

function snippetOf(text: string, max = 120): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Blanks a `name(` … `)` call, including one nested paren level inside arguments. */
function blankBalancedCall(text: string, name: string): string {
  const opener = new RegExp(`\\b${name}\\s*\\(`, "gi");
  let result = "";
  let lastIndex = 0;
  for (const m of text.matchAll(opener)) {
    const start = m.index ?? 0;
    result += text.slice(lastIndex, start);
    let depth = 1;
    let i = start + m[0].length;
    while (i < text.length && depth > 0) {
      const ch = text[i] as string;
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      i += 1;
    }
    result += " ".repeat(i - start);
    lastIndex = i;
  }
  result += text.slice(lastIndex);
  return result;
}

const JSX_STYLE_ATTR_RE = /\bstyle=\{\{[\s\S]*?\}\}/g;
const HTML_STYLE_ATTR_RE = /\bstyle=(?:"[^"]*"|'[^']*')/gi;
/** Removes style-literal regions where a trailing `%` is a dimension, not a claim. */
function blankStyleLiteralRegions(text: string): string {
  let out = blankBalancedCall(text, "color-mix");
  out = blankBalancedCall(out, "clamp");
  out = blankBalancedCall(out, "calc");
  out = out.replace(JSX_STYLE_ATTR_RE, (m) => " ".repeat(m.length));
  out = out.replace(HTML_STYLE_ATTR_RE, (m) => " ".repeat(m.length));
  out = blankCssDeclPercents(out);
  return out;
}

// ------------------------------------------------------------------- scan

/**
 * Scans `files` for claim-shaped prose and evaluates each claim against
 * `facts`. Never throws: a finding registry that is empty is valid input (every
 * claim in `files` will simply be untraced), and any file content — however
 * malformed — is scanned as plain text with no assumption about its shape.
 */
export function checkGrounding(
  files: ScannedFile[],
  facts: readonly Finding[],
  options: FactsGateOptions = {},
): FactsGateResult {
  const scanStyleLiterals = options.scanStyleLiterals === true;
  const index: FactIndex<Finding> = buildFactIndex(facts);
  const findings: FactsGateFinding[] = [];
  const ignored: FactsGateIgnored[] = [];
  let claimsScanned = 0;

  for (const file of files) {
    const lines = file.content.split("\n");
    let inFence = false;

    // Pass 1: citations to a fact key that does not exist — checked over
    // every line regardless of fence state, since a stray citation is a
    // structural problem (a rotted or typo'd key) even inside a code block.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      for (const m of line.matchAll(FACT_CITATION_RE)) {
        const key = m[1] as string;
        if (!index.byKey.has(key)) {
          findings.push({
            rule: "unknown-fact-citation",
            severity: "error",
            file: file.path,
            line: i + 1,
            message: `cites fact "${key}", which does not exist in the supplied evidence — a citation to a rotted or misspelled key silently defeats this gate`,
            snippet: snippetOf(line),
          });
        }
      }
    }

    // Pass 2: claim-shaped matches, fence/code/URL-aware.
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i] as string;

      if (FENCE_RE.test(rawLine)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;

      const hasIgnore = IGNORE_MARKER_RE.test(rawLine);
      const citedKeys = [...rawLine.matchAll(FACT_CITATION_RE)].map((m) => m[1] as string);
      const hasValidCitation = citedKeys.some((k) => index.byKey.has(k));

      let scannable = blank(blank(rawLine, INLINE_CODE_RE), URL_RE);
      if (!scanStyleLiterals) {
        scannable = blankStyleLiteralRegions(scannable);
      }

      const matches = [
        ...[...scannable.matchAll(NUMERIC_CLAIM_RE)].map((m) => ({ text: m[0], rule: "untraced-numeric-claim" as const })),
        ...[...scannable.matchAll(SUPERLATIVE_RE)].map((m) => ({ text: m[0], rule: "untraced-superlative-claim" as const })),
      ];

      for (const { text, rule } of matches) {
        claimsScanned++;

        if (hasIgnore) {
          ignored.push({ file: file.path, line: i + 1, snippet: snippetOf(rawLine) });
          continue;
        }
        if (hasValidCitation) continue;
        if (isTracedSurfaceForm(index, text.trim())) continue;

        findings.push({
          rule,
          severity: "error",
          file: file.path,
          line: i + 1,
          message:
            rule === "untraced-numeric-claim"
              ? `"${text.trim()}" does not match any finding's value, unit form or alias, and the line carries no valid "finding:<id>" citation`
              : `"${text.trim()}" is an absolute/superlative claim with no valid "finding:<id>" citation on the same line`,
          snippet: snippetOf(rawLine),
        });
      }
    }
  }

  return { findings, ignored, filesScanned: files.length, claimsScanned };
}

// Blanks declaration-shaped `prop: ... N%` regions, where a trailing `%` is a
// CSS dimension and not a claim.
//
// It returns exactly what this replace returns, with each match overwritten by
// spaces of the same length:
//
//   /\b[\w-]+\s*:\s*[^;`"'}\n]*(?<!\d)(?<!\d\.)\d+(?:\.\d+)*\s*%/g
//
// (the regex from #1680, which the package's tests keep as an oracle). The
// regex took quadratic time on a line with many declaration starts, because
// each start rescanned its whole segment. This is one forward pass over
// precomputed tables instead:
//
// - A match starts at the first word character of a `[\w-]+` run that is
//   followed by optional whitespace and a `:`.
// - Its middle cannot cross `;`, a backtick, `"`, `'`, `}` or a newline.
// - Its tail is a number (digits, then any number of `.digits` groups) that
//   starts at a number's first digit, then optional whitespace, then `%`. So
//   `a: 3% 50%` blanks through `50%`, `x: 1.2.3%` blanks, and `grid: 1fr 2 50%`
//   blanks.
// - The match ends at the last such tail before the segment ends. The tail is
//   found by table lookup, not by trying each position.

const CH_DOT = 46;
const CH_COLON = 58;
const CH_PERCENT = 37;

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

function isNameChar(c: number): boolean {
  return isWordChar(c) || c === 45;
}

function isWordChar(c: number): boolean {
  return isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

/** The characters the middle of a match cannot contain: `;` `` ` `` `"` `'` `}` and a newline. */
function isSegmentEnd(c: number): boolean {
  return c === 59 || c === 96 || c === 34 || c === 39 || c === 125 || c === 10;
}

/** The characters `\s` matches. */
function isSpace(c: number): boolean {
  return (
    c === 32 ||
    (c >= 9 && c <= 13) ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  );
}

export function blankCssDeclPercents(text: string): string {
  if (!text.includes("%")) return text;
  const n = text.length;

  // tailEnd[p] is the index just past the `%` when a valid tail starts at p,
  // else 0. lastTail[i] is the largest valid tail start below i, else -1.
  // segmentEnd[i] is the first segment-ending character at or after i, else n.
  const tailEnd = new Int32Array(n);
  const lastTail = new Int32Array(n + 1);
  const segmentEnd = new Int32Array(n + 1);

  lastTail[0] = -1;
  for (let p = 0; p < n; p++) {
    lastTail[p + 1] = lastTail[p] as number;
    if (!isDigit(text.charCodeAt(p))) continue;
    // Only a number's first digit starts a tail: not after a digit, and not
    // after `digit.` (the later groups of `1.2.3`). Each number is walked once.
    if (p >= 1 && isDigit(text.charCodeAt(p - 1))) continue;
    if (p >= 2 && text.charCodeAt(p - 1) === CH_DOT && isDigit(text.charCodeAt(p - 2))) continue;
    let j = p;
    while (j < n && isDigit(text.charCodeAt(j))) j++;
    while (j + 1 < n && text.charCodeAt(j) === CH_DOT && isDigit(text.charCodeAt(j + 1))) {
      j++;
      while (j < n && isDigit(text.charCodeAt(j))) j++;
    }
    while (j < n && isSpace(text.charCodeAt(j))) j++;
    if (j < n && text.charCodeAt(j) === CH_PERCENT) {
      tailEnd[p] = j + 1;
      lastTail[p + 1] = p;
    }
  }

  segmentEnd[n] = n;
  for (let i = n - 1; i >= 0; i--) {
    segmentEnd[i] = isSegmentEnd(text.charCodeAt(i)) ? i : (segmentEnd[i + 1] as number);
  }

  let out = "";
  let copied = 0;
  let pos = 0;
  while (pos < n) {
    while (pos < n && !isNameChar(text.charCodeAt(pos))) pos++;
    if (pos >= n) break;
    const runStart = pos;
    while (pos < n && isNameChar(text.charCodeAt(pos))) pos++;
    const runEnd = pos;

    let colon = runEnd;
    while (colon < n && isSpace(text.charCodeAt(colon))) colon++;
    if (colon >= n || text.charCodeAt(colon) !== CH_COLON) continue;

    let start = runStart;
    while (start < runEnd && !isWordChar(text.charCodeAt(start))) start++;
    if (start === runEnd) continue;

    let valueStart = colon + 1;
    while (valueStart < n && isSpace(text.charCodeAt(valueStart))) valueStart++;
    const tail = lastTail[segmentEnd[valueStart] as number] as number;
    if (tail <= colon) continue;

    const end = tailEnd[tail] as number;
    out += text.slice(copied, start) + " ".repeat(end - start);
    copied = end;
    pos = end;
  }
  return copied === 0 ? text : out + text.slice(copied);
}
