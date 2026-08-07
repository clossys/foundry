/**
 * `checkCopy` — the working voice checker. Given a `VoiceRecord` (already
 * validated — see `schema.ts`) and a piece of copy, reports the subset of
 * voice violations that are actually mechanically detectable: forbidden
 * glossary terms, forbidden person/tense word-markers, and claims made in
 * the copy that lack a `factRef` while `requiresSupport` is true.
 *
 * Pure, no I/O: every input is already in memory, every output is plain
 * data. `checkCopy` never reads a file, never calls `strategy` or any other
 * package, and never resolves a `factRef` against anything — see the
 * README's "The `factRef` seam" for why that resolution is deliberately not
 * this package's job.
 *
 * FAILS CLOSED. Two situations that would otherwise look like "nothing was
 * wrong" are instead surfaced as an explicit, visible incompleteness, never
 * as a silent, empty-findings pass:
 *
 *   1. `copy` is empty or whitespace-only: every dimension is recorded in
 *      `skipped`, not run, and `findings` is empty for a reason a caller
 *      can see, not because the copy was clean.
 *   2. A dimension has nothing configured to check against (e.g. no
 *      forbidden pronouns in `rules.person`, or an empty glossary) is
 *      likewise recorded in `skipped` rather than silently contributing
 *      zero findings to what would otherwise read as a clean run.
 *
 * `report.complete` is `true` exactly when `skipped` is empty — mirroring
 * `@vespeneventures/gates`' `FoundationReport.complete` — so a caller can
 * ask "did this report actually check everything it could have" with one
 * boolean read.
 */

import type { Claim, VoiceFinding, VoiceRecord } from "./types.js";

/** Which of the four checkable dimensions a run can evaluate. */
export type VoiceCheckDimension = "glossary" | "person" | "tense" | "claims";

/** One dimension `checkCopy` did not evaluate this run, and why. */
export interface VoiceDimensionSkip {
  dimension: VoiceCheckDimension;
  /**
   * Machine-readable reason: `"empty-copy"` (nothing to scan at all —
   * every dimension gets this reason together), or one of
   * `"no-forbidden-terms-configured"` / `"no-forbidden-pronouns-configured"`
   * / `"no-forbidden-markers-configured"` / `"no-claims-configured"` (the
   * copy was real, but this dimension's own `VoiceRecord` list was empty).
   */
  reason: string;
}

/**
 * An explicit, auditable exception for one specific finding. Scoped
 * narrowly on purpose — a waiver matches exactly one `rule` plus the exact
 * `path` of the finding it covers (a single term, pronoun, marker, or claim
 * id), never a whole dimension or the whole run. `reason` is required and
 * non-empty: a waiver with no stated reason is rejected (see
 * `"waiver:invalid"` below), not silently honored.
 */
export interface VoiceCheckWaiver {
  /** Must equal the `rule` of the finding this waiver covers, e.g. `"glossary:forbidden-term"`. */
  rule: string;
  /** Must equal the `path` of the finding this waiver covers, e.g. the exact forbidden term. */
  match: string;
  /** Required. Why this specific instance is acceptable — this is the audit trail. */
  reason: string;
}

/** A `VoiceFinding` that was waived, with the waiver that covered it attached for the audit trail. */
export interface WaivedVoiceFinding extends VoiceFinding {
  waiver: VoiceCheckWaiver;
}

export interface VoiceCheckOptions {
  /** Waivers to apply to this run's raw findings before returning. Defaults to none. */
  waivers?: VoiceCheckWaiver[];
}

export interface VoiceCheckReport {
  /** Findings not covered by any waiver. Empty does not necessarily mean "clean" — check `complete` and `skipped` too. */
  findings: VoiceFinding[];
  /** Findings that were covered by a waiver, each with the waiver that covered it. */
  waived: WaivedVoiceFinding[];
  /** Dimensions this run could not evaluate, and why. Empty means every dimension ran. */
  skipped: VoiceDimensionSkip[];
  /** Dimensions this run actually evaluated (produced zero or more raw findings from real input). */
  ran: VoiceCheckDimension[];
  /** `true` exactly when `skipped` is empty. `false` means this report cannot vouch for having checked everything it could have. */
  complete: boolean;
}

const ALL_DIMENSIONS: readonly VoiceCheckDimension[] = ["glossary", "person", "tense", "claims"];

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Counts non-overlapping whole-word/whole-phrase occurrences of `term` in
 * `haystack`. `\b` boundaries mean a multi-word phrase like `"state of the
 * art"` still requires a real word boundary at its very start and very
 * end — it will not match inside a longer word, but it also will not
 * distinguish "used in dialogue/a quotation" from "used as the voice's own
 * words". See README's limits section for that specific gap.
 */
