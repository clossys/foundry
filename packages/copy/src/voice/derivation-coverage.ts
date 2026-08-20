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
 * not import `@vespeneventures/copy/voice`, so it has no way to know which
 * voice rule ids a real `VoiceRecord` actually declares. `strategy`'s own
 * README says this plainly: "whether a `voiceRules` id resolves to a real
 * `@vespeneventures/copy/voice` glossary entry... [is] a later,
 * cross-package gate's job — one with visibility into... `voice` that this
 * package deliberately does not have." A brand attribute can oblige a voice
 * rule that no `VoiceRecord` anywhere declares, and nothing catches it: the
 * token half of the gate passes cleanly, because it only ever compares
 * against a token slot list, and the voice half is never compared against
 * anything at all. This file is that later gate — built here, in `copy`,
 * because this is the one package that actually holds a `VoiceRecord`.
 *
 * WHAT COUNTS AS A "VOICE RULE ID"
 * ---------------------------------------------------------------------------
 * A `VoiceRecord` (`types.ts`) is not a flat, id-keyed list the way
 * `tokens`' `TOKENS` record is. Its `person` and `tense` rules are each
 * exactly one structural rule with no id of their own — see `fields.ts`'s
 * "WHERE THE LINE ACTUALLY FALLS" for why `VoiceRecord` does not shape like
 * `tokens` at all. The parts of a `VoiceRecord` that DO carry a real,
 * addressable id are its three consumer-authored collections: `glossary`
 * entries (identified by `term` — there is no separate `id` field, see
 * `types.ts`'s `GlossaryEntry`), `claims` (identified by `id`), and
 * `patterns` (identified by `id`, when declared at all). Those three are
 * exactly the "voice rule ids" this file checks obligations against —
 * matching `strategy`'s own README, which names "a real
 * `@vespeneventures/copy/voice` glossary entry" as the resolution target
 * for a `voiceRules` id. `person`/`tense` are structural rule KINDS, fixed
 * once in `types.ts` for every voice forever (see `fields.ts`'s FIXED-vs-
 * BINDABLE split) — there is no id-per-rule for a `BrandDerivation` to name
 * there, the same way a `BrandDerivation` never names "the shape of
 * `VoiceRules` itself" as a `tokenSlots` entry either.
 *
 * THE CHECK ITSELF — BOTH DIRECTIONS, LIKE `checkBrandCoverage`
 * ---------------------------------------------------------------------------
 *   1. Every id in `obligations` is named by some rule the record actually
 *      declares — an obligation naming a rule the record lacks is a stale
 *      or typo'd reference (`obligationsMissingFromRecord`).
 *   2. Every id declared by the record is reached by at least one
 *      obligation — a voice rule with no obligation behind it is
 *      undocumented brand intent, exactly `checkBrandCoverage`'s
 *      `slotsMissingDerivation` mirrored onto the other list
 *      (`recordRulesNotObliged`).
 *
 * A ONE-DIRECTIONAL CHECKER PASSES CASE 2 AND HIDES IT — this file exists
 * specifically because a checker that only implements direction 1 (every
 * obligation resolves) looks complete, passes every obligation-side test,
 * and still never notices a whole voice rule nobody obliged. See
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
 *   - zero voice rule ids in `record` (empty `glossary`/`claims`/no
 *     `patterns`, or all empty) — nothing in the record to check
 *     obligations against. `ok: false`, `reason: "no-rules-in-record"`.
 *
 * `obligationsChecked` and `rulesChecked` are always present, in every
 * branch, for the identical reason `checkBrandCoverage`'s own header states
 * for `slotsChecked`/`derivationsChecked`: so "zero things were checked"
 * and "everything checked out fine" can never be told apart by a caller who
 * only glances at `ok`.
 *
 * A record that failed to parse in the first place (bad JSON, a shape that
 * fails `validateVoiceRecordShape`) never reaches this function at all —
 * see `cli.ts`'s `runVoiceDerivationCoverage`, which — exactly like
 * `main()`'s own handling of an unreadable/invalid copy record — treats
 * that as "could not run" (exit `2`) before ever constructing a `VoiceRecord`
 * to call this pure function with. That mirrors this package's own existing
 * convention (`readCopyRecord`'s failure short-circuits `main()` the same
 * way, without `checkCopyTraceability` ever being called) rather than this
 * pure function accepting untrusted input and re-deriving that state itself.
 *
 * THE NAME-ONLY SEAM, ON THIS SIDE
 * ---------------------------------------------------------------------------
 * `obligations` are plain strings — the exact same discipline
 * `BrandDerivation.voiceRules` documents for itself, carried through to
 * this side of the seam. This file does not import `@vespeneventures/
 * strategy` or know anything about `BrandDerivation`; a caller who already
 * depends on both packages is the one place that seam gets closed, by
 * flattening every `BrandDerivation.voiceRules` entry (across every
 * derivation) into the flat `obligations` list this function takes — the
 * same shape `strategy`'s own README shows for `brandableSlots`.
 *
 * Pure — no I/O, never throws.
 */

import type { VoiceRecord } from "./types.js";

/**
 * Why a `VoiceDerivationCoverageResult` is not `ok`, when it isn't.
 * `"coverage-gap"` is a REAL finding — some obligation names a rule the
 * record lacks, or some rule in the record is reached by no obligation —
 * over a genuine, non-empty comparison. `"no-obligations-provided"` and
 * `"no-rules-in-record"` are the OTHER kind of failure: nothing meaningful
 * was compared at all. See this file's top-of-file doc comment, "Fails
 * closed".
 */
export type VoiceDerivationCoverageFailureReason = "no-obligations-provided" | "no-rules-in-record" | "coverage-gap";

export interface VoiceDerivationCoverageResult {
  ok: boolean;
  /** `obligations.length`, always present — see this file's header comment, "Fails closed". */
  obligationsChecked: number;
  /** The number of distinct voice rule ids found in `record` (see "WHAT COUNTS AS A VOICE RULE ID"), always present, for the same reason. */
  rulesChecked: number;
  /** Direction 1: every obligation naming a rule id `record` does not declare. */
  obligationsMissingFromRecord: string[];
  /** Direction 2: every voice rule id `record` declares that no obligation names. */
  recordRulesNotObliged: string[];
  /** Present exactly when `ok` is `false`. See `VoiceDerivationCoverageFailureReason`. */
  reason?: VoiceDerivationCoverageFailureReason;
}

/**
 * Every id-bearing voice rule `record` actually declares — see this file's
 * top-of-file doc comment, "WHAT COUNTS AS A VOICE RULE ID", for exactly
 * why these three collections (and not `person`/`tense`) are the ones that
 * apply. De-duplicated: a glossary term, claim id, or pattern id repeated
 * more than once (which `record` itself may or may not consider valid —
 * this function does not judge that) still counts as one rule to check
 * coverage against.
 */
function voiceRuleIdsInRecord(record: VoiceRecord): string[] {
  const ids = new Set<string>();
  for (const entry of record.glossary) ids.add(entry.term);
  for (const claim of record.claims) ids.add(claim.id);
  for (const pattern of record.patterns ?? []) ids.add(pattern.id);
  return [...ids];
}

/**
 * Checks whether `obligations` fully accounts for the voice rule ids
 * `record` declares, in both directions, and fails closed on either empty
 * input. Pure — no I/O, never throws. See this file's top-of-file doc
 * comment for the full design, and `strategy`'s `checkBrandCoverage` (which
 * this mirrors) for the precedent.
 */
export function checkVoiceDerivationCoverage(
  obligations: readonly string[],
  record: VoiceRecord,
): VoiceDerivationCoverageResult {
  const obligationsChecked = obligations.length;
  const ruleIds = voiceRuleIdsInRecord(record);
  const rulesChecked = ruleIds.length;

  const ruleIdSet = new Set(ruleIds);
  const obligedSet = new Set(obligations);

  const obligationsMissingFromRecord = obligations.filter((id) => !ruleIdSet.has(id));
  const recordRulesNotObliged = ruleIds.filter((id) => !obligedSet.has(id));

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
      reason: "no-rules-in-record",
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
