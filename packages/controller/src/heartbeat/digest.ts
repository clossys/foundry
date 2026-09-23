/**
 * The heartbeat's pure computation (issue #1221): every stale, blocked,
 * pending-decision, or review-waiting capability across a set of roles'
 * `LoopState`s, and a plain, mechanical Markdown rendering of that list.
 * Reuses `../loop/blockers.js`'s `isBlockerOverdue` directly rather than
 * a second copy of overdue-ness -- the order-dependent-PR rule (#1187
 * comment 5789471852): loop behaviour builds on the shared framework
 * definitions #1237 shipped, never a local re-declaration. No I/O here;
 * `./fs.js` reads real `clossys/<role>/loop.json` files and calls into
 * this.
 */
import { isBlockerOverdue } from "../loop/blockers.js";
import type { LoopState } from "../loop/types.js";
import type { DigestEntry, HeartbeatDigest } from "./types.js";

function roleEntries(role: string, state: LoopState, now: Date): DigestEntry[] {
  const entries: DigestEntry[] = [];
  for (const capability of Object.values(state.capabilities)) {
    for (const blocker of capability.blockers) {
      entries.push({
        role,
        capabilityId: capability.id,
        kind: "blocked-capability",
        detail: `${blocker.kind}: ${blocker.nextAction.how} (owner: ${blocker.owner})`,
        since: blocker.since,
        byWhen: blocker.nextAction.byWhen,
        overdue: isBlockerOverdue(blocker, now),
      });
    }
    if (capability.stage === "judge") {
      entries.push({ role, capabilityId: capability.id, kind: "pending-decision", detail: `${capability.id} is waiting on a judge-stage decision.` });
    }
    if (capability.condition === "stale") {
      entries.push({ role, capabilityId: capability.id, kind: "stale-capability", detail: `${capability.id}'s recorded inputs have changed since it was last built.` });
    }
    if (capability.stage === "learn") {
      entries.push({ role, capabilityId: capability.id, kind: "review-waiting", detail: `${capability.id} has a review window due.` });
    }
  }
  return entries;
}

/** Sort group, lowest first: overdue blockers, then pending decisions, then non-overdue blockers, then stale, then review-waiting. */
function groupRank(entry: DigestEntry): number {
  switch (entry.kind) {
    case "blocked-capability":
      return entry.overdue === true ? 0 : 2;
    case "pending-decision":
      return 1;
    case "stale-capability":
      return 3;
    case "review-waiting":
      return 4;
  }
}

function compareEntries(a: DigestEntry, b: DigestEntry): number {
  const groupDiff = groupRank(a) - groupRank(b);
  if (groupDiff !== 0) return groupDiff;
  // Within a group, most urgent first: an earlier byWhen (falling back to
  // since) sorts first. Neither field applies outside blocked-capability,
  // so both sides fall through to the deterministic role/capabilityId
  // tie-break below.
  const aWhen = a.byWhen ?? a.since ?? "";
  const bWhen = b.byWhen ?? b.since ?? "";
  if (aWhen !== bWhen) return aWhen < bWhen ? -1 : 1;
  if (a.role !== b.role) return a.role < b.role ? -1 : 1;
  return a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0;
}

/**
 * Deterministic, zero-token computation over already-loaded `LoopState`s:
 * never calls a model, never reads or writes anything itself. Sort order
 * is fixed (see `compareEntries`), so two runs over the same input always
 * produce byte-identical `entries`, differing only in `generatedAt`.
 */
export function computeHeartbeat(roles: Readonly<Record<string, LoopState>>, now: Date = new Date()): HeartbeatDigest {
  const entries = Object.keys(roles)
    .sort()
    .flatMap((role) => roleEntries(role, roles[role]!, now));
  entries.sort(compareEntries);
  return { entries: Object.freeze(entries), generatedAt: now.toISOString() };
}

const KIND_LABELS: Readonly<Record<DigestEntry["kind"], string>> = Object.freeze({
  "blocked-capability": "Blocked",
  "pending-decision": "Pending decision",
  "stale-capability": "Stale",
  "review-waiting": "Review waiting",
});

/**
 * Plain, mechanical Markdown -- the same "generic renderer, not the
 * final wording" discipline `../loop/status.js`'s `renderStatusDocument`
 * already states for itself. Advisor's own phrasing/prioritization pass
 * (#1221's ownership table) supersedes this later; it is not this
 * module's job to guess at plain language ahead of that pass.
 * "Nothing waiting" renders one plain line, never an empty file.
 */
export function renderDigest(entries: readonly DigestEntry[], now: Date = new Date()): string {
  const lines: string[] = ["# Decisions waiting for you", "", `_Generated ${now.toISOString()}._`, ""];
  if (entries.length === 0) {
    lines.push("Nothing is waiting on you right now.");
    return `${lines.join("\n")}\n`;
  }
  for (const entry of entries) {
    const overdue = entry.kind === "blocked-capability" && entry.overdue === true ? " **OVERDUE**" : "";
    const when = entry.byWhen !== undefined ? ` (by ${entry.byWhen})` : "";
    lines.push(`- **${entry.role} / ${entry.capabilityId}** — ${KIND_LABELS[entry.kind]}: ${entry.detail}${when}${overdue}`);
  }
  return `${lines.join("\n")}\n`;
}
