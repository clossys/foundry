/**
 * The no-repeat report: counts records per cause over a window, and prints
 * `REPEAT <cause> guard=<rule>` for every record of a guarded cause that happened after its guard
 * landed. A repeat exits 1: a fixed cause that comes back fails a check. A record from before the
 * guard landed is history, not a repeat.
 */
import { matchCause } from "./causes.js";
import { oneLineSignature } from "./heal.js";
import type { IncidentRecord, KnownCause } from "./types.js";

export interface ReportWindow {
  readonly since?: string;
  readonly until?: string;
}

export interface Repeat {
  readonly cause: string;
  readonly guard: string;
  readonly at: string;
  readonly command: string;
}

export interface HealReport {
  readonly counts: Readonly<Record<string, number>>;
  readonly newCauses: readonly string[];
  readonly repeats: readonly Repeat[];
  readonly lines: readonly string[];
  readonly exit: 0 | 1;
}

/** Whether a record of `cause` at `at` happened after the cause's guard landed. */
export function isRepeat(cause: KnownCause, at: string): boolean {
  if (!cause.guard || !cause.guard_landed) return false;
  const landed = Date.parse(cause.guard_landed), when = Date.parse(at);
  if (Number.isNaN(landed) || Number.isNaN(when)) return false;
  return when > landed;
}

export function healReport(records: readonly IncidentRecord[], causes: readonly KnownCause[], window: ReportWindow = {}): HealReport {
  const since = window.since ? Date.parse(window.since) : -Infinity;
  const until = window.until ? Date.parse(window.until) : Infinity;
  const counts: Record<string, number> = Object.fromEntries(causes.map(cause => [cause.id, 0]));
  const newCauses: string[] = [];
  const repeats: Repeat[] = [];
  const inWindow = records.filter(record => { const at = Date.parse(record.at); return at >= since && at <= until; })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const record of inWindow) {
    const cause = matchCause(record, causes);
    if (!cause) { newCauses.push(oneLineSignature(record.signature)); continue; }
    counts[cause.id] = (counts[cause.id] ?? 0) + 1;
    if (isRepeat(cause, record.at)) repeats.push({ cause: cause.id, guard: cause.guard!, at: record.at, command: record.command });
  }
  const lines = [
    ...Object.entries(counts).map(([id, count]) => `COUNT ${id} ${count}`),
    ...newCauses.map(signature => `NEW-CAUSE ${signature}`),
    ...repeats.map(repeat => `REPEAT ${repeat.cause} guard=${repeat.guard} at=${repeat.at} \`${repeat.command}\``),
    `heal report: ${inWindow.length} record(s), ${repeats.length} repeat(s) after a guard landed, ${newCauses.length} new cause(s)`,
  ];
  return { counts, newCauses, repeats, lines, exit: repeats.length ? 1 : 0 };
}
