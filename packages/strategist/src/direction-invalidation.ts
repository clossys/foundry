/**
 * `checkDirectionCoverage` and `checkDirectionCurrency` — what turns a
 * `DirectionEntity` (see `schema.ts`) from a record into an obligation.
 * Mirrors `checkBrandCoverage`'s own shape (`brand-derivation.ts`) closely
 * enough that reading that file's header first is the fastest way into
 * this one; where the two diverge is the point.
 *
 * FACTS DRIFT, DIRECTION IS CHANGED — WHY TWO CHECKERS, NOT ONE
 * -----------------------------------------------------------------
 * A `Fact` goes stale because reality moved underneath it with nobody
 * deciding anything — `checkFactsTraceability` (`facts-gate.ts`) exists to
 * catch that. A `DirectionEntity` never goes stale that way: nothing about
 * a vision statement becomes false on its own. What CAN go stale is
 * something built on top of it, the moment a newer, deliberately decided
 * version supersedes the one it was built against. That is a different
 * failure shape from drift, and it needs two different questions asked of
 * it, not one:
 *
 *   1. `checkDirectionCoverage` — the same two-directional shape
 *      `checkBrandCoverage` already uses: does every direction entity have
 *      at least one derived artifact behind it (a vision nothing derives
 *      from is a poster on a wall), and does every derived artifact
 *      actually trace to a real direction entity (an artifact citing
 *      nothing real is unaccountable). This says nothing about whether the
 *      entity a derived artifact traces to is still CURRENT — only whether
 *      the reference resolves at all.
 *
 *   2. `checkDirectionCurrency` — the check `checkDirectionCoverage`
 *      cannot do and was never asked to: does every derived artifact's
 *      `reviewedAgainst` name a version that is not just present, but
 *      CURRENT (nothing else's `supersedes` names it). A derived artifact
 *      whose `reviewedAgainst` names a real, existing, but SUPERSEDED
 *      direction entity passes every presence check there is — the
 *      reference resolves cleanly — while still citing a decision nobody
 *      stands behind anymore. That gap is the entire reason this file
 *      exists as two functions instead of folding "is it current" into
 *      `checkDirectionCoverage`'s own existence check: a coverage checker
 *      that also silently absorbed currency would make it impossible for a
 *      caller to ask "does this reference resolve" without ALSO asking "is
 *      it still the current one", which are genuinely different questions
 *      with genuinely different remediation (coverage: someone has to
 *      build the missing artifact or fix the typo'd reference; currency:
 *      someone has to re-review the artifact against the new decision).
 *
 * NAME-ONLY, LIKE EVERYTHING ELSE IN THIS PACKAGE
 * -------------------------------------------------
 * Neither checker takes a "derived artifact" object. This package has no
 * fixed idea of what a derived artifact even IS — a token slot, a voice
 * rule, a piece of copy, a roadmap item, a `BrandAttribute` — and forcing
 * one shape on all of them would be exactly the parallel system
 * `schema.ts`'s own `DirectionEntity` doc comment explains why this
 * package avoids. Instead, both checkers take the flat list of
 * `reviewedAgainst` strings a caller has already pulled off however many
 * real derived artifacts it owns — one entry per artifact, duplicates
 * meaningful (see `checkDirectionCurrency`'s own doc comment on why it
 * does not deduplicate). This is the same "both lists caller-supplied
 * plain strings" seam `checkBrandCoverage` uses for `brandableSlots`,
 * generalized to both of this file's checkers.
 *
 * FAILS CLOSED, THE SAME WAY
 * ----------------------------
 * Exactly like `checkBrandCoverage`: a checker handed nothing to check
 * must never report the same shape as a checker that checked everything
 * and found it clean. Both functions below treat an empty `directionIds`/
 * `entities` OR an empty `reviewedAgainstRefs` as an explicit failure
 * (`ok: false`, an indeterminate `reason`), never a vacuous pass — and
 * both always report their checked counts, in every branch, so "zero
 * things were checked" can never be mistaken for "checked and clean" by a
 * caller that only glances at `ok`.
 */

import type { DirectionEntity } from "./schema.js";

// -------------------------------------------------------------- coverage

/**
 * Why a `DirectionCoverageResult` is not `ok`, when it isn't.
 * `"coverage-gap"` is a REAL finding over a genuine, non-empty comparison.
 * `"no-entities-provided"`/`"no-reviews-provided"` are the OTHER kind: no
 * meaningful comparison happened at all. See this file's header comment,
 * "Fails closed".
 */
export type DirectionCoverageFailureReason = "no-entities-provided" | "no-reviews-provided" | "coverage-gap";

export interface DirectionCoverageResult {
  ok: boolean;
  /** `directionIds.length`, always present. */
  entitiesChecked: number;
  /** `reviewedAgainstRefs.length`, always present. */
  derivedArtifactsChecked: number;
  /** Direction 1: every `directionIds` entry named by no `reviewedAgainstRefs` entry — a direction entity with nothing derived from it. */
  entitiesWithoutDerivedArtifact: string[];
  /** Direction 2: every DISTINCT `reviewedAgainstRefs` entry that names no id in `directionIds` — a derived artifact that traces to nothing real. */
  untraceableDerivedArtifacts: string[];
  /** Present exactly when `ok` is `false`. See `DirectionCoverageFailureReason`. */
  reason?: DirectionCoverageFailureReason;
}

/**
 * Checks whether `reviewedAgainstRefs` — the flat list of every derived
 * artifact's `reviewedAgainst` value — fully accounts for `directionIds`,
 * in both directions, and fails closed on either empty input. Pure — no
 * I/O, never throws. This says nothing about whether a resolved reference
 * is still CURRENT — see `checkDirectionCurrency` for that, and this
 * file's header comment for why the two are deliberately separate.
 */
