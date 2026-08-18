/**
 * Gate efficacy: for a declared gate, did it run, what did it conclude, and
 * — via `escape-rate.ts` — did anything reach the default branch that it
 * should have stopped.
 *
 * THE STRUCTURAL RULE
 * --------------------
 * The measurer must not be the measured. `observer` never imports the gate
 * package it is measuring, never re-runs a gate's checks, and never decides
 * for itself whether a change violated a rule. Every fact this module
 * touches — whether a gate ran, what it concluded, whether a landed change
 * later turned out to violate a rule — arrives already decided, from a
 * `RunHistoryReader` the CALLER supplies. This module reads no live source
 * itself: no GitHub API, no CI provider, no filesystem. That is what "inject
 * the reader as a port" means here — the port is the only seam, and this
 * package ships no implementation of it, on purpose. A caller wires up its
 * own reader against whatever run-history source its plane actually has.
 */
import type { Observation, ObservationState } from "./observation.js";
import { computeEscapeRate, type EscapeRateMetric, type LandedChangeOutcome } from "./escape-rate.js";

/** One row of run history for one gate against one change, exactly as the caller's own system recorded it. */
export interface GateRunRecord {
  readonly gate: string;
  readonly changeId: string;
  readonly ran: boolean;
  /**
   * The gate's own reported conclusion, when it ran. Deliberately an opaque
   * string — `observer` does not import, and does not need to know, any
   * gate's verdict vocabulary. Tallied and reported back verbatim.
   */
  readonly verdict?: string;
}

/** The payload carried only when a run-history read actually observed something. */
export interface GateRunHistoryObserved {
  readonly records: readonly GateRunRecord[];
}

/**
 * The result of attempting to read one gate's run history. `"could-not-
 * read"` is common and expected: run history is frequently not readable by
 * script without a credential the plane does not have, and that must
 * report as `"could-not-read"`, never collapse into `"observed"` (there was
 * no read) or into a pass (a gate that cannot be seen is not a gate that
 * ran clean).
 */
export type GateRunHistoryRead = Observation<GateRunHistoryObserved>;

/**
 * The injected port. `observer` ships zero implementations of this
 * interface — see this module's header. A caller supplies one backed by
 * whatever it can actually read (a CI provider's API, an exported log, a
 * static fixture in a test).
 */
export interface RunHistoryReader {
  readRunHistory(gate: string): GateRunHistoryRead | Promise<GateRunHistoryRead>;
}

/** What this module concluded for one gate. */
export interface GateEfficacyReport {
  readonly kind: "gate-efficacy";
  readonly gate: string;
  /** The read's own state. `could-not-read` here means every count below is `0` and uninformative — read `note`. */
  readonly state: ObservationState;
  /** Present only when `state === "observed"`. */
  readonly note?: string;
  readonly ranCount: number;
  readonly didNotRunCount: number;
  /** Tally of `verdict` strings, verbatim, across every record where `ran` was true and `verdict` was reported. */
  readonly verdictCounts: Readonly<Record<string, number>>;
  /**
   * Whether anything reached the default branch that this gate should have
   * stopped — computed by `escape-rate.ts`, never by this module directly,
   * and reported here as its own nested, non-numeric-compatible metric. See
   * `escape-rate.ts` and `metrics.check.ts` for why this cannot be
   * flattened into `unobserved-surface.ts`'s output.
   */
  readonly escapeRate: EscapeRateMetric;
}

/**
 * Reads one gate's run history through the injected port, tallies it, and
 * folds in the escape-rate metric computed from independently-sourced
 * landed-change outcomes. Never calls an API itself.
 */
export async function computeGateEfficacy(
  gate: string,
  reader: RunHistoryReader,
  outcomes: readonly LandedChangeOutcome[],
): Promise<GateEfficacyReport> {
  const read = await reader.readRunHistory(gate);
  const escapeRate = computeEscapeRate(gate, outcomes);

  if (read.state !== "observed") {
    return {
      kind: "gate-efficacy",
      gate,
      state: read.state,
      ...(read.state === "could-not-read" ? { note: read.note } : {}),
      ranCount: 0,
      didNotRunCount: 0,
      verdictCounts: {},
      escapeRate,
    };
  }

  let ranCount = 0;
  let didNotRunCount = 0;
  const verdictCounts: Record<string, number> = {};

  for (const record of read.records) {
    if (record.gate !== gate) continue;
    if (record.ran) {
      ranCount += 1;
      if (record.verdict !== undefined) {
        verdictCounts[record.verdict] = (verdictCounts[record.verdict] ?? 0) + 1;
      }
    } else {
      didNotRunCount += 1;
    }
  }

  return {
    kind: "gate-efficacy",
    gate,
    state: "observed",
    ranCount,
    didNotRunCount,
    verdictCounts,
    escapeRate,
  };
}