function countMatches(haystack: string, term: string, caseSensitive: boolean): number {
  const trimmed = term.trim();
  if (trimmed.length === 0) return 0;
  const pattern = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, caseSensitive ? "g" : "gi");
  const matches = haystack.match(pattern);
  return matches ? matches.length : 0;
}

/**
 * `true` for a single uppercase letter — `"I"`, but not `"we"`, `"Will"`,
 * or `"i"`. `person`/`tense` word lists have no per-entry `caseSensitive`
 * field the way glossary entries do (see README's tables), so this is the
 * one automatic exception to their otherwise-uniform case-insensitive
 * matching: a bare `"I"` matched case-insensitively would also fire on any
 * stray lowercase `"i"` (a roman numeral, a loop variable in quoted code)
 * that is not the first-person pronoun at all — a real, common false
 * positive for the single most common `forbiddenPronouns` entry there is.
 * Matching a single uppercase letter case-sensitively closes that specific
 * gap without losing sentence-initial-capitalization tolerance for every
 * multi-letter entry (`"we"` still needs to match `"We"`).
 */
function isSingleUppercaseLetter(term: string): boolean {
  return term.length === 1 && term >= "A" && term <= "Z";
}

/** Case sensitivity `checkCopy` uses for one `person`/`tense` word-list entry — see `isSingleUppercaseLetter`. */
function markerCaseSensitivity(term: string): boolean {
  return isSingleUppercaseLetter(term);
}

/**
 * Registry-level audit, independent of any copy: which claims in `claims`
 * require support (`requiresSupport: true`, the default) but carry no
 * `factRef`. Useful as a standalone "is this claims register itself
 * complete" check, separate from `checkCopy`'s "did THIS copy use one of
 * them" question. Pure, no I/O.
 */
export function auditClaimsRegister(claims: Claim[]): VoiceFinding[] {
  const findings: VoiceFinding[] = [];
  for (const claim of claims) {
    if (claim.requiresSupport && !claim.factRef) {
      findings.push({
        rule: "claim:missing-fact-ref",
        severity: "warning",
        message: `Claim "${claim.id}" ("${claim.text}") requires support but has no factRef.`,
        path: claim.id,
      });
    }
  }
  return findings;
}

/**
 * Checks `copy` against `record`. See this file's top-of-file doc comment
 * for the fail-closed behavior on empty copy and on unconfigured
 * dimensions, and the package README for exactly what each dimension does
 * and does not attempt.
 *
 * Throws a plain `Error` (not a finding) for caller-input problems that are
 * not this function's job to interpret as data: `copy` not a string, or
 * `record` not an object. This mirrors `@vespeneventures/gates`'
 * `runFoundationCheck`, which treats a malformed call the same way — a hard
 * upfront rejection, not a soft finding that could be mistaken for
 * something the checker discovered about the copy itself.
 */
