/**
 * `checkCopy` — the working voice checker. Given a `VoiceRecord` (already
 * validated — see `schema.ts`) and a piece of copy, reports the subset of
 * voice violations that are actually mechanically detectable: forbidden
 * glossary terms, forbidden person/tense word-markers, claims made in the
 * copy that lack a `factRef` while `requiresSupport` is true, and —
 * unconditionally, whether or not `copy` is even given — whether `record`
 * itself is still (partly) an unedited copy of `voice-record.template.jsonc`.
 *
 * Pure, no I/O: every input is already in memory, every output is plain
 * data. `checkCopy` never reads a file, never calls `strategy` or any other
 * package, and never resolves a `factRef` against anything — see the
 * README's "The `factRef` seam" for why that resolution is deliberately not
 * this package's job.
 *
 * FAILS CLOSED. Three situations that would otherwise look like "nothing
 * was wrong" are instead surfaced as an explicit, visible incompleteness or
 * an explicit, unmissable error — never as a silent, empty-findings pass:
 *
 *   1. `copy` is empty or whitespace-only: every dimension is recorded in
 *      `skipped`, not run, and `findings` is empty for a reason a caller
 *      can see, not because the copy was clean.
 *   2. A dimension has nothing configured to check against (e.g. no
 *      forbidden pronouns in `rules.person`, or an empty glossary) is
 *      likewise recorded in `skipped` rather than silently contributing
 *      zero findings to what would otherwise read as a clean run.
 *   3. `record` still carries `TEMPLATE_PLACEHOLDER` in one or more of its
 *      bindable string fields — this voice was never actually bound, only
 *      copied from the template. See "The unbound signal" below.
 *
 * `report.complete` is `true` exactly when `skipped` is empty — mirroring
 * `@vespeneventures/gates`' `FoundationReport.complete` — so a caller can
 * ask "did this report actually check everything it could have" with one
 * boolean read. `report.bound` is the analogous read for #3.
 *
 * THE UNBOUND SIGNAL
 * -------------------
 * `@vespeneventures/ui/tokens` has a visual answer to "did anyone bind this
 * yet": import only `tokens.css` and the page renders in visible grey, plus
 * a literal dev-mode badge, until `data-brand-bound` is set. Text has no
 * pixels to fall back to — there is no "render this copy in grey" — so the
 * honest analog is not visual, it's TRUTHFUL DEFAULT DATA: every bindable
 * slot in `voice-record.template.jsonc` is filled with one specific,
 * exported, unmistakable sentinel (`TEMPLATE_PLACEHOLDER`, from
 * `fields.ts`) instead of a plausible-looking example value. A plausible
 * example (a real-sounding pronoun, a real-sounding claim) is exactly what
 * would let an unbound voice "happen to pass" — it would look indistinguishable
 * from a deliberately-authored record that just happens to match the
 * example. A loud, structurally-unmistakable placeholder cannot be
 * mistaken for real content, which is what makes detecting it a reliable
 * signal rather than a heuristic.
 *
 * `findPlaceholderPaths` below scans every string `checkCopy` can reach in
 * `record` — recursively, the same "leaf, not tree" walk `fields.ts`
 * documents for the template itself — for exact equality with
 * `TEMPLATE_PLACEHOLDER`. If it finds even one, `report.bound` is `false`
 * AND, critically, an `"error"`-severity `"voice:unbound-placeholder"`
 * finding is pushed into `report.findings` for each one — not merely a flag
 * a caller has to remember to check. This is the deliberate design choice:
 * this package's own README (see "Usage") already tells every caller to do
 * `if (report.findings.some(f => f.severity === "error")) process.exitCode = 1;`.
 * An unbound record fails that exact, already-idiomatic check on its own,
 * with no second code path a caller has to add and no way for "still
 * template" and "genuinely clean" to ever produce the same result shape —
 * which is the whole point: an unbound voice must never look like a bound
 * one that happens to pass.
 */

