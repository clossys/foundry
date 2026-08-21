/**
 * `checkVoiceDerivationCoverage` — the voice half of `@vespeneventures/
 * strategy`'s `checkBrandCoverage`, which this file mirrors closely on
 * purpose. Read `packages/strategy/src/brand-derivation.ts`'s header
 * comment in full before touching this one; the design below is that
 * file's, ported to the other side of the seam it documents.
 *
 * THE GAP THIS CLOSES
 * ---------------------------------------------------------------------------
 * A `BrandDerivation` (`strategy`) names two kinds of obligation by PLAIN
 * STRING: `tokenSlots` and `voiceRules` — see that file's "THE NAME-ONLY
 * SEAM, AND WHY". `checkBrandCoverage` verifies the `tokenSlots` half
 * against a caller-supplied `brandableSlots: string[]`, in both directions.
 * It does NOT, and by its own package's constraints CANNOT, verify the
 * `voiceRules` half — `strategy` ships zero runtime dependencies and does
 * not import `@vespeneventures/writer/voice`, so it has no way to know which
 * voice rule ids a real `VoiceRecord` actually declares. `strategy`'s own
 * README says this plainly: "whether a `voiceRules` id resolves to a real
 * `@vespeneventures/writer/voice` glossary entry... [is] a later,
 * cross-package gate's job — one with visibility into... `voice` that this
 * package deliberately does not have." A brand attribute can oblige a voice
 * rule that no `VoiceRecord` anywhere declares, and nothing catches it: the
 * token half of the gate passes cleanly, because it only ever compares
 * against a token slot list, and the voice half is never compared against
 * anything at all. This file is that later gate — built here, in `copy`,
 * because this is the one package that actually holds a `VoiceRecord`.
 *
 * THE NAME-ONLY SEAM, AND WHY
 * ---------------------------------------------------------------------------
 * This function takes two PLAIN STRING LISTS, `obligations` and
 * `brandDerivedRuleIds` — the exact same discipline `BrandDerivation.
 * voiceRules` documents for itself, carried through to this side of the
 * seam, and the exact same shape `checkBrandCoverage` takes
 * `brandableSlots` in. This file does not import `@vespeneventures/
 * strategy` or know anything about `BrandDerivation`, and it does not read
 * a `VoiceRecord` either. Earlier revisions of this function DID take a
 * `VoiceRecord` and scanned it for every glossary term, claim id, and
 * pattern id, treating that whole scan as the set direction 2 had to cover.
 * That was wrong, and it was wrong for the identical reason `strategy`
 * cannot look up `tokens`' `brandable` flag itself: EVERY field in a
 * `VoiceRecord` is consumer-authored, but authored is not the same claim as
 * brand-derived. `@vespeneventures/ui` ships 154 tokens and marks a curated
 * 42 of them `brandable: true` — a deliberate subset a `BrandDerivation`'s
 * `tokenSlots` is checked against, never the full 154. `voice` has no
 * `brandable`-equivalent flag on a glossary entry or a claim, so scanning
 * the whole record and calling that "the brand-derived set" silently
 * substituted "everything a consumer happened to author" for "everything a
 * brand attribute actually obliges" — a consumer with 200 glossary terms
 * and one real brand obligation would need 200 `BrandDerivation.voiceRules`
 * entries just to pass direction 2, a false-positive machine that gets
 * disabled the first time it fires on a real record. Nothing inside a
 * `VoiceRecord`, and nothing inside this package, can tell a brand-derived
 * glossary term from an editorially-authored one — that judgment lives only
 * where a `BrandDerivation` and a `VoiceRecord` are both in scope, i.e. the
 * caller.
 *
 * THE CHECKER'S SEAM — READ THIS BEFORE CALLING `checkVoiceDerivationCoverage`
 * ---------------------------------------------------------------------------
 * Because this package cannot know which of a `VoiceRecord`'s ids a brand
 * attribute actually derived, `checkVoiceDerivationCoverage` cannot look
 * that set up itself. It takes it as an argument (`brandDerivedRuleIds:
 * readonly string[]`) instead. This is deliberate, not a missing feature:
 * the CALLER — a consumer repo that depends on both `strategy` and `copy`,
 * or a later cross-package gate built with visibility into both — is the
 * one place that seam can be closed for real, e.g. by flattening every
 * `BrandDerivation.voiceRules` entry (across every derivation) into the
 * flat `brandDerivedRuleIds` list this function takes, the same way a
 * caller closes `checkBrandCoverage`'s seam by passing
 * `Object.values(TOKENS).filter(t => t.brandable).map(t => t.property)`
 * from `@vespeneventures/ui/tokens`. `checkVoiceDerivationCoverage` only
 * ever sees the two plain lists it's handed; it has no way to tell a real,
 * current, brand-derived rule-id list from a stale or empty one, which is
 * exactly why the degenerate cases below (an empty list either way) are
 * treated as failures rather than silent passes — see "Fails closed",
 * below.
 *
 * WHAT COUNTS AS A "VOICE RULE ID"
 * ---------------------------------------------------------------------------
 * This function no longer inspects a `VoiceRecord` at all, so it does not
 * decide what counts as a rule id — the caller does, by what it puts in
 * `brandDerivedRuleIds`. In practice that id space is still the one
 * `strategy`'s own README names for `voiceRules`: "a real
 * `@vespeneventures/writer/voice` glossary entry" — i.e. a glossary term's
 * `term` or a claim's `id` (`types.ts`'s `GlossaryEntry`/`Claim`). Earlier
 * revisions of this file additionally counted `patterns` ids as voice rule
 * ids by auto-deriving the whole set from a record; that widened direction
 * 2 beyond what `strategy`'s documented `voiceRules` contract actually
 * names, purely as a side effect of this package doing the scanning itself.
 * With no record to scan and a caller-supplied list instead, this package
 * no longer makes that decision — the caller decides what belongs in
 * `brandDerivedRuleIds`, exactly as the caller decides what belongs in
 * `checkBrandCoverage`'s `brandableSlots`.
 *
 * THE CHECK ITSELF — BOTH DIRECTIONS, LIKE `checkBrandCoverage`
 * ---------------------------------------------------------------------------
 *   1. Every id in `obligations` is named by `brandDerivedRuleIds` — an
 *      obligation naming an id nothing derived is a stale or typo'd
 *      reference (`obligationsMissingFromRecord`).
 *   2. Every id in `brandDerivedRuleIds` is reached by at least one
 *      obligation — a brand-derived rule id with no obligation behind it
 *      is undocumented brand intent, exactly `checkBrandCoverage`'s
 *      `slotsMissingDerivation` mirrored onto the other list
 *      (`recordRulesNotObliged`).
 *
 * A ONE-DIRECTIONAL CHECKER PASSES CASE 2 AND HIDES IT — this file exists
 * specifically because a checker that only implements direction 1 (every
 * obligation resolves) looks complete, passes every obligation-side test,
 * and still never notices a whole brand-derived rule id nobody obliged. See
 * `derivation-coverage.test.ts` for the fixture built to prove this file
 * does not make that mistake.
 *
 * FAILS CLOSED, IDENTICAL PRECEDENT TO `checkBrandCoverage`
 * ---------------------------------------------------------------------------
 * A checker given nothing to check must never report the same shape as a
 * checker that checked everything and found it clean. Both degenerate
 * inputs are an explicit failure, never a vacuous pass:
 *
 *   - `obligations.length === 0` — nothing was obliged at all. `ok: false`,
 *     `reason: "no-obligations-provided"`.
 *   - `brandDerivedRuleIds.length === 0` — nothing to check obligations
 *     against. Maybe the caller forgot to pass the real list, maybe a
 *     consumer genuinely derived zero voice rules from its brand; either
 *     way this function cannot tell the difference, so it cannot report
 *     success. `ok: false`, `reason: "no-brand-derived-rules-provided"`.
 *
 * `obligationsChecked` and `rulesChecked` are always present, in every
 * branch, for the identical reason `checkBrandCoverage`'s own header states
 * for `slotsChecked`/`derivationsChecked`: so "zero things were checked"
 * and "everything checked out fine" can never be told apart by a caller who
 * only glances at `ok`.
 *
 * Pure — no I/O, never throws.
 */

