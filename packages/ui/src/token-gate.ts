/**
 * `checkTokenPurity` — the gate that makes `style-scan.ts`'s extraction
 * worth having, mirroring `@vespeneventures/copy`'s `copy-gate.ts` exactly:
 * pure (no I/O), takes already-extracted `StyleCandidate[]` (see
 * `style-scan.ts`) plus `@vespeneventures/tokens`' real `TOKENS` registry,
 * and never throws on any input shape. `scanStyleSources` is the half that
 * gathers candidates from a real directory; `cli.ts` is what imports the
 * real `TOKENS` registry and turns this function's result into an exit
 * code.
 *
 * THE RULE, in one sentence: every styling literal `style-scan.ts` extracts
 * is a FINDING unless it is explicitly waived (`token-gate:ignore` on its
 * own source line — see `style-scan.ts`'s `IGNORE_MARKER_RE`) — there is no
 * "this one's fine" classification a bare hex color, color function, or raw
 * length can earn on its own, because by definition every one of them
 * either duplicates a value `@vespeneventures/tokens` already expresses
 * (rule `"hardcodes-token-value"`) or hardcodes a value with no token
 * backing at all (rule `"raw-value-no-token-backing"`) — both are exactly
 * the failure mode this package exists to make visible, never invisible.
 *
 * THE ONE EXCEPTION, and it belongs to `"tw-arbitrary"` candidates alone: a
 * Tailwind arbitrary-value class whose bracket is EXACTLY a bare
 * `var(--custom-property)` reference, no fallback — `token-gate.ts` treats
 * this as CLEAN, not a finding. This is the documented "no Tailwind
 * namespace, raw `var()` only" escape hatch `@vespeneventures/tokens`'
 * README describes for values that have no Tailwind `@theme` namespace at
 * all (z-index, elevation, layout widths, ...) — see
 * `packages/ui/src/atoms/internal/ui-vars.ts`'s own header comment for the
 * real precedent. A bracket with ANY fallback
 * (`var(--ui-layout-sidebar-rail-w,64px)`) is still a finding: the fallback
 * is a real hardcoded value duplicated from the token's own default, with
 * nothing in this toolchain keeping the two in sync if the token's default
 * ever changes — see this file's own header further down, "A REAL, HONEST
 * FINDING THIS GATE SURFACES", for why that duplication is exactly the
 * invisible-drift risk this whole package exists to catch, not a case to
 * quietly special-case away.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, mirroring `copy-gate.ts`'s own list:
 *
 *   - It does not decide what counts as a "styling literal" at all — that
 *     classification, and the comment/attribute exclusions, already
 *     happened in `style-scan.ts`. This file only ever sees candidates
 *     `style-scan.ts` already decided are in scope.
 *   - It does not parse or normalize CSS values beyond exact, trimmed,
 *     case-insensitive TEXT comparison against `TOKENS`' own `value`
 *     strings. `oklch(0.4748 0 0)` matches `--color-accent`'s value
 *     because the two strings are IDENTICAL once trimmed and lowercased —
 *     not because this gate understands OKLCH color space, rounds
 *     rgba() alpha channels, or resolves `calc()`/`clamp()` expressions.
 *     A near-miss (extra whitespace inside a function call the source
 *     author formatted differently, a value that is mathematically equal
 *     but textually different) is reported as `"raw-value-no-token-
 *     backing"` rather than `"hardcodes-token-value"` — a real,
 *     accepted precision limit, not a silent one (stated here, the same
 *     way `copy/src/scan.ts` states its own escape-sequence and
 *     regex-vs-division simplifications).
 *
 * ============================================================================
 * A REAL, HONEST FINDING THIS GATE SURFACES (not fixed in this PR — see the
 * PR description for why)
 * ============================================================================
 *
 * `atoms/internal/ui-vars.ts`, `charts/internal/chart-vars.ts`,
 * `shell/internal/shell-vars.ts`, and `views/internal/view-vars.ts` each
 * carry a real, deliberate, and DOCUMENTED pattern: `"var(--token-name,
 * <literal fallback>)"`, where the literal fallback is hand-copied from
 * that same token's own shipped default in `@vespeneventures/tokens`'
 * `styles/tokens.css` — so a consumer who has this package but hasn't
 * wired up tokens' CSS yet still gets a legible result. Every one of those
 * fallbacks IS, by this gate's own rule above, a value that "hardcodes a
 * value a token already expresses" — `chart-vars.ts`'s `CHART_CATEGORICAL_
 * FALLBACK` record duplicates all 8 of `--color-chart-categorical-*`'s
 * hex defaults this way, and nothing in this toolchain, before this
 * package existed, ever checked that a fallback and its token's real
 * default stay in sync when one of them changes. This gate does not
 * special-case that pattern away: doing so would be exactly the "silent
 * allowlist buried in config" the task that produced this file explicitly
 * warns against, and the drift risk is real regardless of how deliberate
 * the pattern was when it was written. A consumer of this gate who wants
 * to keep the pattern is expected to waive each site explicitly
 * (`// token-gate:ignore — deliberate CSS fallback, kept in sync with
 * @vespeneventures/tokens by hand`), which is itself a real, greppable
 * admission of the drift risk, not a way to make it disappear.
 */

