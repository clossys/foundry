/**
 * `checkLedgerDrift` answers the question this whole package exists to make
 * checkable without importing `@example/strategy`: a page was
 * published citing fact X — has X changed since?
 *
 * It never reads a real fact registry itself. A caller supplies
 * `currentValues`, a plain `factRef -> value` map — typically built by a
 * caller that already has `@example/strategy`'s `readStrategy`
 * bundle in scope and reduces its `Fact[]` down to `{ [fact.key]:
 * fact.value }` before calling this function. That reduction step is where
 * the "return path does not import strategy" boundary actually lives: this
 * package receives plain values, never a `Fact`.
 */

import { verifyBinding } from "@clossys/controller/policy";
import type { LedgerFinding, PublicationEntry } from "./types.js";
import { canonicalizeValue } from "./fact.js";
import { validateLedger } from "./schema.js";

/**
 * What `checkLedgerDrift` returns. `ok` is `true` only when this function
 * actually verified at least one citation and found no drift among the
 * ones it verified — never merely "no error was thrown". The count fields
 * are always present and always accurate, specifically so a caller (or a
 * human reading a printed report) can never mistake "checked N citations,
 * 0 drifted" for "checked nothing" — they read as visibly different
 * numbers, not as the same boolean.
 */
export interface DriftReport {
  ok: boolean;
  /** How many `PublicationEntry` records were present in the ledger this call validated successfully. `0` whenever `ok` is `false` for a shape/emptiness reason — see `findings`. */
  entriesChecked: number;
  /** How many `FactCitation`s had a current value supplied in `currentValues` and were actually compared. */
  citationsChecked: number;
  /** How many `FactCitation`s had NO current value supplied — drift could not be determined for these, and that fact is always reported via a `"fact-unchecked"` finding, never silently dropped. */
  citationsUnchecked: number;
  /** How many of `citationsChecked` no longer match the value they were bound to at publication time. */
  citationsDrifted: number;
  findings: LedgerFinding[];
}

/**
 * Validates `ledger`, then compares every `FactCitation` it contains
 * against `currentValues[citation.factRef]` using
 * `@clossys/controller/policy`'s own `verifyBinding` — no digest-comparison
 * logic is reimplemented here; the current value is canonicalized with
 * this package's own `canonicalizeValue` (the same function `citeFact`
 * used to build the citation in the first place) and handed to
 * `verifyBinding` exactly as `citeFact`'s canonicalized value was handed to
 * `computeDigest`.
 *
 * FAILS CLOSED in three distinct ways, each with its own finding and none
 * of them printing the same report shape as a genuine clean pass:
 *
 *   1. `ledger` does not validate (`validateLedger` reports an error) —
 *      `ok: false`, a `"ledger-invalid"` finding, `entriesChecked: 0`.
 *      A ledger whose own shape can't be trusted is not one a drift check
 *      against it can be trusted either — the exact same precedent
 *      `@clossys/controller/policy`'s `verifyBinding` sets for a malformed
 *      `PolicyBinding`.
 *   2. `ledger` is a well-formed but EMPTY array — `ok: false`, an
 *      `"empty-ledger"` finding, every count `0`. This is the literal
 *      "no entries" fixture: an empty ledger checks nothing, and nothing
 *      checked must never be reported as "no drift detected".
 *   3. `ledger` has entries, but zero citations across all of them end up
 *      compared — every citation either had no current value supplied, or
 *      no entry cited any fact at all — `ok: false`, a
 *      `"no-citations-checked"` finding. This is the harder version of
 *      case 2: a non-empty ledger that nonetheless verified nothing is
 *      exactly as untrustworthy a "clean" result as an empty one, and a
 *      naive implementation (`ok: citationsDrifted === 0`) would report it
 *      as a pass. `citationsChecked`/`citationsUnchecked` are always in the
 *      result specifically so a caller printing this report can see the
 *      difference between "10 checked, 0 drifted" and "0 checked" at a
 *      glance, not just via `ok`'s boolean.
 *
 * Outside those three cases, `ok` is `false` whenever `citationsDrifted >
 * 0` (an `"fact-drift"` finding per drifted citation, never naming either
 * value — the same discipline `@clossys/controller/policy`'s own
 * `verifyBinding` mismatch message holds to) and `true` otherwise, even
 * when `citationsUnchecked > 0` — a citation with no current value
 * supplied is reported (`"fact-unchecked"`, `"warning"` severity) but does
 * not, by itself, fail an otherwise-clean check across everything that
 * COULD be checked. A caller that wants 100% coverage enforced can check
 * `citationsUnchecked === 0` itself; this function does not assume every
 * caller has a current value for every fact a ledger has ever cited.
 */
