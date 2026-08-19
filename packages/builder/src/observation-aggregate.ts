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
 * (`@vespeneventures/controller/gates`), whose documented precedence --
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
 * repository's own `#314` fix (`@vespeneventures/controller`'s
 * `liveStateSurface`) for the class of bug that lexical timestamp
 * comparison produces across UTC offsets.
 *
 * Zero I/O. Every bundle, the expected repository list, `now`, and
 * `staleAfterMs` are all supplied by the caller.
 */

import { foldGateResults, gateIndeterminate } from "@vespeneventures/controller/gates";
import type { GateResult } from "@vespeneventures/controller/gates";
import type { Finding } from "./types.js";
import { parseObservationBundle } from "./observation-bundle.js";

/** The finite set of reasons a repository's observation can be indeterminate for, as one frozen list for enumeration (`--help` text, a report legend). */
export const OBSERVATION_AGGREGATE_INDETERMINATE_REASONS = Object.freeze([
  "unobserved-repository",
  "invalid-bundle-schema",
  "duplicate-repository-identity",
  "stale-observation",
  "unattributed-bundle",
] as const);

export type ObservationAggregateIndeterminateReason = (typeof OBSERVATION_AGGREGATE_INDETERMINATE_REASONS)[number];

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
  const { expectedRepositories, bundles, now, staleAfterMs } = input;

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
  };
}