/**
 * Why a `VoiceDerivationCoverageResult` is not `ok`, when it isn't.
 * `"coverage-gap"` is a REAL finding — some obligation names an id nothing
 * derived, or some brand-derived rule id is reached by no obligation —
 * over a genuine, non-empty comparison. `"no-obligations-provided"` and
 * `"no-brand-derived-rules-provided"` are the OTHER kind of failure:
 * nothing meaningful was compared at all. See this file's top-of-file doc
 * comment, "Fails closed".
 */
export type VoiceDerivationCoverageFailureReason =
  | "no-obligations-provided"
  | "no-brand-derived-rules-provided"
  | "coverage-gap";

export interface VoiceDerivationCoverageResult {
  ok: boolean;
  /** `obligations.length`, always present — see this file's header comment, "Fails closed". */
  obligationsChecked: number;
  /** `brandDerivedRuleIds.length`, always present, for the same reason. */
  rulesChecked: number;
  /** Direction 1: every obligation naming an id `brandDerivedRuleIds` does not declare. */
  obligationsMissingFromRecord: string[];
  /** Direction 2: every id in `brandDerivedRuleIds` that no obligation names. */
  recordRulesNotObliged: string[];
  /** Present exactly when `ok` is `false`. See `VoiceDerivationCoverageFailureReason`. */
  reason?: VoiceDerivationCoverageFailureReason;
}