export function checkLedgerDrift(ledger: unknown, currentValues: Readonly<Record<string, unknown>>): DriftReport {
  const ledgerFindings = validateLedger(ledger);
  if (ledgerFindings.some((f) => f.severity === "error")) {
    return {
      ok: false,
      entriesChecked: 0,
      citationsChecked: 0,
      citationsUnchecked: 0,
      citationsDrifted: 0,
      findings: [
        {
          rule: "ledger-invalid",
          severity: "error",
          message: `The ledger does not validate (${ledgerFindings.length} issue(s)) — refusing to report on drift for a ledger that cannot be trusted.`,
        },
        ...ledgerFindings,
      ],
    };
  }

  const entries = ledger as readonly PublicationEntry[];

  if (entries.length === 0) {
    return {
      ok: false,
      entriesChecked: 0,
      citationsChecked: 0,
      citationsUnchecked: 0,
      citationsDrifted: 0,
      findings: [
        {
          rule: "empty-ledger",
          severity: "error",
          message: "The ledger has zero entries. An empty ledger checks nothing and must never be reported as a clean, drift-free result.",
        },
      ],
    };
  }

  const findings: LedgerFinding[] = [];
  let citationsChecked = 0;
  let citationsUnchecked = 0;
  let citationsDrifted = 0;

  for (const entry of entries) {
    for (const citation of entry.factCitations) {
      const hasCurrentValue = Object.prototype.hasOwnProperty.call(currentValues, citation.factRef);
      if (!hasCurrentValue) {
        citationsUnchecked++;
        findings.push({
          rule: "fact-unchecked",
          severity: "warning",
          message: `No current value was supplied for fact "${citation.factRef}", cited by entry "${entry.id}" (published ${entry.publishedAt}) — drift cannot be determined for this citation.`,
          path: `${entry.id}.${citation.factRef}`,
        });
        continue;
      }

      citationsChecked++;
      const currentValue = currentValues[citation.factRef];
      const verifyFindings = verifyBinding(citation.valueBinding, canonicalizeValue(currentValue));
      if (verifyFindings.length > 0) {
        citationsDrifted++;
        findings.push({
          rule: "fact-drift",
          severity: "error",
          message: `Fact "${citation.factRef}", cited by entry "${entry.id}" (published ${entry.publishedAt}, channel "${entry.channel}"), has changed since publication: its current value no longer matches the value bound at publication time.`,
          path: `${entry.id}.${citation.factRef}`,
        });
      }
    }
  }

  const nothingChecked = citationsChecked === 0;
  if (nothingChecked) {
    findings.push({
      rule: "no-citations-checked",
      severity: "error",
      message:
        `${entries.length} entr${entries.length === 1 ? "y" : "ies"} in the ledger, but zero citations could be compared against a current value` +
        (citationsUnchecked > 0
          ? ` (${citationsUnchecked} had no current value supplied in currentValues).`
          : " (no entry in this ledger cites any fact).") +
        " Refusing to report a clean result for a check that verified nothing.",
    });
  }

  return {
    ok: !nothingChecked && citationsDrifted === 0,
    entriesChecked: entries.length,
    citationsChecked,
    citationsUnchecked,
    citationsDrifted,
    findings,
  };
}