import type { TokenDefinition } from "@vespeneventures/tokens";
import {
  findEmbeddedStyleLiterals,
  isPureVarReference,
  type EmbeddedLiteral,
  type StyleCandidate,
  type UncheckedItem,
} from "./style-scan.js";

export type TokenGateRule = "hardcodes-token-value" | "raw-value-no-token-backing";

export interface TokenGateFinding {
  rule: TokenGateRule;
  /** Always `"error"` — the same single-severity design `@vespeneventures/copy`'s `CopyGateFinding` uses: a styling literal either duplicates/lacks token backing or it doesn't. */
  severity: "error";
  file: string;
  line: number;
  message: string;
  /** The candidate's raw source text, for a human scanning a report. */
  snippet: string;
  /** The `TOKENS` property name this literal's value matches exactly, if any (see `TokenGateRule`). */
  matchedToken?: string;
}

export interface TokenGateIgnored {
  file: string;
  line: number;
  snippet: string;
}

export interface TokenGateResult {
  findings: TokenGateFinding[];
  /** Every candidate explicitly suppressed via a `token-gate:ignore` marker on its own source line — recorded, never silent. */
  ignored: TokenGateIgnored[];
  filesScanned: number;
  /** Total candidates evaluated — lets a caller tell "zero findings because nothing looked like a styling literal" apart from "zero findings because every candidate was clean or ignored". */
  candidatesScanned: number;
  /** `"tw-arbitrary"` candidates that were a bare `var(--x)` reference with no fallback — the one legitimately clean shape (see this file's header). */
  clean: number;
  /**
   * `style-scan.ts`'s own `ScanResult.unchecked`, PLUS one gate-level
   * addition this file introduces: a `"tw-arbitrary"` candidate whose
   * bracket content is neither a bare `var()` reference nor contains any
   * recognizable hex/color-function/raw-length literal — e.g. Tailwind's
   * `content-['/']` or `grid-cols-[auto_minmax(0,1fr)_auto]`, both real
   * examples in this package's own source. Those are outside this gate's
   * declared scope (colors + lengths, not arbitrary CSS content strings or
   * grid track lists) and are reported here (`kind:
   * "unclassified-arbitrary-value"`) rather than silently waved through as
   * clean OR guessed at as a finding — this is a genuine extension of
   * `style-scan.ts`'s own `unchecked` contract, not a pass-through, because
   * the ambiguity here is about GATE POLICY (is this value shape in scope
   * at all?), not about EXTRACTION (`style-scan.ts` already extracted the
   * bracket's exact text with no ambiguity about where it is or what it
   * says). `cli.ts` treats this list exactly the way `copy-check` treats
   * `ScanResult.unchecked`: non-empty means exit 2, never a silent pass.
   */
  unchecked: UncheckedItem[];
}

