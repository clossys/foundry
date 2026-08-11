/**
 * `checkCopyTraceability` — the gate that makes `scan.ts`'s extraction
 * worth having. Pure: takes already-extracted `CopyCandidate[]`/
 * `Citation[]` (see `scan.ts`) and an already-loaded `CopyRecord` (see
 * `./types.js`), does no I/O of its own, and never throws on any input
 * shape — the same discipline `@vespeneventures/strategy`'s
 * `checkFactsTraceability` holds to in `facts-gate.ts`. `scanCopySourceTree`
 * (see `scan.ts`) is the half that gathers candidates/citations from a
 * real directory; `cli.ts` is what loads a real `CopyRecord` from disk
 * (via the sibling `registry.ts`) and turns this function's result into an
 * exit code.
 *
 * THE RULE, in one sentence: every user-facing string or template literal
 * `scan.ts` extracts from a source tree must either match a registered
 * `CopyEntry.text` (compared by STATIC SHAPE — interpolations collapsed to
 * `PLACEHOLDER_SENTINEL` on both sides, so a source literal's actual
 * expression content and a registered entry's placeholder NAMES never
 * need to agree) or be annotated with a `copy:<id>` comment citing a real
 * entry in the record on the same line — anything else is reported as
 * untraced. This is `@vespeneventures/strategy`'s `fact:<key>` citation
 * pattern, applied to copy instead of facts.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, and why:
 *
 *   - It does not decide what counts as a "user-facing string" at all —
 *     that classification (and every excluded category: import
 *     specifiers, object keys, `aria-*`/`data-*` values, class-name
 *     builder arguments, developer diagnostics, decorative glyphs, enum
 *     tokens, ...) already happened in `scan.ts`, which is the file with
 *     the actual judgment calls and the comment explaining each one. This
 *     file only ever sees candidates `scan.ts` already decided are
 *     in-scope; it has no opinion of its own about scope.
 *   - It does not scan raw source text for `copy:<id>` citations or
 *     `copy-gate:ignore` markers itself — `scan.ts` already did that (see
 *     its `scanLineMarkers`) while it had the file's content in hand, and
 *     attached the result to each `CopyCandidate`/the scan's flat
 *     `Citation[]`. This file only ever looks those up against a
 *     `CopyRecord`'s real ids.
 *   - It does not validate the `CopyRecord` itself (a placeholder declared
 *     but missing from its own entry's `text`, a malformed id, a
 *     duplicate id) — that is `schema.ts`'s job, upstream of this
 *     function ever being called. A `CopyRecord` that reaches this
 *     function is assumed already well-formed; `cli.ts` is responsible for
 *     refusing to call this function at all on one that isn't (see its own
 *     exit-code discipline).
 *   - It does not resolve a `CopyEntry.factRef` against a real facts
 *     registry — the exact same deliberately-left-open seam
 *     `@vespeneventures/copy/voice`'s `Claim.factRef` and this package's own
 *     `CopyEntry.factRef` both describe in their doc comments. A gate with
 *     visibility into both a `CopyRecord` and a real facts registry is a
 *     different, later gate.
 */

import { PLACEHOLDER_SENTINEL, type Citation, type CopyCandidate, type UncheckedItem } from "./scan.js";
import type { CopyRecord } from "./types.js";

export type CopyGateRule = "unregistered-copy" | "unknown-copy-citation";

export interface CopyGateFinding {
  rule: CopyGateRule;
  /** Always `"error"` — the same single-severity design `@vespeneventures/strategy`'s `FactsGateFinding` uses: a piece of copy is either traced to a registered entry or it isn't. */
  severity: "error";
  file: string;
  line: number;
  message: string;
  /** The literal's raw source text (quotes included), trimmed/length-capped, for a human scanning a report. */
  snippet: string;
}

export interface CopyGateIgnored {
  file: string;
  line: number;
  snippet: string;
}

export interface CopyGateResult {
  findings: CopyGateFinding[];
  /** Every candidate explicitly suppressed via a `copy-gate:ignore` marker on its own source line — recorded, never silent. */
  ignored: CopyGateIgnored[];
  /** Echoed straight from `ScanResult.filesScanned` (see `scan.ts`) so a caller/report has one number to check for "at least one file scanned" without re-deriving it from `candidates`, which could legitimately be empty even for a real, successful scan. */
  filesScanned: number;
  /** Total candidates evaluated — a sanity total, the same role `FactsGateResult.claimsScanned` plays: lets a caller tell "zero findings because nothing looked like copy" apart from "zero findings because every candidate traced cleanly". */
  candidatesScanned: number;
  /** Candidates that matched a registered entry's text shape or a valid `copy:<id>` citation. */
  matched: number;
  /**
   * Echoed straight from `ScanResult.unchecked` (see `scan.ts`) —
   * constructs the scanner recognized as JSX-shaped but could not
   * classify. This is passed through UNCHANGED, never filtered or
   * summarized away: a caller that reads `findings` and ignores this
   * field can end up exactly where issue #37 started — reporting a clean
   * result over a file part of which was never actually examined.
   * `cli.ts` is the one that turns a non-empty list here into something
   * an operator cannot miss; see its own doc comment for exactly where
   * that lands in the exit-code contract.
   */
  unchecked: UncheckedItem[];
}

