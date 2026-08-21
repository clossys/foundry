/**
 * `checkJoinKeyCompleteness` answers the question issue #376 exists to make
 * checkable: for everything this ledger currently says is live, is there
 * enough recorded here for SOMEONE ELSE — an observer-shaped tier holding
 * external engagement signals, never this package — to attribute a signal
 * to the right revision of the right surface? This package still does not,
 * and must not, decide whether that signal is good. See `index.ts`'s
 * top-level doc comment and `README.md`'s "Why this package exists" for
 * that boundary; this file only ever emits or checks for a KEY, never a
 * verdict.
 *
 * Layered the same way `checkLedgerDrift` and `checkAppendOnly` already
 * are: `schema.ts`'s `validateEntry`/`validateLedger` check SHAPE only (is
 * `contentId`, when present, a non-empty string; is `supersededAt`, when
 * present, a well-formed ISO instant) — this file is the SEMANTIC layer on
 * top, and it needs the whole ledger, not one entry in isolation, because
 * "is this join key complete" is a cross-entry question: whether a
 * `contentId` was actually reused across revisions of the same surface can
 * only be judged by comparing entries against each other.
 *
 * ## What "live" means here, and why it is computed, not stored
 *
 * This package is append-only (see `append.ts`): there is no `updateEntry`,
 * so an already-recorded entry can never be reached back into and marked
 * "no longer current" once a successor ships. `PublicationEntry.supersededAt`
 * is therefore optional and often absent even on an entry that is, in
 * fact, no longer live — the honest state of affairs for a caller who
 * simply did not know the end date at record time (see `types.ts`'s doc
 * comment on that field).
 *
 * So liveness is DERIVED, per `contentId`, from `publishedAt` ordering
 * rather than read off a single boolean field:
 *
 *   - Entries are grouped by `contentId` (only entries with a non-empty
 *     `contentId` can be grouped at all — see "identity" below).
 *   - Within a group, the entry with the latest `publishedAt` is the
 *     candidate for "currently live".
 *   - It stays live UNLESS it itself carries a well-formed `supersededAt`
 *     strictly after its own `publishedAt` — a caller who, unusually,
 *     already knows this exact revision's end date at record time (a
 *     time-boxed campaign page; an honest backfill of something already
 *     retired). A `supersededAt` that is present but malformed or
 *     chronologically backwards does NOT close the window — see
 *     `"join-key-window-invalid"` below.
 *   - An entry with no `contentId` at all cannot be grouped or compared to
 *     anything, so it is always treated as live, the same fail-closed
 *     choice `checkLedgerDrift` makes for an unchecked citation: this
 *     package would rather over-report "still needs a join key" than
 *     silently assume an ungroupable entry has been superseded by
 *     something it has no way to link it to.
 *
 * ## The two findings this gate can report on a live entry
 *
 *   - `"join-key-missing-identity"` — the live entry has no `contentId` at
 *     all. Nothing to compare it against a future revision with.
 *   - `"join-key-window-invalid"` — the live entry's own `supersededAt` is
 *     present but does not actually close a window (not after its
 *     `publishedAt`), so it neither reads as "still live, no end yet" nor
 *     as "retired on this known date" — an ambiguous state a downstream
 *     grader cannot safely attribute anything against.
 *
 * ## The one finding this gate reports across the WHOLE ledger
 *
 *   - `"join-key-identity-churn"` — two or more entries share the same
 *     address (`channel` + `url`) but disagree on `contentId`. This is the
 *     adversarial case issue #376 calls out by name: a caller that mints a
 *     fresh `contentId` on every publish produces entries that each look
 *     individually complete (every field present, including a non-empty
 *     `contentId`) while remaining exactly as useless for a
 *     before/after-the-redesign comparison as if the field were absent.
 *     Presence alone cannot catch that; only comparing entries that
 *     plausibly describe the same real-world surface can. This finding is
 *     reported regardless of which of the entries involved is currently
 *     "live" — the inconsistency exists across the whole address history,
 *     not just its latest member.
 */

import type { Ledger, LedgerFinding, PublicationEntry } from "./types.js";
import { validateLedger } from "./schema.js";

function hasContentId(entry: PublicationEntry): entry is PublicationEntry & { contentId: string } {
  return typeof entry.contentId === "string" && entry.contentId.length > 0;
}

function hasUrl(entry: PublicationEntry): entry is PublicationEntry & { url: string } {
  return typeof entry.url === "string" && entry.url.length > 0;
}

