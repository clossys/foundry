/**
 * `checkTokenPurity` — the gate that makes `style-scan.ts`'s extraction
 * worth having, mirroring `@vespeneventures/copy`'s `copy-gate.ts` exactly:
 * pure (no I/O), takes already-extracted `StyleCandidate[]` (see
 * `style-scan.ts`) plus this package's real `TOKENS` registry,
 * and never throws on any input shape. `scanStyleSources` is the half that
 * gathers candidates from a real directory; `cli.ts` is what imports the
 * real `TOKENS` registry and turns this function's result into an exit
 * code.
 *
 * THE RULE, in one sentence: every styling literal `style-scan.ts` extracts
 * is a FINDING unless it is explicitly waived (`token-gate:ignore` on its
 * own source line — see `style-scan.ts`'s `IGNORE_MARKER_RE`) or is a bare
 * `var(--custom-property)` reference with NO fallback at all (see "THE ONE
 * EXCEPTION" below) — there is no other "this one's fine" classification a
 * hex color, color function, or raw length can earn on its own.
 *
 * ============================================================================
 * THREE RULES, NOT TWO — bare literals vs. var() FALLBACK literals
 * ============================================================================
 *
 * An earlier version of this gate reported every literal the same way,
 * regardless of whether it sat bare in source or inside a `var(--token,
 * <fallback>)` call's own fallback slot — both were `"hardcodes-token-
 * value"` if some token in the registry happened to share the literal's
 * value. That collapsed two genuinely different situations into one
 * message, and the message was actively WRONG for the fallback case: for
 * `atoms/Icon.tsx`'s `"var(--ui-icon-sm, var(--spacing-lg, 16px))"`, the
 * old finding read "read it via var(--spacing-lg) ... instead of the
 * literal" — but the code ALREADY reads it via `var(--spacing-lg)`. The
 * `16px` is that var's own documented fallback, and
 * the token layer itself ships this exact shape on purpose
 * (`--ui-icon-sm`'s own registry value IS `"var(--spacing-lg, 16px)"`).
 * Telling the author to do the thing
 * they already did is not an actionable finding.
 *
 * So this gate now distinguishes THREE outcomes for a literal candidate
 * (`style-scan.ts`'s `StyleCandidate.fallbackForProperty` / a `tw-
 * arbitrary` candidate's embedded literal's own `EmbeddedLiteral.
 * fallbackForProperty` — see that file for how this is resolved
 * STRUCTURALLY, by parsing `var(...)` nesting, never by searching `TOKENS`
 * for a same-valued entry, which is what produced the wrong attribution in
 * the first place):
 *
 *   1. BARE LITERAL (`fallbackForProperty === undefined`) — reached by no
 *      `var(...)` at all. The token system is not consulted at THIS call
 *      site in any way; if the referenced token's value ever changes,
 *      nothing here changes with it, silently, forever. This is a full
 *      defeat of the token system, so it stays the most severe outcome:
 *      `severity: "error"`. Sub-classified exactly as before —
 *      `"hardcodes-token-value"` if the literal's own value matches a real
 *      token by exact text, `"raw-value-no-token-backing"` if it matches
 *      none.
 *   2. `var()` FALLBACK LITERAL (`fallbackForProperty` set) — new rule
 *      `"token-value-duplicated-in-fallback"`, `severity: "warning"`. The
 *      token IS being consulted at this call site, and wins whenever
 *      this package's token CSS is actually loaded (the expected,
 *      overwhelmingly common runtime case for a real consumer). The
 *      literal only ever executes in the DEGRADED path — no tokens CSS at
 *      all — so the live behavior for a normal consumer is already
 *      correct. The real risk is LATENT DRIFT: nothing re-checks that the
 *      fallback still matches the token's declared default the next time
 *      either one changes. Lower blast radius (only visible in the
 *      degraded path, and only once drift has actually happened), lower
 *      frequency (requires two independent things — a hand-authored
 *      fallback AND a later token-value edit — to both occur and go
 *      unnoticed together) than a bare literal's total, permanent
 *      disconnection from the token system. `severity: "warning"` argues
 *      exactly that difference; it does not argue the risk is fake. The
 *      message additionally reports whether the fallback CURRENTLY matches
 *      the referenced token's real declared value (`fallbackSyncStatus`
 *      below) — same-severity findings that have ALREADY drifted vs. ones
 *      that currently happen to agree are not equally urgent, and a reader
 *      should not have to go look that up by hand.
 *   3. CLEAN — a `tw-arbitrary` bracket that is EXACTLY a bare
 *      `var(--custom-property)` reference, no fallback at all (see "THE
 *      ONE EXCEPTION" below). Not a finding of any kind.
 *
 * Every OTHER package/repo convention this gate mirrors (`copy-gate.ts`'s
 * `CopyGateFinding`) uses a single severity, because copy's rule genuinely
 * has no "less severe" shape — a string either traces to a registered
 * entry or it doesn't. This gate's rule DOES have one, so `severity` here
 * is `"error" | "warning"`, not the constant `"error"` copy's own type
 * carries. Both severities still count as a `finding` for the exit-code
 * contract (`cli.ts`): `unchecked` wins over everything (exit 2), then any
 * finding at all — warning or error — means exit `1`, never a silent 0. A
 * "warning" is still something a clean run must not contain; it just isn't
 * equally urgent to fix.
 *
 * THE ONE EXCEPTION, and it belongs to `"tw-arbitrary"` candidates alone: a
 * Tailwind arbitrary-value class whose bracket is EXACTLY a bare
 * `var(--custom-property)` reference, no fallback — `token-gate.ts` treats
 * this as CLEAN, not a finding. This is the documented "no Tailwind
 * namespace, raw `var()` only" escape hatch this package's token layer
 * README describes for values that have no Tailwind `@theme` namespace at
 * all (z-index, elevation, layout widths, ...) — see
 * `packages/ui/src/atoms/internal/ui-vars.ts`'s own header comment for the
 * real precedent.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, mirroring `copy-gate.ts`'s own list:
 *
 *   - It does not decide what counts as a "styling literal" at all, or
 *     whether a literal sits inside a `var()` fallback — that
 *     classification (comment/attribute exclusions, and now fallback-chain
 *     resolution) already happened in `style-scan.ts`. This file only ever
 *     sees candidates `style-scan.ts` already decided are in scope, with
 *     `fallbackForProperty` already resolved.
 *   - It does not parse or normalize CSS values beyond exact, trimmed,
 *     case-insensitive TEXT comparison against `TOKENS`' own `value`
 *     strings (bare-literal matching) or a SUBSTRING check against a
 *     referenced token's composite value (fallback sync-status — see
 *     `fallbackSyncStatus`, needed because a token like `--ui-ring-focus`'s
 *     own registry value, `"0 0 0 2px var(--color-accent, oklch(0.4748 0
 *     0))"`, is a composite string a single fallback literal like `2px` is
 *     only ONE PIECE of, so exact-string equality is the wrong test for
 *     that case specifically). Neither is a real CSS value parser — a
 *     near-miss (extra whitespace, a mathematically-equal-but-textually-
 *     different value) reads as "no match"/"drifted" rather than
 *     recognized as equivalent. A real, accepted precision limit, not a
 *     silent one (stated here, the same way `copy/src/scan.ts` states its
 *     own escape-sequence and regex-vs-division simplifications).
 *
 * ============================================================================
 * A REAL, HONEST FINDING THIS GATE SURFACES (not fixed in this PR — see the
 * PR description for why)
 * ============================================================================
 *
 * `atoms/internal/ui-vars.ts`, `charts/internal/chart-vars.ts`,
 * `shell/internal/shell-vars.ts` and surface-level web views each
 * carry a real, deliberate, and DOCUMENTED pattern: `"var(--token-name,
 * <literal fallback>)"`, where the literal fallback is hand-copied from
 * that same token's own shipped default in this package's
 * `styles/tokens.css` — so a consumer who has this package but hasn't
 * wired up tokens' CSS yet still gets a legible result. Every one of those
 * fallbacks is now correctly reported as `"token-value-duplicated-in-
 * fallback"` (`warning`), not `"hardcodes-token-value"` (`error`) —
 * `chart-vars.ts`'s `CHART_CATEGORICAL_FALLBACK` record duplicates all 8 of
 * `--color-chart-categorical-*`'s hex defaults this way, and nothing in
 * this toolchain, before this package existed, ever checked that a
 * fallback and its token's real default stay in sync when one of them
 * changes. This gate does not special-case that pattern away: doing so
 * would be exactly the "silent allowlist buried in config" the task that
 * produced this file explicitly warns against, and the drift risk is real
 * regardless of how deliberate the pattern was when it was written. A
 * consumer of this gate who wants to keep the pattern is expected to waive
 * each site explicitly (`// token-gate:ignore — deliberate CSS fallback,
 * kept in sync with the token layer by hand`), which is itself a
 * real, greppable admission of the drift risk, not a way to make it
 * disappear.
 */

