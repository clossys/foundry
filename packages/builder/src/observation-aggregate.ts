/**
 * The observation reader/aggregator (#255, narrowed): folds N already-
 * fetched observation bundles (`./observation-bundle.ts`) into one
 * plane-level report.
 *
 * FETCHING IS NOT THIS MODULE'S JOB
 * -----------------------------------
 * `aggregateObservations` takes `bundles` as already-in-memory data --
 * `unknown[]`, exactly as a caller's own CI would hand back the parsed body
 * of N already-completed fetches (a committed artifact read from a checkout,
 * a release asset downloaded over the network, anything else). This module
 * never fetches anything itself: no network I/O, no GitHub API coupling, no
 * storage opinion. See the package README's "what this is not" section.
 *
 * INDETERMINATE, NEVER OMITTED, NEVER SATISFIED
 * -------------------------------------------------
 * A repository this aggregation expected to hear from but did not, a bundle
 * that does not pass `validateObservationBundleShape`, a bundle whose
 * `producedAt` is older than the caller's own staleness threshold, and two
 * or more bundles that both claim to be the same repository's observation,
 * are four different reasons a repository's status here cannot be a real
 * verdict -- and every one of them becomes `indeterminate` for that
 * repository, carrying a named, legible reason. None of the four are
 * "satisfied" (a repository this aggregation never actually heard from
 * clean is not evidence it is clean), and none of the four are silently
 * dropped from the report the way an ordinary filter/map pipeline would
 * drop them by construction: `repositories` below always carries exactly
 * one entry per repository named in `expectedRepositories`, in the same
 * order, whether or not a usable bundle was ever found for it. `overall`
 * folds all of them with this package's own `foldGateResults`
 * (`@clossys/controller/gates`), whose documented precedence --
 * indeterminate beats violated beats satisfied -- is exactly the rule that
 * keeps "2 of 5 repositories were unobserved" from silently reading as "the
 * 3 we did hear from were clean, so we're done."
 *
 * STALENESS IS CALLER-DEFINED
 * ------------------------------
 * `now` and `staleAfterMs` are both supplied by the caller. This module
 * never calls `Date.now()` -- a function that reads its own clock cannot be
 * tested for "this bundle is 40 days old" without actually waiting 40 days,
 * or without mocking a global the caller does not control either. Both
 * timestamps are compared as parsed instants, never as strings -- see this
 * repository's own `#314` fix (`@clossys/controller`'s
 * `liveStateSurface`) for the class of bug that lexical timestamp
 * comparison produces across UTC offsets.
 *
 * THIS AGGREGATE'S OWN AGE IS A SEPARATE QUESTION FROM ANY BUNDLE'S (#340)
 * ---------------------------------------------------------------------------
 * `stale-observation` above answers "is any ONE contributing bundle too old
 * to fold in." It cannot answer a different question: "is this AGGREGATION
 * ITSELF -- the computed `overall` verdict -- too old to still be presented
 * as current." Those are different failure modes with the same shape. A
 * plane that only triggers this aggregation on a push to the repository that
 * hosts it can go a long time between runs; every one of its inputs can
 * change -- a contributing repository's publisher can start succeeding again
 * after having failed -- with nothing re-evaluating the aggregate to notice.
 * The result computed at the last run stays exactly as accurate as it was
 * the moment it was computed, and exactly as wrong as it likes for every
 * moment after, because nothing about `aggregateObservations` itself can
 * ever detect that: `computedAt` always equals the `now` this function was
 * called with, so no check inside this function can ever observe its own
 * result aging.
 *
 * `AggregateObservationsResult` therefore carries `computedAt` (echoing
 * `now`) and `maxResultAgeMs` (echoing `input.maxResultAgeMs`, the caller's
 * own declared answer to "how long am I willing to vouch for this verdict
 * without re-running") -- not because either is useful at the instant this
 * function returns, but because a caller that PERSISTS this result (a
 * committed artifact, a status check, anything read later by something
 * other than this exact call) hands a later reader everything needed to ask
 * the question this function cannot ask of itself. `checkObservationAggregate
 * Freshness`, below, is that later check: given a stored result's
 * `computedAt`/`maxResultAgeMs` and a FRESH `now` supplied at read time, it
 * reports `indeterminate` (`"stale-aggregate-result"` -- a reason distinct
 * from `stale-observation`, never a restated one, because the two questions
 * are different) the moment the aggregate can no longer vouch for its own
 * age. A schedule makes that staleness less likely; only this makes it
 * detectable, because it is the one check that still works when the
 * schedule itself has silently stopped firing.
 *
 * Zero I/O. Every bundle, the expected repository list, `now`,
 * `staleAfterMs`, and `maxResultAgeMs` are all supplied by the caller.
 */