export function checkDirectionCoverage(
  directionIds: string[],
  reviewedAgainstRefs: string[],
): DirectionCoverageResult {
  const entitiesChecked = directionIds.length;
  const derivedArtifactsChecked = reviewedAgainstRefs.length;

  const idSet = new Set(directionIds);
  const referencedIds = new Set(reviewedAgainstRefs);

  const entitiesWithoutDerivedArtifact = directionIds.filter((id) => !referencedIds.has(id));
  const untraceableDerivedArtifacts = [...referencedIds].filter((ref) => !idSet.has(ref));

  if (entitiesChecked === 0) {
    return {
      ok: false,
      entitiesChecked,
      derivedArtifactsChecked,
      entitiesWithoutDerivedArtifact,
      untraceableDerivedArtifacts,
      reason: "no-entities-provided",
    };
  }

  if (derivedArtifactsChecked === 0) {
    return {
      ok: false,
      entitiesChecked,
      derivedArtifactsChecked,
      entitiesWithoutDerivedArtifact,
      untraceableDerivedArtifacts,
      reason: "no-reviews-provided",
    };
  }

  const ok = entitiesWithoutDerivedArtifact.length === 0 && untraceableDerivedArtifacts.length === 0;
  return {
    ok,
    entitiesChecked,
    derivedArtifactsChecked,
    entitiesWithoutDerivedArtifact,
    untraceableDerivedArtifacts,
    reason: ok ? undefined : "coverage-gap",
  };
}

// --------------------------------------------------------------- currency

/**
 * `"dangling-reference"` — the `reviewedAgainst` value names no
 * `DirectionEntity.id` this run was given at all. `"stale-review"` — it
 * names a REAL entity, but one some other entity's `supersedes` already
 * names: the reference resolves, but the decision it was reviewed against
 * is no longer the current one. This is the separating finding
 * `checkDirectionCoverage` cannot produce — a weaker tool that only checks
 * "does this id exist" is passed by exactly the artifact that produces
 * `"stale-review"` here, because its reference DOES exist. See this file's
 * header comment.
 */
export type DirectionCurrencyFindingKind = "dangling-reference" | "stale-review";

export interface DirectionCurrencyFinding {
  /** The `reviewedAgainst` value this finding is about. */
  reviewedAgainst: string;
  kind: DirectionCurrencyFindingKind;
  /** For `"stale-review"` only: the `id` of the `DirectionEntity` whose `supersedes` names `reviewedAgainst` — the version that replaced it. */
  supersededBy?: string;
}

export type DirectionCurrencyFailureReason = "no-entities-provided" | "no-reviews-provided" | "currency-violation";

export interface DirectionCurrencyResult {
  ok: boolean;
  /** `entities.length`, always present. */
  entitiesChecked: number;
  /** `reviewedAgainstRefs.length`, always present. */
  reviewsChecked: number;
  /**
   * One entry per `reviewedAgainstRefs` element that is dangling or stale.
   * Deliberately NOT deduplicated: two different derived artifacts that
   * both cite the same now-superseded version are two separate findings,
   * one per artifact — "bump a direction entity and assert every
   * downstream artifact goes stale in the same run" (issue #374) requires
   * being able to count how many artifacts went stale, not just whether
   * the id did.
   */
  findings: DirectionCurrencyFinding[];
  /** Present exactly when `ok` is `false`. See `DirectionCurrencyFailureReason`. */
  reason?: DirectionCurrencyFailureReason;
}

/**
 * Checks whether every entry in `reviewedAgainstRefs` names a
 * `DirectionEntity.id` that both EXISTS in `entities` and is CURRENT
 * (nothing in `entities` supersedes it). Fails closed on either empty
 * input. Pure — no I/O, never throws.
 *
 * "Current" is computed, never stored: an id is current unless some OTHER
 * entity's `supersedes` names it. Bumping a direction entity is exactly
 * "add a new `DirectionEntity` whose `supersedes` names the old `id`" —
 * nothing about the old entity itself changes, and every derived artifact
 * still `reviewedAgainst`-ing it goes stale as a direct, computed
 * consequence, not because anything went and marked it stale by hand.
 */
export function checkDirectionCurrency(
  entities: DirectionEntity[],
  reviewedAgainstRefs: string[],
): DirectionCurrencyResult {
  const entitiesChecked = entities.length;
  const reviewsChecked = reviewedAgainstRefs.length;

  const knownIds = new Set(entities.map((entity) => entity.id));
  const supersededBy = new Map<string, string>();
  for (const entity of entities) {
    if (entity.supersedes !== undefined) supersededBy.set(entity.supersedes, entity.id);
  }

  const findings: DirectionCurrencyFinding[] = [];
  for (const ref of reviewedAgainstRefs) {
    if (!knownIds.has(ref)) {
      findings.push({ reviewedAgainst: ref, kind: "dangling-reference" });
      continue;
    }
    const supersedingId = supersededBy.get(ref);
    if (supersedingId !== undefined) {
      findings.push({ reviewedAgainst: ref, kind: "stale-review", supersededBy: supersedingId });
    }
  }

  if (entitiesChecked === 0) {
    return { ok: false, entitiesChecked, reviewsChecked, findings, reason: "no-entities-provided" };
  }

  if (reviewsChecked === 0) {
    return { ok: false, entitiesChecked, reviewsChecked, findings, reason: "no-reviews-provided" };
  }

  const ok = findings.length === 0;
  return { ok, entitiesChecked, reviewsChecked, findings, reason: ok ? undefined : "currency-violation" };
}