export function checkCopy(record: VoiceRecord, copy: string, options: VoiceCheckOptions = {}): VoiceCheckReport {
  if (typeof copy !== "string") {
    throw new TypeError("checkCopy: copy must be a string");
  }
  if (record === null || typeof record !== "object") {
    throw new TypeError(
      "checkCopy: record must be a VoiceRecord object — validate untrusted input with validateVoiceRecordShape first",
    );
  }

  const ran: VoiceCheckDimension[] = [];
  const skipped: VoiceDimensionSkip[] = [];
  const rawFindings: VoiceFinding[] = [];

  const trimmedCopy = copy.trim();

  if (trimmedCopy.length === 0) {
    // Nothing to scan at all. Every dimension is unreachable, not clean —
    // recording all four as skipped is what keeps this from reading like a
    // report that checked the copy and found it flawless.
    for (const dimension of ALL_DIMENSIONS) {
      skipped.push({ dimension, reason: "empty-copy" });
    }
  } else {
    // --- glossary --------------------------------------------------------
    const forbiddenTerms = record.glossary.filter((entry) => entry.status === "forbidden");
    if (forbiddenTerms.length === 0) {
      skipped.push({ dimension: "glossary", reason: "no-forbidden-terms-configured" });
    } else {
      ran.push("glossary");
      for (const entry of forbiddenTerms) {
        const count = countMatches(copy, entry.term, entry.caseSensitive);
        if (count > 0) {
          const alt = entry.alternative ? ` Use "${entry.alternative}" instead.` : "";
          rawFindings.push({
            rule: "glossary:forbidden-term",
            severity: "error",
            message: `Forbidden term "${entry.term}" appears ${count} time(s). ${entry.reason}${alt}`,
            path: entry.term,
          });
        }
      }
    }

    // --- person ------------------------------------------------------------
    if (record.rules.person.forbiddenPronouns.length === 0) {
      skipped.push({ dimension: "person", reason: "no-forbidden-pronouns-configured" });
    } else {
      ran.push("person");
      for (const pronoun of record.rules.person.forbiddenPronouns) {
        const count = countMatches(copy, pronoun, markerCaseSensitivity(pronoun));
        if (count > 0) {
          rawFindings.push({
            rule: "person:forbidden-pronoun",
            severity: "error",
            message: `Pronoun "${pronoun}" appears ${count} time(s), contradicting this voice's person rule (${record.rules.person.description}).`,
            path: pronoun,
          });
        }
      }
    }

    // --- tense ---------------------------------------------------------
    if (record.rules.tense.forbiddenMarkers.length === 0) {
      skipped.push({ dimension: "tense", reason: "no-forbidden-markers-configured" });
    } else {
      ran.push("tense");
      for (const marker of record.rules.tense.forbiddenMarkers) {
        const count = countMatches(copy, marker, markerCaseSensitivity(marker));
        if (count > 0) {
          rawFindings.push({
            rule: "tense:forbidden-marker",
            severity: "warning",
            message: `Marker "${marker}" appears ${count} time(s), which may contradict this voice's tense rule (${record.rules.tense.description}). This is a word-marker heuristic, not grammatical tense parsing — verify by eye.`,
            path: marker,
          });
        }
      }
    }

    // --- claims ----------------------------------------------------------
    if (record.claims.length === 0) {
      skipped.push({ dimension: "claims", reason: "no-claims-configured" });
    } else {
      ran.push("claims");
      for (const claim of record.claims) {
        if (!claim.requiresSupport) continue; // this claim was explicitly marked as not needing a factRef
        if (claim.factRef) continue; // has a factRef — whether it RESOLVES is a later gate's job, not this function's; see README
        const phrases = claim.matchPhrases.length > 0 ? claim.matchPhrases : [claim.text];
        const isMade = phrases.some((phrase) => countMatches(copy, phrase, false) > 0);
        if (isMade) {
          rawFindings.push({
            rule: "claim:unsupported",
            severity: "error",
            message: `Claim "${claim.id}" ("${claim.text}") appears in this copy but has no factRef and is marked as requiring support.`,
            path: claim.id,
          });
        }
      }
    }
  }

  // --- waivers -------------------------------------------------------------
  // Validate each waiver's own shape first (required, non-empty rule/match/
  // reason) — an invalid waiver is reported as its own error and is never
  // applied, so a caller cannot accidentally waive something by supplying a
  // malformed waiver object.
  const configFindings: VoiceFinding[] = [];
  const validWaivers: VoiceCheckWaiver[] = [];
  for (const waiver of options.waivers ?? []) {
    const valid =
      typeof waiver?.rule === "string" &&
      waiver.rule.length > 0 &&
      typeof waiver?.match === "string" &&
      waiver.match.length > 0 &&
      typeof waiver?.reason === "string" &&
      waiver.reason.trim().length > 0;
    if (!valid) {
      configFindings.push({
        rule: "waiver:invalid",
        severity: "error",
        message: `Waiver is missing a required field — "rule", "match", and a non-empty "reason" are all required. Given: ${JSON.stringify(waiver)}`,
      });
    } else {
      validWaivers.push(waiver);
    }
  }

  const findings: VoiceFinding[] = [];
  const waived: WaivedVoiceFinding[] = [];
  const usedWaiverIndexes = new Set<number>();

  for (const finding of rawFindings) {
    const waiverIndex = validWaivers.findIndex((w) => w.rule === finding.rule && w.match === finding.path);
    if (waiverIndex >= 0) {
      usedWaiverIndexes.add(waiverIndex);
      waived.push({ ...finding, waiver: validWaivers[waiverIndex] as VoiceCheckWaiver });
    } else {
      findings.push(finding);
    }
  }

  // A waiver that never matched anything this run is dead configuration —
  // surfaced as its own warning rather than silently doing nothing, so
  // waivers cannot quietly accumulate forever without anyone noticing one
  // stopped applying (e.g. after the copy that needed it was rewritten).
  validWaivers.forEach((waiver, index) => {
    if (!usedWaiverIndexes.has(index)) {
      configFindings.push({
        rule: "waiver:unused",
        severity: "warning",
        message: `Waiver for rule "${waiver.rule}" matching "${waiver.match}" did not match any finding in this run. Remove it, or check for a typo. Reason on file: "${waiver.reason}"`,
        path: waiver.match,
      });
    }
  });

  findings.push(...configFindings);

  return {
    findings,
    waived,
    skipped,
    ran,
    complete: skipped.length === 0,
  };
}