import { foldGateResults, gateIndeterminate, gateSatisfied } from "@clossys/controller/gates";
import type { GateResult } from "@clossys/controller/gates";
import type { Finding } from "./types.js";
import { parseObservationBundle } from "./observation-bundle.js";

/** The finite set of reasons a repository's observation can be indeterminate for, as one frozen list for enumeration (`--help` text, a report legend). */
export const OBSERVATION_AGGREGATE_INDETERMINATE_REASONS = Object.freeze([
  "unobserved-repository",
  "invalid-bundle-schema",
  "duplicate-repository-identity",
  "stale-observation",
  "unattributed-bundle",
  "unusable-timestamp",
] as const);

export type ObservationAggregateIndeterminateReason = (typeof OBSERVATION_AGGREGATE_INDETERMINATE_REASONS)[number];

/**
 * The reason `checkObservationAggregateFreshness` reports when a computed
 * `AggregateObservationsResult` is too old to vouch for. Deliberately its
 * own single-entry vocabulary, separate from
 * `OBSERVATION_AGGREGATE_INDETERMINATE_REASONS` above: those five name why
 * one CONTRIBUTING BUNDLE could not be folded in at aggregation time;
 * `"stale-aggregate-result"` names why the AGGREGATE'S OWN RESULT can no
 * longer be presented as current, a question only askable later, at read
 * time -- see the module header. Reusing `"stale-observation"` for this
 * would be exactly the restated-stale-verdict outcome #340 calls out: a
 * reader would not be able to tell "one bundle was old when this ran" from
 * "this whole verdict is old now" from the reason string alone.
 */
export const OBSERVATION_AGGREGATE_RESULT_INDETERMINATE_REASONS = Object.freeze(["stale-aggregate-result", "unusable-timestamp"] as const);

export type ObservationAggregateResultIndeterminateReason = (typeof OBSERVATION_AGGREGATE_RESULT_INDETERMINATE_REASONS)[number];

/**
 * One repository's folded status: either the fold of its own bundle's
 * gates (satisfied/violated), or one of the four structural indeterminate
 * reasons above. `Finding` here is whatever the repository's own gates
 * reported -- see `./observation-bundle.ts`'s `ObservationBundleGateEntry`.
 */
export type RepositoryObservationResult = GateResult<Finding, string>;

/** One expected repository's status, always present -- see the module header on "never omitted." */
export interface RepositoryObservationStatus {
  readonly repositoryId: string;
  readonly result: RepositoryObservationResult;
}

export interface AggregateObservationsInput {
  /** Every repository this aggregation expects an observation from. Must not contain a duplicate id. */
  readonly expectedRepositories: readonly string[];
  /** Already-fetched, unvalidated payloads -- see the module header. Each is validated independently; a malformed entry never throws. */
  readonly bundles: readonly unknown[];
  /** The caller's own "now", ISO 8601. Never read from a clock inside this module. */
  readonly now: string;
  /** How old (in milliseconds) a bundle's `producedAt` may be, relative to `now`, before it is stale. */
  readonly staleAfterMs: number;
  /**
   * How old (in milliseconds) this AGGREGATION's own computed result may
   * become before it can no longer be presented as current -- carried
   * through, unchanged, to `AggregateObservationsResult.maxResultAgeMs`.
   * Distinct from `staleAfterMs`: that bounds one contributing bundle's age
   * at aggregation time; this bounds the aggregate's OWN age at whatever
   * later moment a persisted copy of this result is actually read -- see
   * the module header and `checkObservationAggregateFreshness`, the
   * function that later check is performed with. Required, not defaulted --
   * this repository has no basis for guessing how long any particular
   * caller is willing to trust a verdict it did not just compute.
   */
  readonly maxResultAgeMs: number;
}

