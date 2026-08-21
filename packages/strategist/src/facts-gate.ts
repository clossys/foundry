/**
 * `checkFactsTraceability` — the gate that makes the schema in `schema.ts`
 * worth having. Pure: takes already-read file contents and an already-built
 * `FactIndex` (see `fact-index.ts`), does no I/O of its own, and never
 * throws on any input shape — the same discipline `evaluateCatalog` holds
 * to in `@vespeneventures/catalog`. `scanStrategyDirectory` (see `scan.ts`)
 * is the I/O half that gathers `ScannedFile[]` from a real directory.
 *
 * THE RULE, in one sentence: a currency amount, percentage, multiplier, or
 * large/labelled count, and a small closed set of absolute/superlative
 * phrases ("the only", "the first", "the largest", ...), must either
 * literally match a registered fact's value or alias, or be annotated with
 * a `fact:<key>` comment citing a real entry in `facts.json` on the same
 * line — anything else is reported as untraced.
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH, and why:
 *
 *   - Bare small numbers with no currency/percent/multiplier/grouping/unit
 *     word ("Step 3", "React 18", a port number, a heading numeral). The
 *     alternative — flagging every digit — was rejected explicitly: a gate
 *     that fires on every digit in every sentence gets disabled, and a
 *     disabled gate protects nothing. This gate would rather miss a genuine
 *     but oddly-phrased claim than train its own consumers to ignore it.
 *   - Free-form named claims ("our biggest customer is Acme Corp") that
 *     aren't shaped like one of the closed superlative phrases below. Open-
 *     ended named-entity recognition is a different, much harder problem
 *     (and a much noisier one) than this gate takes on; the superlative
 *     list instead targets the specific, high-risk phrasing pattern where
 *     an absolute claim is made WITHOUT necessarily naming a number at all
 *     ("the only platform that...", "the fastest-growing..."). A named
 *     claim that isn't phrased this way is out of scope, full stop — see
 *     the package README's "Non-goals" section.
 *   - Anything inside a fenced code block or inline code span, or an
 *     `http(s)://` URL. Numbers there are code, not claims about the
 *     product.
 */

import { buildFactIndex, isTracedSurfaceForm, type FactIndex } from "./fact-index.js";
import type { Fact } from "./schema.js";

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

const NUMERIC_CLAIM_RE = new RegExp(
  [
    String.raw`[$€£]\s?\d[\d,]*(?:\.\d+)?\s?[kKmMbB]?\b`, // currency: $4.2M, $250,000, €99
    String.raw`\b\d+(?:\.\d+)?\s?%`, // percent: 12%, 4.5 %
    String.raw`\b\d+(?:\.\d+)?[xX]\b`, // multiplier: 10x, 3.5x
    String.raw`\b\d{1,3}(?:,\d{3})+\b`, // grouped count: 500,000
    String.raw`\b\d+(?:\.\d+)?\s?(?:million|billion|thousand)\b`, // spelled-out magnitude
    String.raw`\b\d+(?:\.\d+)?\s?(?:${UNIT_WORDS})\b`, // count + business unit word
  ].join("|"),
  "gi",
);

const SUPERLATIVE_RE =
  /\b(the only|the first|the largest|the smallest|the fastest[- ]growing|the leading|world'?s first|industry[- ]first)\b|#1\b/gi;

// `fact:<key>` inside an HTML comment, a block comment, a JSX comment, or a
// line comment — deliberately loose about the closing delimiter (only the
// opener plus "fact:<key>" is required) so a stray missing `-->` doesn't
// silently defeat the citation.
const FACT_CITATION_RE = /(?:<!--|\/\*|\{\/\*|\/\/)\s*fact:([a-zA-Z][a-zA-Z0-9-]*)/g;
const IGNORE_MARKER_RE = /(?:<!--|\/\*|\{\/\*|\/\/)\s*facts-gate:ignore/i;

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

// ------------------------------------------------------------------- scan

/**
 * Scans `files` for claim-shaped prose and evaluates each claim against
 * `facts`. Never throws: a `Fact[]` that is empty is valid input (every
 * claim in `files` will simply be untraced), and any file content — however
 * malformed — is scanned as plain text with no assumption about its shape.
 */
export function checkFactsTraceability(files: ScannedFile[], facts: Fact[]): FactsGateResult {
  const index: FactIndex = buildFactIndex(facts);
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
            message: `cites fact "${key}", which does not exist in facts.json — a citation to a rotted or misspelled key silently defeats this gate`,
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

      const scannable = blank(blank(rawLine, INLINE_CODE_RE), URL_RE);

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
              ? `"${text.trim()}" does not match any fact's value or alias in facts.json, and the line carries no valid "fact:<key>" citation`
              : `"${text.trim()}" is an absolute/superlative claim with no valid "fact:<key>" citation on the same line`,
          snippet: snippetOf(rawLine),
        });
      }
    }
  }

  return { findings, ignored, filesScanned: files.length, claimsScanned };
}
