/**
 * `checkAppendOnly` is the at-rest half of "append-only, enforced" —
 * complementing `append.ts`'s `appendEntry`, which guards a `Ledger` value
 * already living in memory. This function guards two SERIALIZED snapshots
 * of a ledger: the classic case is a ledger checked into git as JSON, and a
 * CI gate that runs this on every pull request comparing the base ref's
 * copy (`previous`) against the head ref's copy (`next`). `appendEntry`
 * cannot help there — nothing stops a pull request from hand-editing the
 * JSON file directly, bypassing this package's API entirely — which is
 * exactly the gap this function closes: it is the "or loudly rejects" half
 * of this package's append-only guarantee, checking the actual bytes a
 * storage system ends up holding rather than trusting that every write
 * went through `appendEntry`.
 *
 * Pure — takes two already-loaded values, does no I/O of its own, the same
 * boundary every other check in this package holds (see README's
 * "Non-goals").
 */

import type { LedgerFinding, PublicationEntry } from "./types.js";
import { canonicalizeValue } from "./fact.js";
import { validateLedger } from "./schema.js";

/**
 * Compares `previous` against `next` and reports every way `next` fails to
 * be a valid, append-only evolution of `previous`. An empty return means
 * `next` preserves every entry of `previous`, unchanged and in the same
 * order, and only adds new entries after them — the one shape "append-only"
 * is allowed to take.
 *
 * Both arguments are `unknown` and validated with `validateLedger` before
 * anything else runs — the same "don't trust the shape of what you're
 * about to compare" discipline `@vespeneventures/controller/policy`'s `verifyBinding`
 * applies to a `PolicyBinding` before computing a digest against it. If
 * `previous` itself doesn't validate, there is no trustworthy history to
 * check preservation against, so this returns a single
 * `"previous-ledger-invalid"` finding and stops — never a report about
 * what `next` did or didn't preserve relative to a `previous` that was
 * never itself real. If `next` doesn't validate, its own `validateLedger`
 * findings are returned directly (prefixed so they're recognizable as
 * coming from `next`), since a malformed `next` cannot meaningfully be
 * compared as an "evolution" of anything.
 *
 * Three ways `next` can fail to preserve `previous`, each its own rule so
 * a caller (or this package's own CLI) can report exactly what happened
 * rather than a generic "ledgers differ":
 *
 *   - `"entry-removed"` — an id present in `previous` is absent from `next`.
 *   - `"entry-reordered"` — an id present in both moved to a different
 *     index. Order matters here, not just membership: a ledger whose
 *     entries were silently reshuffled is exactly as suspicious as one
 *     with an entry deleted, even if every id is still technically present.
 *   - `"entry-mutated"` — an id present in both, at the same index, whose
 *     content differs (compared via `canonicalizeValue`, the same
 *     deterministic-serialization primitive `fact.ts`'s `citeFact` uses,
 *     so key-order-only differences from a naive JSON round-trip are never
 *     mistaken for a real mutation).
 *
 * `next` having FEWER entries than `previous` is reported once, up front,
 * as `"entries-removed"` (plural — a whole-ledger-level finding, not
 * per-entry) without attempting the per-id diff below it: a ledger that
 * shrank has, by definition, lost at least one entry, and walking further
 * would only re-derive that same fact one id at a time.
 */
export function checkAppendOnly(previous: unknown, next: unknown): LedgerFinding[] {
  const previousFindings = validateLedger(previous);
  if (previousFindings.some((f) => f.severity === "error")) {
    return [
      {
        rule: "previous-ledger-invalid",
        severity: "error",
        message: `"previous" does not validate as a ledger (${previousFindings.length} issue(s)) — there is no trustworthy history to check "next" against.`,
      },
    ];
  }

  const nextFindings = validateLedger(next);
  if (nextFindings.some((f) => f.severity === "error")) {
    return nextFindings.map((f) => ({ ...f, rule: `next-${f.rule}` }));
  }

  const previousEntries = previous as readonly PublicationEntry[];
  const nextEntries = next as readonly PublicationEntry[];

  if (nextEntries.length < previousEntries.length) {
    return [
      {
        rule: "entries-removed",
        severity: "error",
        message: `"next" has ${nextEntries.length} entr${nextEntries.length === 1 ? "y" : "ies"}, fewer than "previous"'s ${previousEntries.length} — a ledger can only grow.`,
      },
    ];
  }

  const findings: LedgerFinding[] = [];
  const nextIndexById = new Map(nextEntries.map((entry, i) => [entry.id, i]));

  previousEntries.forEach((previousEntry, previousIndex) => {
    const nextIndex = nextIndexById.get(previousEntry.id);
    if (nextIndex === undefined) {
      findings.push({
        rule: "entry-removed",
        severity: "error",
        message: `Entry "${previousEntry.id}" exists in "previous" but not in "next".`,
        path: previousEntry.id,
      });
      return;
    }
    if (nextIndex !== previousIndex) {
      findings.push({
        rule: "entry-reordered",
        severity: "error",
        message: `Entry "${previousEntry.id}" moved from position ${previousIndex} in "previous" to position ${nextIndex} in "next".`,
        path: previousEntry.id,
      });
    }
    const nextEntry = nextEntries[nextIndex];
    if (canonicalizeValue(nextEntry) !== canonicalizeValue(previousEntry)) {
      findings.push({
        rule: "entry-mutated",
        severity: "error",
        message: `Entry "${previousEntry.id}" exists in both ledgers but its content differs between "previous" and "next".`,
        path: previousEntry.id,
      });
    }
  });

  return findings;
}