import type { TokenDefinition } from "./tokens/index.js";
import {
  findEmbeddedStyleLiterals,
  isPureVarReference,
  type EmbeddedLiteral,
  type StyleCandidate,
  type UncheckedItem,
} from "./style-scan.js";

export type TokenGateRule = "hardcodes-token-value" | "raw-value-no-token-backing" | "token-value-duplicated-in-fallback";

export type TokenGateSeverity = "error" | "warning";

export interface TokenGateFinding {
  rule: TokenGateRule;
  /**
   * `"error"` for a BARE literal (`hardcodes-token-value` /
   * `raw-value-no-token-backing`) — the token system is not consulted at
   * all at this call site. `"warning"` for `token-value-duplicated-in-
   * fallback` — the token IS consulted and wins in the normal runtime
   * path; the literal is a lower-frequency, lower-blast-radius LATENT
   * drift risk, not a live defeat of the token system. See this file's top
   * comment, "THREE RULES, NOT TWO", for the full argument.
   */
  severity: TokenGateSeverity;
  file: string;
  line: number;
  message: string;
  /** The candidate's raw source text, for a human scanning a report. */
  snippet: string;
  /**
   * The `TOKENS` property name this finding is entangled with, if any: for
   * a bare literal, a token whose value matches this literal's value
   * exactly; for a fallback literal, the `--property` it is the `var()`
   * fallback FOR (see `style-scan.ts`'s `resolveFallbackChain`) — set even
   * when the value doesn't currently match (see `fallbackSyncStatus`), as
   * long as that property is a REAL entry in `tokens`.
   */
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

/**
 * Bare-literal finding (`severity: "error"`) — a literal reached by no
 * `var(...)` at all. `matchedValue`/`matchedValueKind` name what's being
 * checked (the candidate's own value for a plain `hex-color`/`color-
 * function`/`raw-length`, or an embedded literal's value+kind for a `tw-
 * arbitrary` bracket — see `findingForCandidate` below).
 */
function bareLiteralFinding(
  file: string,
  line: number,
  raw: string,
  matchedValue: string,
  matchedValueKind: string,
  tokenIndex: Map<string, TokenDefinition>,
  registryLabel: string,
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
    message: `${matchedValueKind} "${matchedValue}" has no matching entry in ${registryLabel}' TOKENS registry — register a token or replace this literal with an existing one`,
    snippet: snippetOf(raw),
  };
}