export interface AggregateObservationsResult {
  readonly expectedCount: number;
  /** How many entries in `bundles` passed schema validation -- independent of whether they matched an expected repository, were duplicates, or were stale. */
  readonly receivedCount: number;
  /** Expected repository ids for which no usable bundle was found at all. A first-class part of the result -- see the module header. */
  readonly unobservedRepositories: readonly string[];
  /** Repository ids that appeared in `bundles` but were never named in `expectedRepositories`. Informational only -- never gates `overall`. */
  readonly unexpectedRepositories: readonly string[];
  /** Entries in `bundles` so malformed that not even a repository id could be read from them, so they could not be attributed to anyone. Counted, never silently dropped. */
  readonly unattributedCount: number;
  /** One status per repository in `expectedRepositories`, in the same order. */
  readonly repositories: readonly RepositoryObservationStatus[];
  /** The fold of every `repositories[].result`, via `foldGateResults`. Satisfied only when every expected repository was cleanly observed and satisfied. */
  readonly overall: RepositoryObservationResult;
  /**
   * When this result was computed -- echoes `input.now` verbatim, ISO 8601.
   * A caller that persists this result (rather than consuming `overall`
   * immediately) hands this field to `checkObservationAggregateFreshness`,
   * later, alongside a fresh `now`, to ask the question this function
   * itself cannot ask of its own output -- see the module header.
   */
  readonly computedAt: string;
  /**
   * Echoes `input.maxResultAgeMs` verbatim -- this result's own declared
   * answer to "how long am I willing to be vouched for," carried alongside
   * `computedAt` so a later reader of a persisted copy of this result never
   * has to source that threshold from anywhere else out of band.
   */
  readonly maxResultAgeMs: number;
}