function snippetOf(text: string, max = 120): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function normalizeForLookup(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildTokenIndex(tokens: Readonly<Record<string, TokenDefinition>>): Map<string, TokenDefinition> {
  const index = new Map<string, TokenDefinition>();
  for (const token of Object.values(tokens)) {
    index.set(normalizeForLookup(token.value), token);
  }
  return index;
}

function findingFor(
  file: string,
  line: number,
  raw: string,
  matchedValue: string,
  matchedValueKind: string,
  tokenIndex: Map<string, TokenDefinition>,
): TokenGateFinding {
  const token = tokenIndex.get(normalizeForLookup(matchedValue));
  if (token) {
    return {
      rule: "hardcodes-token-value",
      severity: "error",
      file,
      line,
      message: `${matchedValueKind} "${matchedValue}" hardcodes the exact value of token "${token.property}" (family "${token.family}") — read it via var(${token.property}) or the matching Tailwind class instead of the literal`,
      snippet: snippetOf(raw),
      matchedToken: token.property,
    };
  }
  return {
    rule: "raw-value-no-token-backing",
    severity: "error",
    file,
    line,
    message: `${matchedValueKind} "${matchedValue}" has no matching entry in @vespeneventures/tokens' TOKENS registry — register a token or replace this literal with an existing one`,
    snippet: snippetOf(raw),
  };
}

const KIND_LABEL: Record<StyleCandidate["kind"], string> = {
  "hex-color": "hex color",
  "color-function": "color function",
  "raw-length": "raw length",
  "tw-arbitrary": "arbitrary-value class",
};

/**
 * Evaluates every `candidate` against `tokens` (`@vespeneventures/tokens`'
 * real `TOKENS` registry, or an equivalent for a test). Never throws — an
 * empty `candidates` array or an empty `tokens` record is valid input
 * (every candidate with a matchable value would simply report
 * `"raw-value-no-token-backing"`). `unchecked` is required, not optional,
 * matching `checkCopyTraceability`'s own signature discipline — a caller
 * cannot construct a `TokenGateResult` from this function while
 * accidentally forgetting that field exists.
 */
export function checkTokenPurity(
  candidates: StyleCandidate[],
  tokens: Readonly<Record<string, TokenDefinition>>,
  filesScanned: number,
  scanUnchecked: UncheckedItem[],
): TokenGateResult {
  const tokenIndex = buildTokenIndex(tokens);
  const findings: TokenGateFinding[] = [];
  const ignored: TokenGateIgnored[] = [];
  const unchecked: UncheckedItem[] = [...scanUnchecked];
  let clean = 0;

  for (const candidate of candidates) {
    if (candidate.hasIgnoreMarker) {
      ignored.push({ file: candidate.file, line: candidate.line, snippet: candidate.raw });
      continue;
    }

    if (candidate.kind === "tw-arbitrary") {
      const trimmedValue = candidate.value.trim();
      if (isPureVarReference(trimmedValue)) {
        clean++;
        continue;
      }
      const embedded = findEmbeddedStyleLiterals(candidate.value);
      if (embedded.length === 0) {
        unchecked.push({
          file: candidate.file,
          line: candidate.line,
          kind: "unclassified-arbitrary-value",
          detail: `arbitrary-value class "${candidate.raw}" is neither a bare var() reference nor a recognizable color/length literal — outside this gate's declared scope, needs a human to classify`,
        });
        continue;
      }
      // Only the FIRST embedded literal drives the finding's rule/message —
      // a bracket like `w-[min(24rem,90vw)]` embeds two raw lengths, but
      // this gate reports one finding per candidate (matching every other
      // kind here), not one per embedded literal. The remaining embedded
      // literals are still real, still un-token-backed values; a consumer
      // fixing this finding by inspecting the full `candidate.raw` will see
      // all of them, not just the one named in the message.
      const first = embedded[0] as EmbeddedLiteral;
      const embeddedLabel =
        first.kind === "hex-color" ? "embedded hex color" : first.kind === "color-function" ? "embedded color function" : "embedded raw length";
      findings.push(findingFor(candidate.file, candidate.line, candidate.raw, first.raw, `${KIND_LABEL[candidate.kind]} (${embeddedLabel})`, tokenIndex));
      continue;
    }

    findings.push(findingFor(candidate.file, candidate.line, candidate.raw, candidate.value, KIND_LABEL[candidate.kind], tokenIndex));
  }

  return { findings, ignored, filesScanned, candidatesScanned: candidates.length, clean, unchecked };
}