/**
 * Reports how a fallback literal's value compares to the REAL declared
 * value of the token it is the fallback for — `property` is already known
 * (resolved structurally by `style-scan.ts`'s `resolveFallbackChain`); this
 * function only asks "does the registry agree". THREE outcomes, not a bare
 * boolean, because a reader needs to tell "this has already silently
 * drifted" apart from "this is currently fine, drift is only a future
 * risk": a token like `--spacing-lg` (`"16px"`) or `--color-chart-
 * categorical-1` (`"#2a78d6"`) has a SIMPLE, single-value default an exact
 * comparison handles directly; a token like `--ui-ring-focus`
 * (`"0 0 0 2px var(--color-accent, oklch(0.4748 0 0))"`) has a COMPOSITE
 * value a single fallback literal (`2px`) is only one PIECE of — exact
 * equality would wrongly call that "drifted" the moment the fallback is
 * correct, so a substring check is the fallback test for the composite
 * case. Both are real, accepted simplifications (see this file's top
 * comment) — never a full CSS-value equivalence check.
 */
function fallbackSyncStatus(
  property: string,
  literalValue: string,
  tokens: Readonly<Record<string, TokenDefinition>>,
  registryLabel: string,
): { text: string; matchedToken: string | undefined } {
  const token = tokens[property];
  if (!token) {
    return { text: `no token named "${property}" exists in ${registryLabel}' TOKENS registry — verify the property name`, matchedToken: undefined };
  }
  const normToken = normalizeForLookup(token.value);
  const normLiteral = normalizeForLookup(literalValue);
  if (normToken === normLiteral) {
    return { text: `currently matches "${property}"'s declared default exactly`, matchedToken: property };
  }
  if (normToken.includes(normLiteral)) {
    return { text: `currently consistent with "${property}"'s declared default ("${token.value}")`, matchedToken: property };
  }
  return {
    text: `does NOT match "${property}"'s current declared default ("${token.value}") — this fallback has already drifted out of sync`,
    matchedToken: property,
  };
}