function extractRepositoryId(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const repository = (raw as Record<string, unknown>).repository;
  if (typeof repository !== "object" || repository === null || Array.isArray(repository)) return undefined;
  const id = (repository as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() !== "" ? id : undefined;
}

interface GroupedBundle {
  readonly index: number;
  readonly parsed: ReturnType<typeof parseObservationBundle>;
}

/**
 * Folds `input.bundles` into one plane-level report. See the module header
 * for the indeterminate semantics; see `AggregateObservationsResult` for
 * what is reported and why nothing is ever silently dropped.
 *
 * Throws only on a caller precondition being violated directly (a
 * duplicate `expectedRepositories` entry, an unparseable `now`, a negative
 * `staleAfterMs`) -- never on anything found IN `bundles`, which is exactly
 * the data this function exists to report on rather than crash over.
 */
export function aggregateObservations(input: AggregateObservationsInput): AggregateObservationsResult {
  const { expectedRepositories, bundles, now, staleAfterMs, maxResultAgeMs } = input;

  const seenExpected = new Set<string>();
  for (const repositoryId of expectedRepositories) {
    if (seenExpected.has(repositoryId)) {
      throw new Error(
        `aggregateObservations: "expectedRepositories" contains a duplicate entry: ${JSON.stringify(repositoryId)}. Name each expected repository once.`,
      );
    }
    seenExpected.add(repositoryId);
  }

  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    throw new Error(`aggregateObservations: "now" must be a parseable ISO 8601 instant, got ${JSON.stringify(now)}.`);
  }
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0) {
    throw new Error(`aggregateObservations: "staleAfterMs" must be a non-negative finite number, got ${JSON.stringify(staleAfterMs)}.`);
  }
  if (!Number.isFinite(maxResultAgeMs) || maxResultAgeMs < 0) {
    throw new Error(`aggregateObservations: "maxResultAgeMs" must be a non-negative finite number, got ${JSON.stringify(maxResultAgeMs)}.`);
  }

  const byRepository = new Map<string, GroupedBundle[]>();
  let unattributedCount = 0;
  let receivedCount = 0;

  bundles.forEach((raw, index) => {
    const parsed = parseObservationBundle(raw);
    if (parsed.ok) receivedCount += 1;

    const repositoryId = parsed.ok ? parsed.bundle.repository.id : extractRepositoryId(raw);
    if (repositoryId === undefined) {
      unattributedCount += 1;
      return;
    }

    const entry: GroupedBundle = { index, parsed };
    const existing = byRepository.get(repositoryId);
    if (existing) existing.push(entry);
    else byRepository.set(repositoryId, [entry]);
  });

  const unexpectedRepositories = [...byRepository.keys()].filter((id) => !seenExpected.has(id)).sort();

  const repositories: RepositoryObservationStatus[] = expectedRepositories.map((repositoryId) => {
    const entries = byRepository.get(repositoryId) ?? [];

    if (entries.length === 0) {
      return {
        repositoryId,
        result: gateIndeterminate(
          "unobserved-repository",
          `No observation bundle was received for "${repositoryId}".`,
        ),
      };
    }

    if (entries.length > 1) {
      return {
        repositoryId,
        result: gateIndeterminate(
          "duplicate-repository-identity",
          `${entries.length} observation bundles all claim repository "${repositoryId}" ` +
            `(bundles[${entries.map((entry) => entry.index).join(", ")}]) -- never resolved by last-write-wins.`,
        ),
      };
    }

    const [entry] = entries as [GroupedBundle];
    if (!entry.parsed.ok) {
      return {
        repositoryId,
        result: gateIndeterminate(
          "invalid-bundle-schema",
          `bundles[${entry.index}] for "${repositoryId}" failed schema validation: ` +
            entry.parsed.findings.map((finding) => `${finding.rule}: ${finding.message}`).join("; "),
        ),
      };
    }

    const { bundle } = entry.parsed;
    const producedAtMs = Date.parse(bundle.producedAt);
    // A bundle stamped in the future yields a NEGATIVE age, which slips under
    // every staleness threshold and reports as fresh. The clock that produced
    // it disagrees with the clock reading it, so this bundle's real age is not
    // knowable here -- and "not knowable" is indeterminate, never fresh.
    if (producedAtMs > nowMs) {
      return {
        repositoryId,
        result: gateIndeterminate(
          "unusable-timestamp",
          `bundles[${entry.index}] for "${repositoryId}" reports producedAt ${bundle.producedAt}, which is after ` +
            `"now" (${now}). Its age cannot be established, so it cannot be counted as a fresh observation. ` +
            "This is a clock disagreement between producer and reader, not a stale bundle.",
        ),
      };
    }
    const ageMs = nowMs - producedAtMs;
    if (ageMs > staleAfterMs) {
      return {
        repositoryId,
        result: gateIndeterminate(
          "stale-observation",
          `bundles[${entry.index}] for "${repositoryId}" was produced at ${bundle.producedAt}, ${ageMs}ms before ` +
            `"now" (${now}) -- exceeds the ${staleAfterMs}ms staleness threshold.`,
        ),
      };
    }

    return {
      repositoryId,
      result: foldGateResults(
        bundle.gates.map((gate) => gate.result),
        {
          emptyReason: "invalid-bundle-schema",
          emptyDetail: `bundles[${entry.index}] declared zero gates -- unreachable past schema validation.`,
        },
      ),
    };
  });

  // An unattributed bundle is evidence that arrived but could not be tied
  // to any repository -- a transport defect, not a shrug. If it were only a
  // counter, `overall` could still read `satisfied` while real evidence
  // went unexamined, which is exactly the "stopped looking" outcome this
  // aggregator promises cannot happen. It folds in as its own
  // indeterminate result, through the same precedence as everything else.
  const perRepositoryResults = repositories.map((status) => status.result);
  const foldedResults =
    unattributedCount > 0
      ? [
          ...perRepositoryResults,
          gateIndeterminate<ObservationAggregateIndeterminateReason>(
            "unattributed-bundle",
            `${unattributedCount} bundle(s) could not be attributed to any repository id; ` +
              "their evidence was never evaluated, so this aggregate cannot report satisfied.",
          ),
        ]
      : perRepositoryResults;

  const overall = foldGateResults(foldedResults, {
    emptyReason: "unobserved-repository",
    emptyDetail: "No repositories were expected -- there is nothing to aggregate.",
  });

  const unobservedRepositories = repositories
    .filter((status) => status.result.verdict === "indeterminate" && status.result.reason === "unobserved-repository")
    .map((status) => status.repositoryId);

  return {
    expectedCount: expectedRepositories.length,
    receivedCount,
    unobservedRepositories,
    unexpectedRepositories,
    unattributedCount,
    repositories,
    overall,
    computedAt: now,
    maxResultAgeMs,
  };
}