/** `true` when `entry.supersededAt` is present AND strictly after `entry.publishedAt` — the one shape that actually closes a window. A present-but-backwards/equal `supersededAt` does NOT count (see `"join-key-window-invalid"`). */
function hasClosedWindow(entry: PublicationEntry): boolean {
  if (typeof entry.supersededAt !== "string") return false;
  return new Date(entry.supersededAt).getTime() > new Date(entry.publishedAt).getTime();
}

/** `true` when `entry.supersededAt` is present but does NOT close a window (not strictly after `publishedAt`). Shape (is it a well-formed ISO instant) is already guaranteed by `validateEntry` by the time this runs. */
function hasInvalidWindow(entry: PublicationEntry): boolean {
  return typeof entry.supersededAt === "string" && !hasClosedWindow(entry);
}

/** One `contentId`, grouped across the ledger, with every entry's window in `publishedAt` order — this is the literal "one identity, two windows" shape a caller correctly reusing `contentId` across a redesign produces. Exposed on `JoinKeyReport.identities` so a test (or a human) can assert on it directly, not just infer it from pass/fail. */
export interface JoinKeyIdentity {
  contentId: string;
  windows: Array<{ entryId: string; publishedAt: string; supersededAt?: string }>;
}

/**
 * What `checkJoinKeyCompleteness` returns. Mirrors `DriftReport`'s shape
 * (`drift.ts`) deliberately: `ok` is `true` only when this function
 * actually evaluated at least one live entry and found no incompleteness
 * among them — never merely "no error was thrown".
 */
export interface JoinKeyReport {
  ok: boolean;
  /** How many entries this call classified as currently "live" — see this file's own top doc comment for what that means. `0` whenever `ok` is `false` for a shape/emptiness/no-live-entries reason. */
  liveEntriesChecked: number;
  /** How many of `liveEntriesChecked` carry a complete join key (no `"join-key-missing-identity"`/`"join-key-window-invalid"` finding). */
  completeLiveEntries: number;
  /** How many of `liveEntriesChecked` do not. */
  incompleteLiveEntries: number;
  /** Every distinct non-empty `contentId` in the ledger, each with its full ordered window history — see `JoinKeyIdentity`. */
  identities: JoinKeyIdentity[];
  findings: LedgerFinding[];
}

/**
 * Validates `ledger`, derives which entries are currently "live" (see this
 * file's top doc comment), and reports whether each live entry's join key
 * is complete, plus one cross-entry consistency check
 * (`"join-key-identity-churn"`) that individual-entry completeness cannot
 * catch on its own.
 *
 * FAILS CLOSED the same three ways `checkLedgerDrift` does, each mapped by
 * `cli.ts`'s `join-key` subcommand to exit code `2`, never `0` or `1`:
 *
 *   1. `ledger` does not validate — `ok: false`, `"ledger-invalid"`,
 *      `liveEntriesChecked: 0`.
 *   2. `ledger` is a well-formed but EMPTY array — `ok: false`,
 *      `"empty-ledger"`, `liveEntriesChecked: 0`.
 *   3. `ledger` has entries, but every one of them turns out NOT live (every
 *      `contentId` group's latest entry has a well-formed, closed window,
 *      and there are no ungroupable entries) — `ok: false`,
 *      `"no-live-entries"`, `liveEntriesChecked: 0`. Publishing nothing
 *      live right now is not evidence that publishing is governed; a
 *      ledger that happens to have retired everything it ever recorded
 *      must never read the same as a ledger that is cleanly, actively
 *      complete.
 *
 * Outside those three cases, `ok` is `false` whenever `incompleteLiveEntries
 * > 0` OR at least one `"join-key-identity-churn"` finding was reported,
 * and `true` otherwise.
 */