/** The same `{name}` brace-delimited placeholder convention `schema.ts` checks `CopyEntry.text` against — collapsed here to the identical sentinel `scan.ts` uses for a source literal's `${...}` interpolations, so the two sides compare as the same shape regardless of what name either side chose. */
const ENTRY_PLACEHOLDER_RE = /\{[^{}]+\}/g;

function normalizeEntryText(text: string): string {
  return text.replace(ENTRY_PLACEHOLDER_RE, PLACEHOLDER_SENTINEL);
}

function snippetOf(text: string, max = 120): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

interface CopyIndex {
  byId: Set<string>;
  byNormalizedText: Set<string>;
}

function buildCopyIndex(record: CopyRecord): CopyIndex {
  const byId = new Set<string>();
  const byNormalizedText = new Set<string>();
  for (const entry of record.entries) {
    byId.add(entry.id);
    byNormalizedText.add(normalizeEntryText(entry.text));
  }
  return { byId, byNormalizedText };
}

/**
 * Evaluates every `candidate` against `record`, using `citations` for the
 * "cites an id that does not exist" check. Never throws: an `entries`
 * array that is empty is valid input (every candidate will simply be
 * untraced), and a `CopyCandidate[]`/`Citation[]` produced from any file
 * content — however unusual — is evaluated with no assumption about its
 * shape beyond what `scan.ts`'s own types already guarantee. `unchecked`
 * is required, not optional, and passed straight through onto
 * `CopyGateResult.unchecked` unmodified — a caller cannot construct a
 * `CopyGateResult` from this function while accidentally forgetting that
 * field exists.
 */
export function checkCopyTraceability(
  candidates: CopyCandidate[],
  citations: Citation[],
  record: CopyRecord,
  filesScanned: number,
  unchecked: UncheckedItem[],
): CopyGateResult {
  const index = buildCopyIndex(record);
  const findings: CopyGateFinding[] = [];
  const ignored: CopyGateIgnored[] = [];
  let matched = 0;

  // Pass 1: citations to a copy id that does not exist — checked over
  // EVERY citation found anywhere in the scanned tree, independent of
  // whether a candidate happens to share its line, mirroring
  // `@vespeneventures/strategy`'s `facts-gate.ts` Pass 1 (see `scan.ts`'s
  // `Citation` doc comment for why).
  for (const citation of citations) {
    if (!index.byId.has(citation.id)) {
      findings.push({
        rule: "unknown-copy-citation",
        severity: "error",
        file: citation.file,
        line: citation.line,
        message: `cites copy id "${citation.id}", which does not exist in the copy record — a citation to a rotted or misspelled id silently defeats this gate`,
        snippet: `copy:${citation.id}`,
      });
    }
  }

  // Pass 2: every candidate, traced or not.
  for (const candidate of candidates) {
    if (candidate.hasIgnoreMarker) {
      ignored.push({ file: candidate.file, line: candidate.line, snippet: candidate.raw });
      continue;
    }
    const hasValidCitation = candidate.citedIds.some((id) => index.byId.has(id));
    if (hasValidCitation || index.byNormalizedText.has(candidate.normalized)) {
      matched++;
      continue;
    }

    findings.push({
      rule: "unregistered-copy",
      severity: "error",
      file: candidate.file,
      line: candidate.line,
      message:
        candidate.kind === "template"
          ? `template literal ${candidate.raw} does not match any registered copy entry's text (shape-compared, interpolations ignored), and carries no valid "copy:<id>" citation`
          : candidate.kind === "jsx-text"
            ? `JSX text "${candidate.raw}" does not match any registered copy entry's text, and carries no valid "copy:<id>" citation`
            : `string ${candidate.raw} does not match any registered copy entry's text, and carries no valid "copy:<id>" citation`,
      snippet: snippetOf(candidate.raw),
    });
  }

  return { findings, ignored, filesScanned, candidatesScanned: candidates.length, matched, unchecked };
}