/** What `checkObservationAggregateFreshness` accepts: a stored result's own freshness declaration, plus a fresh `now`. */
export interface CheckObservationAggregateFreshnessInput {
  /**
   * The `computedAt` of a previously-computed `AggregateObservationsResult`
   * -- typically read back from wherever the caller persisted that result,
   * not from the same call that produced it (a check against its own
   * `now` would trivially always pass).
   */
  readonly computedAt: string;
  /**
   * How old (in milliseconds) `computedAt` may be, relative to `now`,
   * before this aggregate can no longer vouch for it -- typically the same
   * result's own `maxResultAgeMs`.
   */
  readonly maxResultAgeMs: number;
  /** The caller's own "now" AT READ TIME, ISO 8601. Never read from a clock inside this module -- see the module header. */
  readonly now: string;
}

/**
 * Answers the question `aggregateObservations` cannot ask of its own
 * output: given a previously-computed result's `computedAt`/
 * `maxResultAgeMs` and a fresh `now` supplied at read time, can this
 * aggregate still vouch for that result as current?
 *
 * Returns `gateSatisfied(1)` when the result is within bound, and
 * `gateIndeterminate("stale-aggregate-result", ...)` -- never
 * `"stale-observation"`, see `OBSERVATION_AGGREGATE_RESULT_INDETERMINATE_
 * REASONS`'s doc comment -- the moment it is not. A caller that wants the
 * combined verdict (the stored `overall`, but never presented as current
 * past this bound) folds this result together with the stored `overall`
 * through `@clossys/controller/gates`'s own `foldGateResults` --
 * exactly the same combinator this module already uses internally, so a
 * stale-but-otherwise-satisfied stored result folds to `indeterminate`
 * rather than silently staying `satisfied`.
 *
 * Throws only on a caller precondition being violated directly (an
 * unparseable `computedAt` or `now`, a negative `maxResultAgeMs`) -- the
 * same discipline `aggregateObservations` holds its own preconditions to.
 */
export function checkObservationAggregateFreshness(
  input: CheckObservationAggregateFreshnessInput,
): GateResult<never, ObservationAggregateResultIndeterminateReason> {
  const { computedAt, maxResultAgeMs, now } = input;

  const computedAtMs = Date.parse(computedAt);
  if (!Number.isFinite(computedAtMs)) {
    throw new Error(`checkObservationAggregateFreshness: "computedAt" must be a parseable ISO 8601 instant, got ${JSON.stringify(computedAt)}.`);
  }
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    throw new Error(`checkObservationAggregateFreshness: "now" must be a parseable ISO 8601 instant, got ${JSON.stringify(now)}.`);
  }
  if (!Number.isFinite(maxResultAgeMs) || maxResultAgeMs < 0) {
    throw new Error(`checkObservationAggregateFreshness: "maxResultAgeMs" must be a non-negative finite number, got ${JSON.stringify(maxResultAgeMs)}.`);
  }

  // Same hole as the per-bundle check above, one level up: a result stamped in
  // the future makes ageMs negative, which passes the maximum-age comparison
  // and presents a verdict of unknown age as current. Named separately from
  // staleness for the reason this module already gives for splitting these
  // vocabularies -- an operator told "stale" goes looking for a scheduler, and
  // an operator told "unusable-timestamp" goes looking for a clock.
  if (computedAtMs > nowMs) {
    return gateIndeterminate(
      "unusable-timestamp",
      `This aggregate result reports computedAt ${computedAt}, which is after "now" (${now}). Its age cannot be ` +
        "established, so it cannot be presented as a current verdict. This is a clock disagreement between the " +
        "writer and the reader, not a stale result.",
    );
  }

  const ageMs = nowMs - computedAtMs;
  if (ageMs > maxResultAgeMs) {
    return gateIndeterminate(
      "stale-aggregate-result",
      `This aggregate result was computed at ${computedAt}, ${ageMs}ms before "now" (${now}) -- exceeds the ` +
        `${maxResultAgeMs}ms maximum age this aggregate is willing to vouch for. Nothing has re-evaluated this ` +
        "aggregate since it was computed, so it cannot be presented as a current verdict.",
    );
  }

  return gateSatisfied(1);
}
