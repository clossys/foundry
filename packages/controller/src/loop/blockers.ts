/**
 * Blocker construction and escalation (issue #1195). A blocked capability
 * "rests with exactly one next action (who, how, by when) and escalates
 * past its due date. Other capabilities keep running" -- that second
 * sentence needs no code of its own: state here is per-capability, so one
 * capability's blocker never touches another's fields. Each of this
 * package's own loop modules (`triggers`, `blockers`, `staleness`,
 * `artifacts`, `state`, `status`) is independently pure with no single
 * orchestrating "run one iteration" entry point -- consistent with issue
 * #1187's package/agent split, where the coding agent drives the loop and
 * calls these modules directly rather than a package owning a run loop of
 * its own.
 */
import { BLOCKER_OWNERS, type Blocker, type BlockerKind, type NextAction } from "./types.js";

/** Builds one blocker record. `owner` is always derived from `kind` -- a caller cannot assign the wrong owner even by mistake. */
export function blockerFor(capabilityId: string, kind: BlockerKind, nextAction: NextAction, since: string): Blocker {
  return Object.freeze({
    capabilityId,
    kind,
    owner: BLOCKER_OWNERS[kind],
    nextAction: Object.freeze({ ...nextAction }),
    since,
  });
}

/**
 * Whether `blocker` is past its own `nextAction.byWhen`, as of `now`. An
 * unparseable `byWhen` is treated as already overdue -- a due date that
 * cannot be read is not evidence the blocker is on schedule.
 */
export function isBlockerOverdue(blocker: Blocker, now: Date = new Date()): boolean {
  const due = new Date(blocker.nextAction.byWhen);
  if (Number.isNaN(due.getTime())) return true;
  // A date-only byWhen (no time part) names a whole day, not its first
  // instant: the deadline is the end of that day, so the blocker stays on
  // schedule for the entirety of its own due date.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(blocker.nextAction.byWhen.trim());
  const deadline = dateOnly ? due.getTime() + 24 * 60 * 60 * 1000 : due.getTime();
  return deadline <= now.getTime();
}

/** Every overdue blocker across every capability, each still naming which capability it blocks -- the escalation list issue #1195 asks for. */
export function overdueBlockers(blockers: readonly Blocker[], now: Date = new Date()): readonly Blocker[] {
  return blockers.filter((blocker) => isBlockerOverdue(blocker, now));
}