export function checkJoinKeyCompleteness(ledger: unknown): JoinKeyReport {
  const ledgerFindings = validateLedger(ledger);
  if (ledgerFindings.some((f) => f.severity === "error")) {
    return {
      ok: false,
      liveEntriesChecked: 0,
      completeLiveEntries: 0,
      incompleteLiveEntries: 0,
      identities: [],
      findings: [
        {
          rule: "ledger-invalid",
          severity: "error",
          message: `The ledger does not validate (${ledgerFindings.length} issue(s)) — refusing to report on join-key completeness for a ledger that cannot be trusted.`,
        },
        ...ledgerFindings,
      ],
    };
  }

  const entries = ledger as Ledger;

  if (entries.length === 0) {
    return {
      ok: false,
      liveEntriesChecked: 0,
      completeLiveEntries: 0,
      incompleteLiveEntries: 0,
      identities: [],
      findings: [
        {
          rule: "empty-ledger",
          severity: "error",
          message: "The ledger has zero entries. An empty ledger has nothing live to check, and must never be reported as a clean, complete result.",
        },
      ],
    };
  }

  const findings: LedgerFinding[] = [];

  // --- Group by contentId, building JoinKeyIdentity + the "candidate live" set ---
  const byContentId = new Map<string, PublicationEntry[]>();
  const ungroupable: PublicationEntry[] = [];
  for (const entry of entries) {
    if (hasContentId(entry)) {
      const group = byContentId.get(entry.contentId);
      if (group) group.push(entry);
      else byContentId.set(entry.contentId, [entry]);
    } else {
      ungroupable.push(entry);
    }
  }

  const identities: JoinKeyIdentity[] = [];
  const live: PublicationEntry[] = [...ungroupable];

  for (const [contentId, group] of byContentId) {
    const sorted = [...group].sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
    identities.push({
      contentId,
      windows: sorted.map((e) => ({ entryId: e.id, publishedAt: e.publishedAt, supersededAt: e.supersededAt })),
    });
    // noUncheckedIndexedAccess: sorted is non-empty (group is non-empty by construction).
    const latest = sorted[sorted.length - 1] as PublicationEntry;
    if (!hasClosedWindow(latest)) {
      live.push(latest);
    }
  }

  // --- Per-live-entry completeness: identity, then window ---
  let completeLiveEntries = 0;
  let incompleteLiveEntries = 0;
  for (const entry of live) {
    let entryIncomplete = false;

    if (!hasContentId(entry)) {
      entryIncomplete = true;
      findings.push({
        rule: "join-key-missing-identity",
        severity: "error",
        message: `Entry "${entry.id}" (published ${entry.publishedAt}, channel "${entry.channel}") is live but carries no contentId — it cannot be compared against any future revision of the same surface.`,
        path: `${entry.id}.contentId`,
      });
    }

    if (hasInvalidWindow(entry)) {
      entryIncomplete = true;
      findings.push({
        rule: "join-key-window-invalid",
        severity: "error",
        message: `Entry "${entry.id}" (published ${entry.publishedAt}) carries a supersededAt ("${entry.supersededAt}") that does not fall strictly after publishedAt — it neither reads as still live nor as cleanly retired on a known date.`,
        path: `${entry.id}.supersededAt`,
      });
    }

    if (entryIncomplete) incompleteLiveEntries++;
    else completeLiveEntries++;
  }

  // --- Cross-entry: same address, disagreeing identity (issue #376's adversarial case) ---
  const byAddress = new Map<string, PublicationEntry[]>();
  for (const entry of entries) {
    if (!hasUrl(entry)) continue;
    const key = `${entry.channel} ${entry.url}`;
    const group = byAddress.get(key);
    if (group) group.push(entry);
    else byAddress.set(key, [entry]);
  }

  let identityChurnFindings = 0;
  for (const group of byAddress.values()) {
    const distinctIds = new Set(group.filter(hasContentId).map((e) => e.contentId));
    if (distinctIds.size > 1) {
      identityChurnFindings++;
      const first = group[0] as PublicationEntry;
      findings.push({
        rule: "join-key-identity-churn",
        severity: "error",
        message:
          `${group.length} entries publish to the same address (channel "${first.channel}", url "${first.url}") ` +
          `under ${distinctIds.size} different contentId values (${[...distinctIds].map((id) => JSON.stringify(id)).join(", ")}): ` +
          `${group.map((e) => `"${e.id}"->${JSON.stringify(e.contentId ?? null)}`).join(", ")}. ` +
          "A stable identity must be reused across revisions of the same surface, or a signal from this address can never be attributed to a specific revision.",
        path: `${first.channel}:${first.url}`,
      });
    }
  }

  if (live.length === 0) {
    findings.push({
      rule: "no-live-entries",
      severity: "error",
      message: `${entries.length} entr${entries.length === 1 ? "y" : "ies"} in the ledger, but zero are currently live (every contentId group's latest entry has a closed window). Publishing nothing live right now is not evidence that publishing is governed.`,
    });
    return {
      ok: false,
      liveEntriesChecked: 0,
      completeLiveEntries: 0,
      incompleteLiveEntries: 0,
      identities,
      findings,
    };
  }

  return {
    ok: incompleteLiveEntries === 0 && identityChurnFindings === 0,
    liveEntriesChecked: live.length,
    completeLiveEntries,
    incompleteLiveEntries,
    identities,
    findings,
  };
}