import { TEMPLATE_PLACEHOLDER } from "./fields.js";
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
  /** Findings not covered by any waiver. Empty does not necessarily mean "clean" — check `complete` and `bound` too. */
  findings: VoiceFinding[];
  /** Findings that were covered by a waiver, each with the waiver that covered it. */
  waived: WaivedVoiceFinding[];
  /** Dimensions this run could not evaluate, and why. Empty means every dimension ran. */
  skipped: VoiceDimensionSkip[];
  /** Dimensions this run actually evaluated (produced zero or more raw findings from real input). */
  ran: VoiceCheckDimension[];
  /** `true` exactly when `skipped` is empty. `false` means this report cannot vouch for having checked everything it could have. */
  complete: boolean;
  /**
   * `false` if `record` still carries `TEMPLATE_PLACEHOLDER` in one or more
   * bindable fields — i.e. this is (at least partly) an unedited copy of
   * `voice-record.template.jsonc`, not a real, bound voice. See this file's
   * top-of-file doc comment, "The unbound signal". Computed unconditionally,
   * independent of `copy` — an unbound `record` is reported as such even
   * when `copy` is empty. Every unbound field also produces its own
   * `"voice:unbound-placeholder"` **error** in `findings`, so `bound: false`
   * is never a silent flag a caller has to remember to check separately.
   */
  bound: boolean;
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
 * Recursively finds every dot-path in `value` whose STRING value is exactly
 * `TEMPLATE_PLACEHOLDER` — the same "leaf, not tree" walk
 * `internal/parse-template.ts`'s `extractFieldPaths` uses on the template
 * itself, except this one DOES descend into arrays (`glossary.0.term`,
 * `claims.1.text`, ...): the template's own coverage test only needs to
 * know a bindable collection EXISTS, but a real record's placeholder scan
 * needs to know exactly which entry, of however many a real consumer added,
 * still carries the sentinel — a bare `"glossary"` path in a finding would
 * not tell anyone which of N entries to go fix.
 *
 * Exact string equality only, never a substring/contains check: a real
 * voice is free to legitimately quote or discuss this package's own
 * placeholder text (documentation about `voice-record.template.jsonc`
 * itself, say) without that mention alone flipping `bound` to `false` for
 * an otherwise fully-authored field.
 */
function findPlaceholderPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") {
    return value === TEMPLATE_PLACEHOLDER ? [prefix || "$"] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findPlaceholderPaths(item, prefix ? `${prefix}.${i}` : String(i)));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
      findPlaceholderPaths(nested, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
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

  // --- unbound-placeholder scan ---------------------------------------
  // Runs unconditionally, before the copy-empty branch below and
  // independent of it — whether `record` is still (partly) an unedited
  // copy of the template is a property of `record`, not of `copy`. See
  // this file's top-of-file doc comment, "The unbound signal".
  //
  // Kept in its OWN array, deliberately never merged into `rawFindings`
  // below: `rawFindings` is what the waiver loop matches against, and a
  // `"voice:unbound-placeholder"` finding must not be waivable. Every other
  // finding this function produces is a judgment call a reviewer can
  // legitimately override with a reason (a forbidden term quoted from a
  // review, a claim phrase inside a testimonial); an unbound record is not
  // a judgment call, it's a structural precondition — the same category as
  // the `TypeError`s above, which also cannot be waived. Letting a waiver
  // remove this finding from `findings` would reopen exactly the gap this
  // whole mechanism exists to close: a caller relying on this package's own
  // README idiom (`findings.some(f => f.severity === "error")`) would see a
  // clean run for a voice that was never actually bound.
  const placeholderPaths = findPlaceholderPaths(record);
  const bound = placeholderPaths.length === 0;
  const unboundFindings: VoiceFinding[] = placeholderPaths.map((path) => ({
    rule: "voice:unbound-placeholder",
    severity: "error",
    message: `This voice record still carries the template placeholder value at "${path}" — voice-record.template.jsonc was copied but never fully filled in. An unbound voice must never be treated as checked; see the README's "The unbound signal". This finding cannot be waived.`,
    path,
  }));

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
  // Unbound-placeholder findings are prepended, not appended: they describe
  // the most fundamental thing wrong with this run (there is no real voice
  // here yet), and — unlike everything else in `findings` — were never
  // eligible for the waiver loop above. See this function's own comment on
  // `unboundFindings` for why.
  findings.unshift(...unboundFindings);

  return {
    findings,
    waived,
    skipped,
    ran,
    complete: skipped.length === 0,
    bound,
  };
}