/**
 * `var()`-fallback finding (`severity: "warning"`) — `property` is the
 * `--custom-property` this literal is the fallback FOR (see
 * `style-scan.ts`'s `resolveFallbackChain`).
 */
function fallbackFinding(
  file: string,
  line: number,
  raw: string,
  literalValue: string,
  literalValueKind: string,
  property: string,
  tokens: Readonly<Record<string, TokenDefinition>>,
  registryLabel: string,
): TokenGateFinding {
  const status = fallbackSyncStatus(property, literalValue, tokens, registryLabel);
  return {
    rule: "token-value-duplicated-in-fallback",
    severity: "warning",
    file,
    line,
    message: `${literalValueKind} "${literalValue}" is the var() fallback for token "${property}" — ${status.text}. Nothing keeps a hand-written fallback in sync with the token's real default: keep it as a documented, deliberate default, or drop the fallback so a missing token fails visibly instead of silently rendering a stale value.`,
    snippet: snippetOf(raw),
    matchedToken: status.matchedToken,
  };
}

const KIND_LABEL: Record<StyleCandidate["kind"], string> = {
  "hex-color": "hex color",
  "color-function": "color function",
  "raw-length": "raw length",
  "tw-arbitrary": "arbitrary-value class",
};

const EMBEDDED_KIND_LABEL: Record<EmbeddedLiteral["kind"], string> = {
  "hex-color": "embedded hex color",
  "color-function": "embedded color function",
  "raw-length": "embedded raw length",
};

/** Routes a literal (bare candidate value, or an embedded literal's value) to `bareLiteralFinding` or `fallbackFinding` depending on whether `fallbackForProperty` is set — the one branch point "THREE RULES, NOT TWO" (this file's top comment) describes. */
function findingForLiteral(
  file: string,
  line: number,
  raw: string,
  literalValue: string,
  literalValueKind: string,
  fallbackForProperty: string | undefined,
  tokens: Readonly<Record<string, TokenDefinition>>,
  tokenIndex: Map<string, TokenDefinition>,
  registryLabel: string,
): TokenGateFinding {
  if (fallbackForProperty !== undefined) {
    return fallbackFinding(file, line, raw, literalValue, literalValueKind, fallbackForProperty, tokens, registryLabel);
  }
  return bareLiteralFinding(file, line, raw, literalValue, literalValueKind, tokenIndex, registryLabel);
}

/**
 * Evaluates every `candidate` against `tokens` (this package's
 * real `TOKENS` registry, or an equivalent for a test). Never throws — an
 * empty `candidates` array or an empty `tokens` record is valid input
 * (every candidate with a matchable value would simply report
 * `"raw-value-no-token-backing"`). `unchecked` is required, not optional,
 * matching `checkCopyTraceability`'s own signature discipline — a caller
 * cannot construct a `TokenGateResult` from this function while
 * accidentally forgetting that field exists.
 *
 * `registryLabel` names the `tokens` registry in every finding message —
 * defaults to this package's own name so every existing caller (including
 * every test) keeps its exact current message unchanged. A caller passing
 * its OWN registry (the seam this function's `tokens` parameter exists
 * for) should pass its own label too: without this, every finding still
 * said "@vespeneventures/ui/tokens" regardless of whose registry was
 * actually checked — correct for this package's own CLI, actively
 * misleading for anyone else's.
 */
export function checkTokenPurity(
  candidates: StyleCandidate[],
  tokens: Readonly<Record<string, TokenDefinition>>,
  filesScanned: number,
  scanUnchecked: UncheckedItem[],
  registryLabel = "@vespeneventures/ui/tokens",
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
      findings.push(
        findingForLiteral(
          candidate.file,
          candidate.line,
          candidate.raw,
          first.raw,
          `${KIND_LABEL[candidate.kind]} (${EMBEDDED_KIND_LABEL[first.kind]})`,
          first.fallbackForProperty,
          tokens,
          tokenIndex,
          registryLabel,
        ),
      );
      continue;
    }

    findings.push(
      findingForLiteral(
        candidate.file,
        candidate.line,
        candidate.raw,
        candidate.value,
        KIND_LABEL[candidate.kind],
        candidate.fallbackForProperty,
        tokens,
        tokenIndex,
        registryLabel,
      ),
    );
  }

  return { findings, ignored, filesScanned, candidatesScanned: candidates.length, clean, unchecked };
}
