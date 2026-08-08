/**
 * `appendEntry` is the one sanctioned, in-process way to grow a `Ledger` —
 * see `README.md`'s "Why append-only" for the fuller argument and
 * `append-only-gate.ts`'s `checkAppendOnly` for the complementary at-rest
 * check (this file guards a `Ledger` value already living in memory;
 * `checkAppendOnly` guards two serialized snapshots of one, e.g. a
 * checked-in JSON file before and after a pull request).
 *
 * There is deliberately no `updateEntry` or `removeEntry` export anywhere
 * in this package. That is not an oversight to fill in later — it is the
 * whole point.
 */

import { validateEntry } from "./schema.js";
import type { Ledger, PublicationEntry } from "./types.js";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Returns a NEW `Ledger` equal to `ledger` with `entry` appended —
 * `ledger` itself is never mutated and its own entries are left exactly as
 * they were, which is what makes "append-only" true of every `Ledger` this
 * function ever produces: nothing that already held a reference to
 * `ledger` observes any change.
 *
 * Two conditions are checked, and either one throws rather than returning
 * a `LedgerFinding[]` the way `validateEntry`/`validateLedger` do — the
 * same producer-side-error precedent `@vespeneventures/policy`'s
 * `computeDigest` and this package's own `citeFact` already set: a caller
 * choosing to append a malformed entry, or an entry whose id already
 * exists, is a programming error at the point of the call, not a fact
 * about untrusted external data to tolerate and report:
 *
 *   1. `entry` must pass `validateEntry` with zero `"error"`-severity
 *      findings.
 *   2. `entry.id` must not already appear in `ledger` — this is the
 *      structural half of "append-only, enforced": the only way this
 *      package's own API can be asked to "replace" an existing entry is by
 *      reusing its id, and that request is refused outright rather than
 *      silently overwriting or silently creating a second entry that
 *      shares an id (which `validateLedger` would then itself flag via
 *      `"duplicate-entry-id"` — this check exists so that finding is never
 *      reachable through `appendEntry` in the first place).
 *
 * The returned array, and every entry in it (including every entry that
 * was already in `ledger`, referenced by the same deep-frozen objects
 * rather than copied), is deep-frozen. A caller that attempts
 * `result[0].channel = "x"` gets a `TypeError` — this module ships ESM
 * only, which is always strict mode, so that mutation attempt throws
 * rather than failing silently the way it would in non-strict script code.
 * This does not, on its own, stop a determined caller from building an
 * entirely different array by hand and mistaking it for a `Ledger` — that
 * is what `validateLedger` and `checkAppendOnly` exist to catch at the
 * boundary of whatever storage actually holds a ledger long-term.
 */
export function appendEntry(ledger: Ledger, entry: PublicationEntry): Ledger {
  const entryFindings = validateEntry(entry).filter((f) => f.severity === "error");
  if (entryFindings.length > 0) {
    const detail = entryFindings.map((f) => `${f.rule}: ${f.message}`).join("; ");
    throw new Error(`appendEntry: refusing to append a malformed entry (${entryFindings.length} issue(s)): ${detail}`);
  }

  if (ledger.some((existing) => existing.id === entry.id)) {
    throw new Error(
      `appendEntry: an entry with id ${JSON.stringify(entry.id)} already exists in this ledger. A ledger is append-only: an existing entry can never be replaced — record a new entry under a new id instead.`,
    );
  }

  const frozenEntry = deepFreeze(structuredClone(entry));
  return Object.freeze([...ledger, frozenEntry]);
}