/**
 * Checks whether `obligations` fully accounts for `brandDerivedRuleIds`, in
 * both directions, and fails closed on either empty input. Pure — no I/O,
 * never throws. See this file's top-of-file doc comment for the seam
 * (`brandDerivedRuleIds` is caller-supplied, since this package has no way
 * to tell a brand-derived voice rule id from any other consumer-authored
 * one) and for why the two degenerate inputs are failures rather than
 * vacuous passes. See `strategy`'s `checkBrandCoverage` (which this
 * mirrors) for the precedent.
 */
export function checkVoiceDerivationCoverage(
  obligations: readonly string[],
  brandDerivedRuleIds: readonly string[],
): VoiceDerivationCoverageResult {
  const obligationsChecked = obligations.length;
  const rulesChecked = brandDerivedRuleIds.length;

  const ruleIdSet = new Set(brandDerivedRuleIds);
  const obligedSet = new Set(obligations);

  const obligationsMissingFromRecord = obligations.filter((id) => !ruleIdSet.has(id));
  const recordRulesNotObliged = brandDerivedRuleIds.filter((id) => !obligedSet.has(id));

  if (obligationsChecked === 0) {
    return {
      ok: false,
      obligationsChecked,
      rulesChecked,
      obligationsMissingFromRecord,
      recordRulesNotObliged,
      reason: "no-obligations-provided",
    };
  }

  if (rulesChecked === 0) {
    return {
      ok: false,
      obligationsChecked,
      rulesChecked,
      obligationsMissingFromRecord,
      recordRulesNotObliged,
      reason: "no-brand-derived-rules-provided",
    };
  }

  const ok = obligationsMissingFromRecord.length === 0 && recordRulesNotObliged.length === 0;
  return {
    ok,
    obligationsChecked,
    rulesChecked,
    obligationsMissingFromRecord,
    recordRulesNotObliged,
    reason: ok ? undefined : "coverage-gap",
  };
}
